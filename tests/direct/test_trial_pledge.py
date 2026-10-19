"""Direct-mode tests for the TrialPledge contract."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.direct.conftest import to_hex

CONTRACT_PATH = "contracts/trial_pledge.py"
GEN = 10**18
NCT = "NCT03548935"
DOI = "10.1056/nejmoa2032183"
CTGOV_RE = rf"^https://clinicaltrials\.gov/api/v2/studies/{NCT}$"
EPMC_CORE_RE = r"^https://www\.ebi\.ac\.uk/europepmc/webservices/rest/search\?format=json&resultType=core&query=.*"
EPMC_LINK_RE = r"^https://www\.ebi\.ac\.uk/europepmc/webservices/rest/search\?format=json&resultType=idlist&query=.*"
STATEMENT_URL = "https://example.org/sponsor/statement.html"
OUTCOMES = [
    {"measure": "Change in Body Weight (%)", "timeFrame": "Week 0, week 68"},
    {"measure": "Participants Who Achieve 5 or More Percent Body Weight Reduction (Yes/no)", "timeFrame": "Week 68"},
]
ABSTRACT = (
    "<h4>Background</h4>Obesity is a global health challenge. <h4>Methods</h4>In this double-blind trial we enrolled 1961 "
    "adults with a body-mass index of 30 or greater and randomly assigned them to 68 weeks of once-weekly semaglutide or "
    "placebo plus lifestyle intervention. The coprimary end points were the percentage change in body weight and weight "
    "reduction of at least 5%. <h4>Results</h4>The mean change in body weight from baseline to week 68 was -14.9% with "
    "semaglutide as compared with -2.4% with placebo. (STEP 1 ClinicalTrials.gov number, NCT03548935.)"
)


def _study(completion="2020-03-30", ctype="ACTUAL", results="2021-08-11", cert="2021-03-03", outcomes=None):
    status = {"primaryCompletionDateStruct": {"date": completion, "type": ctype}}
    if results:
        status["resultsFirstPostDateStruct"] = {"date": results, "type": "ACTUAL"}
    if cert:
        status["dispFirstSubmitDate"] = cert
    return {
        "protocolSection": {
            "identificationModule": {"nctId": NCT, "briefTitle": "STEP 1: Semaglutide in People with Overweight or Obesity"},
            "statusModule": status,
            "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Novo Nordisk A/S"}},
            "outcomesModule": {"primaryOutcomes": OUTCOMES if outcomes is None else outcomes},
        },
        "hasResults": bool(results),
    }


def _mock_json(direct_vm, pattern, body, status=200):
    direct_vm.mock_web(
        pattern,
        {"method": "GET", "response": {"status": status, "headers": {"Content-Type": b"application/json"},
                                       "body": json.dumps(body).encode() if body is not None else b"not found"}},
    )


def _setup(direct_vm, study=None, ct_status=200, paper=True, linked=1, abstract=ABSTRACT, epmc_status=200,
           answer="MAIN_CONSISTENT", statement=None):
    direct_vm.clear_mocks()
    _mock_json(direct_vm, CTGOV_RE, _study() if study is None else study, ct_status)
    core = {"resultList": {"result": [{"doi": DOI, "title": "Once-Weekly Semaglutide in Adults with Overweight or Obesity.",
                                        "abstractText": abstract}] if paper else []}}
    _mock_json(direct_vm, EPMC_LINK_RE, {"hitCount": linked}, epmc_status)
    _mock_json(direct_vm, EPMC_CORE_RE, core, epmc_status)
    if statement is not None:
        direct_vm.mock_web(rf"^{STATEMENT_URL.replace('.', r'\.')}$",
                           {"method": "GET", "response": {"status": 200, "headers": {"Content-Type": b"text/html"}, "body": statement.encode()}})
    direct_vm.mock_llm(r".*", json.dumps({"answer": answer}))


def _pledge(direct_vm, direct_deploy, pledger, payee, bond=10 * GEN, study=None, ct_status=200, **terms):
    direct_vm.sender = pledger
    contract = direct_deploy(CONTRACT_PATH)
    _setup(direct_vm, study=study, ct_status=ct_status)
    args = dict(nct=NCT, deadline_days=365, honor_delay_cert=True, payout=4 * GEN, beneficiary=to_hex(payee), expires="2027-12-31")
    args.update(terms)
    direct_vm.value = bond
    result = contract.create_pledge(*args.values())
    direct_vm.value = 0
    return contract, result


def _file(direct_vm, contract, pledge_id, who, kind="results", doi="", stake=None, **setup):
    _setup(direct_vm, **setup)
    direct_vm.sender = who
    direct_vm.value = int(contract.stake_for(pledge_id)) if stake is None else stake
    result = contract.file_claim(pledge_id, kind, doi)
    direct_vm.value = 0
    return result


def _expire(contract, claim_id):
    contract.claims[claim_id].window_from = "2000-01-01T00:00:00"


# --- pledges -----------------------------------------------------------------


def test_pledge_freezes_the_registered_primary_outcomes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, nct="nct03548935")
    p = contract.get_pledge(pledge_id)
    assert (p.nct, p.lead_sponsor, int(p.deadline_days), p.honor_delay_cert) == (NCT, "Novo Nordisk A/S", 365, True)
    assert p.title.startswith("STEP 1")
    assert json.loads(p.outcomes_json) == [
        {"measure": "Change in Body Weight (%)", "time_frame": "Week 0, week 68"},
        {"measure": "Participants Who Achieve 5 or More Percent Body Weight Reduction (Yes/no)", "time_frame": "Week 68"},
    ]
    assert contract.pledges_for_trial(NCT.lower()) == [pledge_id]
    assert contract.stake_for(pledge_id) == str(4 * GEN // 10)


@pytest.mark.parametrize("terms, setup, reason", [
    (dict(nct="12345"), {}, "nct must be a ClinicalTrials.gov id"),
    (dict(deadline_days=10), {}, "deadline_days must be a whole number from 30 to 1095"),
    (dict(payout=GEN // 2), {}, "payout must be at least 1 GEN"),
    (dict(beneficiary="nope"), {}, "beneficiary must be a wallet address"),
    (dict(expires="2020-01-01"), {}, "expires must be a YYYY-MM-DD date that has not passed"),
    (dict(payout=11 * GEN), {}, "the bond must cover at least one payout"),
    ({}, dict(ct_status=404), f"{NCT} is not on ClinicalTrials.gov"),
    ({}, dict(ct_status=503), "Could not read ClinicalTrials.gov right now; try again"),
    ({}, dict(study=_study(outcomes=[])), f"{NCT} lists no primary outcome"),
])
def test_invalid_pledges_are_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, terms, setup, reason):
    contract, result = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, **setup, **terms)
    assert result.startswith(f"REFUNDED: {reason}")
    assert contract.get_pledges(0, 10) == []


def test_all_primary_outcomes_are_kept(direct_vm, direct_deploy, direct_alice, direct_bob):
    many = [{"measure": f"Outcome {i}", "timeFrame": "Week 12"} for i in range(25)]
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, study=_study(outcomes=many))
    assert len(json.loads(contract.get_pledge(pledge_id).outcomes_json)) == 25


# --- results deadline ---------------------------------------------------------


def test_delay_certification_before_the_deadline_extends_it(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    # STEP 1: completed 2020-03-30, certification 2021-03-03, results 2021-08-11.
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie))
    assert (claim.verdict, claim.code) == ("KEPT", "on_time")
    assert json.loads(claim.facts_json)["deadline"] == "2022-03-30"
    assert "within the pledged deadline 2022-03-30, extended to two years by the delay certification submitted 2021-03-03" in claim.why


def test_without_honouring_certifications_the_same_trial_is_late(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie))
    facts = json.loads(claim.facts_json)
    assert (claim.verdict, claim.code, facts["deadline"], facts["days_late"]) == ("BREACHED", "late", "2021-03-30", 134)
    assert "this pledge does not accept delay certifications" in claim.why


def test_extended_deadline_missed_reads_cleanly(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, study=_study(completion="2023-10-27", results="", cert="2024-08-13")))
    assert claim.why.endswith(
        "The pledged deadline was 2025-10-26, extended to two years by the delay certification submitted 2024-08-13; it has passed and no results are posted."
    )


def test_certification_after_the_deadline_does_not_extend_it(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, study=_study(cert="2021-05-01")))
    assert claim.code == "late" and "came after the deadline, so it does not extend it" in claim.why


def test_no_results_after_the_deadline_is_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, study=_study(completion="2023-07-30", results="", cert="")))
    assert (claim.verdict, claim.code) == ("BREACHED", "missing")
    assert "The pledged deadline was 2024-07-29; it has passed and no results are posted." in claim.why


def test_month_only_completion_dates_count_as_the_last_day(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, study=_study(completion="2023-02", results="", cert="")))
    assert json.loads(claim.facts_json)["deadline"] == "2024-02-28"


@pytest.mark.parametrize("study, reason", [
    (_study(ctype="ESTIMATED", results="", cert=""), "has not completed, so results are not due yet"),
    (None, "it has not passed and no results are posted yet"),
])
def test_nothing_due_yet_is_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, study, reason):
    if study is None:
        recent = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        study = _study(completion=recent, results="", cert="")
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    result = _file(direct_vm, contract, pledge_id, direct_charlie, study=study)
    assert result.startswith("REFUNDED:") and reason in result
    assert contract.get_claims(0, 10) == []


@pytest.mark.parametrize("status, verdict, code", [(404, "NOT_COVERED", "not_found"), (503, "UNCLEAR", "unreachable"), (429, "UNCLEAR", "unreachable")])
def test_registry_failures(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, status, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, ct_status=status))
    assert (claim.verdict, claim.code) == (verdict, code)


# --- publication --------------------------------------------------------------


@pytest.mark.parametrize("answer, verdict, code", [
    ("MAIN_CONSISTENT", "KEPT", "reported_as_registered"),
    ("MAIN_SWITCHED", "BREACHED", "switched"),
    ("NOT_MAIN_REPORT", "NOT_COVERED", "secondary_report"),
    ("UNCLEAR", "UNCLEAR", "unclear"),
])
def test_publication_goes_to_the_model(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, answer, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi="https://doi.org/10.1056/NEJMoa2032183", answer=answer))
    assert (claim.verdict, claim.code, claim.doi) == (verdict, code, DOI)
    assert json.loads(claim.facts_json)["outcome_count"] == 2
    assert claim.why.startswith(f"{DOI} (Once-Weekly Semaglutide")


@pytest.mark.parametrize("setup, verdict, code", [
    (dict(paper=False), "NOT_COVERED", "paper_not_found"),
    (dict(linked=0), "NOT_COVERED", "unlinked"),
    (dict(abstract="Too short."), "UNCLEAR", "no_abstract"),
    (dict(epmc_status=503), "UNCLEAR", "unreachable"),
])
def test_publication_checks_in_code(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, setup, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="MAIN_SWITCHED", **setup))
    assert (claim.verdict, claim.code) == (verdict, code)


def test_frozen_outcomes_are_used_even_if_the_registry_changes(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    changed = _study(outcomes=[{"measure": "Waist circumference", "timeFrame": "Week 68"}])
    _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, study=changed)
    assert json.loads(contract.get_pledge(pledge_id).outcomes_json)[0]["measure"] == "Change in Body Weight (%)"


def test_non_enum_model_answer_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("LLM answer must be one of"):
        _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="PROBABLY")


# --- filing -------------------------------------------------------------------


def test_filing_input_is_checked_and_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert "exactly 400000000000000000 wei" in _file(direct_vm, contract, pledge_id, direct_charlie, stake=GEN)
    assert 'kind must be "results" or "paper"' in _file(direct_vm, contract, pledge_id, direct_charlie, kind="other")
    assert "a paper claim needs the publication's DOI" in _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi="")
    assert "No pledge with id pledge_9" in _file(direct_vm, contract, "pledge_9", direct_charlie, stake=0)
    contract.pledges[pledge_id].expires = "2020-01-01"
    assert "This pledge expired on 2020-01-01" in _file(direct_vm, contract, pledge_id, direct_charlie)
    assert contract.get_claims(0, 10) == []


def test_one_open_claim_per_promise(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    first = _file(direct_vm, contract, pledge_id, direct_charlie)
    assert _file(direct_vm, contract, pledge_id, direct_bob) == f"REFUNDED: {first} is already open for this"
    # a paper claim is a different promise and can run at the same time
    assert _file(direct_vm, contract, pledge_id, direct_bob, kind="paper", doi=DOI).startswith("claim_")


# --- settlement ---------------------------------------------------------------


def test_breach_pays_beneficiary_and_reporter_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    _expire(contract, claim_id)
    direct_vm.sender = direct_bob
    assert contract.settle(claim_id) == "paid"
    p = contract.get_pledge(pledge_id)
    assert int(p.bond) == 6 * GEN and int(p.total_paid) == 4 * GEN and int(p.n_breached) == 1
    last = json.loads(contract.get_claim(claim_id).timeline_json)[-1]
    assert (last["beneficiary"], last["reporter"]) == (str(36 * GEN // 10), str(4 * GEN // 10))
    assert "already been paid" in _file(direct_vm, contract, pledge_id, direct_charlie)


def test_kept_promise_keeps_the_stake(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    _expire(contract, claim_id)
    assert contract.settle(claim_id) == "stake_to_bond"
    p = contract.get_pledge(pledge_id)
    assert int(p.bond) == 10 * GEN + 4 * GEN // 10 and int(p.n_kept) == 1


def test_unclear_returns_the_stake(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, ct_status=503)
    _expire(contract, claim_id)
    assert contract.settle(claim_id) == "stake_returned"
    assert int(contract.get_pledge(pledge_id).bond) == 10 * GEN


# --- who may act, and when ------------------------------------------------------


def test_only_the_pledger_can_concede_early(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    for who in (direct_charlie, direct_bob):
        direct_vm.sender = who
        with direct_vm.expect_revert("only the pledger can concede early"):
            contract.settle(claim_id)
    direct_vm.sender = direct_alice
    assert contract.settle(claim_id) == "paid"


def test_only_the_claimant_can_accept_early(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only the claimant can accept early"):
        contract.settle(claim_id)
    direct_vm.sender = direct_charlie
    assert contract.settle(claim_id) == "stake_to_bond"


def test_only_the_losing_side_contests_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="MAIN_SWITCHED")
    for who in (direct_charlie, direct_bob):
        direct_vm.sender = who
        with direct_vm.expect_revert("Only the pledger can contest a breach"):
            contract.contest(claim_id, "")
    # the pledger answers with a statement; the model now agrees the outcome was reported as registered
    _setup(direct_vm, answer="MAIN_CONSISTENT", statement="<p>The coprimary end points were exactly the registered ones.</p>")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("statement_url must be an https:// link"):
        contract.contest(claim_id, "http://example.org")
    assert contract.contest(claim_id, STATEMENT_URL) == "KEPT"
    claim = contract.get_claim(claim_id)
    assert claim.statement_url == STATEMENT_URL and claim.why.endswith("The pledger's statement was considered.")
    with direct_vm.expect_revert("Only the claimant can contest a ruling that pays nothing"):
        contract.contest(claim_id, "")
    _setup(direct_vm, answer="MAIN_SWITCHED", statement="<p>We disagree.</p>")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the pledger can attach a statement"):
        contract.contest(claim_id, STATEMENT_URL)
    assert contract.contest(claim_id, "") == "BREACHED"
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The pledger has already contested this claim"):
        contract.contest(claim_id, "")
    assert [s["event"] for s in json.loads(contract.get_claim(claim_id).timeline_json)] == ["filed", "contested", "contested"]


def test_window_closes_for_contests(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    _expire(contract, claim_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The response window has closed"):
        contract.contest(claim_id, "")


def test_bond_is_locked_until_expiry_and_open_claims(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the pledger can withdraw the bond"):
        contract.withdraw(pledge_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The bond stays until the pledge expires on 2027-12-31"):
        contract.withdraw(pledge_id)
    contract.pledges[pledge_id].expires = "2020-01-01"
    with direct_vm.expect_revert("Settle the open claims first"):
        contract.withdraw(pledge_id)
    _expire(contract, claim_id)
    contract.settle(claim_id)
    assert contract.withdraw(pledge_id) == str(6 * GEN)
    assert contract.pledges_for_trial(NCT) == []


def test_registry_reads_in_one_call(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)
    assert [p.id for p in contract.get_pledges(0, 200)] == [pledge_id]
    assert [c.id for c in contract.get_claims(0, 200)] == [claim_id]
    assert contract.explain_claim(claim_id).startswith("BREACHED: NCT03548935: primary completion 2020-03-30 (actual).")
    assert contract.response_window_seconds() == 600
