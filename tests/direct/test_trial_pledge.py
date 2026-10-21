"""Direct-mode tests for the TrialPledge contract."""

import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.direct.conftest import to_hex

CONTRACT_PATH = "contracts/trial_pledge.py"
GEN = 10**18
NCT = "NCT03548935"
DOI = "10.1056/nejmoa2032183"
CTGOV_RE = r"^https://clinicaltrials\.gov/api/v2/studies/NCT\d{8}$"
EPMC_CORE_RE = r"^https://www\.ebi\.ac\.uk/europepmc/webservices/rest/search\?format=json&resultType=core&query=.*"
EPMC_LINK_RE = r"^https://www\.ebi\.ac\.uk/europepmc/webservices/rest/search\?format=json&resultType=idlist&query=.*"
DOI_HANDLE_RE = r"^https://doi\.org/api/handles/.*"
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


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _days_ago(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")


def _study(completion="2020-03-30", ctype="ACTUAL", results="2021-08-11", cert="2021-03-03", outcomes=None):
    status = {"primaryCompletionDateStruct": {"date": completion, "type": ctype},
              "lastUpdatePostDateStruct": {"date": "2024-05-02", "type": "ACTUAL"}}
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
        "derivedSection": {"miscInfoModule": {"versionHolder": "2025-10-17"}},
        "hasResults": bool(results),
    }


def _mock_json(direct_vm, pattern, body, status=200):
    direct_vm.mock_web(
        pattern,
        {"method": "GET", "response": {"status": status, "headers": {"Content-Type": b"application/json"},
                                       "body": json.dumps(body).encode() if body is not None else b"not found"}},
    )


def _setup(direct_vm, study=None, ct_status=200, paper=True, linked=1, abstract=ABSTRACT, epmc_status=200,
           answer="MAIN_CONSISTENT", statement=None, published="2021-02-10", handle_status=200, handle_code=1):
    direct_vm.clear_mocks()
    _mock_json(direct_vm, CTGOV_RE, _study() if study is None else study, ct_status)
    core = {"resultList": {"result": [{"doi": DOI, "title": "Once-Weekly Semaglutide in Adults with Overweight or Obesity.",
                                        "abstractText": abstract, "pmid": "33567185", "pmcid": "",
                                        "journalTitle": "The New England journal of medicine",
                                        "firstPublicationDate": published}] if paper else []}}
    _mock_json(direct_vm, DOI_HANDLE_RE, {"responseCode": handle_code, "handle": DOI}, handle_status)
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
    (dict(payout=6 * GEN), {}, "the bond must cover both promises: at least 2 x payout"),
    (dict(nct="NCT07219953"), dict(study=_study(completion="2028-04", ctype="ESTIMATED", results="", cert="")),
     "expires must be 2030-05-30 or later: the latest results deadline (2030-04-30) plus 30 days to report"),
    (dict(nct="NCT07219953", honor_delay_cert=False, expires="2029-05-29"),
     dict(study=_study(completion="2028-04", ctype="ESTIMATED", results="", cert="")),
     "expires must be 2029-05-30 or later: the latest results deadline (2029-04-30) plus 30 days to report"),
    ({}, dict(study=_study(completion="")), f"{NCT} lists no primary completion date"),
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


@pytest.mark.parametrize("status, verdict, code", [(404, "UNCLEAR", "registry_missing"), (503, "UNCLEAR", "unreachable"), (429, "UNCLEAR", "unreachable")])
def test_registry_failures(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, status, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie, ct_status=status))
    assert (claim.verdict, claim.code) == (verdict, code)


# --- publication --------------------------------------------------------------


@pytest.mark.parametrize("answer, verdict, code", [
    ("MAIN_CONSISTENT", "KEPT", "reported_as_registered"),
    ("MAIN_SWITCHED", "BREACHED", "switched"),
    ("MAIN_CHANGE_DISCLOSED", "NOT_COVERED", "disclosed_change"),
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
    (dict(paper=False, handle_status=404, handle_code=100), "NOT_COVERED", "doi_not_registered"),
    (dict(paper=False), "UNCLEAR", "not_indexed"),
    (dict(paper=False, handle_status=503), "UNCLEAR", "unreachable"),
    (dict(linked=0), "NOT_COVERED", "unlinked"),
    (dict(linked=0, published=_days_ago(30)), "UNCLEAR", "recent_unlinked"),
    (dict(abstract=ABSTRACT.replace("The coprimary end points were", "We measured")), "UNCLEAR", "insufficient_detail"),
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
    assert "The publication promise was covered until 2020-01-01" in _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI)
    assert contract.get_claims(0, 10) == []
    # the results promise stays claimable after expiry, until the bond can leave
    assert _file(direct_vm, contract, pledge_id, direct_charlie).startswith("claim_")


def test_one_open_claim_per_promise(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    first = _file(direct_vm, contract, pledge_id, direct_charlie)
    assert _file(direct_vm, contract, pledge_id, direct_bob) == f"REFUNDED: {first} is already open for this promise"
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
    assert "This promise has already been paid from this pledge" in _file(direct_vm, contract, pledge_id, direct_charlie)


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


# --- payout guarantees ------------------------------------------------------------


@pytest.mark.parametrize("order", [("paper", "results"), ("results", "paper")])
def test_concurrent_breaches_are_both_paid_in_full(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, order):
    # The bond is exactly 2 x payout: both promises break at once and settle in either order.
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, bond=8 * GEN, honor_delay_cert=False)
    claims = {
        "results": _file(direct_vm, contract, pledge_id, direct_charlie),
        "paper": _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="MAIN_SWITCHED"),
    }
    assert json.loads(contract.totals()) == {"bonds": str(8 * GEN), "pending_stakes": str(8 * GEN // 10),
                                             "expected_balance": str(8 * GEN + 8 * GEN // 10)}
    for kind in order:
        _expire(contract, claims[kind])
        assert contract.settle(claims[kind]) == "paid"
        last = json.loads(contract.get_claim(claims[kind]).timeline_json)[-1]
        assert (last["beneficiary"], last["reporter"]) == (str(36 * GEN // 10), str(4 * GEN // 10))
    p = contract.get_pledge(pledge_id)
    assert (int(p.bond), int(p.total_paid), int(p.n_breached)) == (0, 8 * GEN, 2)
    # conservation: everything bonded and staked left as payouts, rewards and returned stakes
    assert int(p.total_bonded) + 2 * (4 * GEN // 10) == 2 * (36 * GEN // 10) + 2 * (4 * GEN // 10 + 4 * GEN // 10)
    assert json.loads(contract.totals())["expected_balance"] == "0"
    cov = json.loads(contract.coverage(pledge_id))
    assert (cov["open_promises"], cov["liability"], cov["covered"]) == ([], "0", True)


def test_coverage_tracks_open_promises(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, bond=8 * GEN)
    cov = json.loads(contract.coverage(pledge_id))
    assert (cov["open_promises"], cov["liability"], cov["results_due"], cov["paper_covered_until"]) == (
        ["results", "paper"], str(8 * GEN), "2022-03-30", "2027-12-31")
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie)  # kept: results posted within the extended deadline
    _expire(contract, claim_id)
    contract.settle(claim_id)
    cov = json.loads(contract.coverage(pledge_id))
    assert (cov["open_promises"], cov["liability"], cov["bond"]) == (["paper"], str(4 * GEN), str(8 * GEN + 4 * GEN // 10))
    assert "already been ruled kept" in _file(direct_vm, contract, pledge_id, direct_charlie)


# --- coverage maturity --------------------------------------------------------------


def test_bond_waits_for_the_results_obligation(direct_vm, direct_deploy, direct_alice, direct_bob):
    estimated = _study(completion="2028-04", ctype="ESTIMATED", results="", cert="")
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, nct="NCT07219953", study=estimated, expires="2030-06-01")
    assert contract.get_pledge(pledge_id).results_due == "2030-04-30"
    contract.pledges[pledge_id].expires = _days_ago(1)  # pretend coverage has run out
    direct_vm.sender = direct_alice
    # the completion estimate slipped: results are not due, so the bond stays
    _setup(direct_vm, study=_study(completion="2031-06", ctype="ESTIMATED", results="", cert=""))
    with direct_vm.expect_revert("the trial has not completed (primary completion 2031-06, estimated)"):
        contract.withdraw(pledge_id)
    # completed, but the deadline and its report period are still running
    _setup(direct_vm, study=_study(completion=_days_ago(100), results="", cert=""))
    with direct_vm.expect_revert("results are due"):
        contract.withdraw(pledge_id)
    _setup(direct_vm, ct_status=503)
    with direct_vm.expect_revert("ClinicalTrials.gov could not be read"):
        contract.withdraw(pledge_id)
    _setup(direct_vm, study=_study(completion=_days_ago(500), results="", cert=""))
    assert contract.withdraw(pledge_id) == str(10 * GEN)


def test_bond_unlocks_when_results_are_posted_or_at_the_backstop(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.pledges[pledge_id].expires = "2020-01-01"  # backstop 2022-12-31 has passed: no registry read needed
    _setup(direct_vm, ct_status=503)
    direct_vm.sender = direct_alice
    assert contract.withdraw(pledge_id) == str(10 * GEN)
    assert json.loads(contract.get_pledge(pledge_id).history_json)[-1]["why"] == "backstop 2022-12-31 passed"


# --- one publication obligation ---------------------------------------------------------


def test_the_publication_promise_is_one_obligation(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    other = "10.1016/s0140-6736(21)00213-0"
    first = _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="NOT_MAIN_REPORT")
    assert _file(direct_vm, contract, pledge_id, direct_bob, kind="paper", doi=other) == f"REFUNDED: {first} is already open for this promise"
    _expire(contract, first)
    contract.settle(first)
    assert f"{DOI} has already been ruled on" in _file(direct_vm, contract, pledge_id, direct_bob, kind="paper", doi=DOI)
    second = _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=other, answer="MAIN_SWITCHED")
    _expire(contract, second)
    assert contract.settle(second) == "paid"
    assert contract.get_pledge(pledge_id).main_doi == other
    assert "This promise has already been paid" in _file(direct_vm, contract, pledge_id, direct_bob, kind="paper", doi="10.1056/nejmoa9999999")


def test_once_the_main_report_is_known_other_dois_are_refused(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="MAIN_CHANGE_DISCLOSED")
    _expire(contract, claim_id)
    contract.settle(claim_id)
    assert contract.get_pledge(pledge_id).main_doi == DOI
    assert f"already identified as {DOI}" in _file(direct_vm, contract, pledge_id, direct_bob, kind="paper", doi="10.1056/nejmoa2032183x")


# --- evidence ------------------------------------------------------------------------


def test_every_assessment_keeps_an_evidence_packet(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, honor_delay_cert=False)
    results = contract.get_claim(_file(direct_vm, contract, pledge_id, direct_charlie))
    packet = json.loads(results.evidence_json)[0]
    fields = {"completion": "2020-03-30", "completion_type": "ACTUAL", "results_posted": "2021-08-11", "delay_cert": "2021-03-03"}
    assert packet["fields"] == fields and packet["fields_sha256"] == _sha(json.dumps(fields, sort_keys=True))
    assert (packet["last_update_posted"], packet["version_holder"], packet["status"]) == ("2024-05-02", "2025-10-17", 200)
    assert packet["record"] == f"https://clinicaltrials.gov/study/{NCT}"

    paper_id = _file(direct_vm, contract, pledge_id, direct_charlie, kind="paper", doi=DOI, answer="MAIN_SWITCHED")
    first = json.loads(contract.get_claim(paper_id).evidence_json)[0]
    abstract = first["abstract"]
    assert abstract.startswith("Background Obesity") and first["abstract_sha256"] == _sha(abstract)
    assert first["registered_outcomes_sha256"] == _sha(contract.get_pledge(pledge_id).outcomes_json)
    assert (first["pmid"], first["record"], first["linkage"]["hits"]) == ("33567185", "https://europepmc.org/article/MED/33567185", 1)
    # The pledger's statement claims a disclosure the publication does not contain: it is stored and hashed, the ruling stands.
    statement = "<p>The change of primary end point was approved by the regulator.</p>"
    _setup(direct_vm, answer="MAIN_SWITCHED", statement=statement)
    direct_vm.sender = direct_alice
    assert contract.contest(paper_id, STATEMENT_URL) == "BREACHED"
    claim = contract.get_claim(paper_id)
    packets = json.loads(claim.evidence_json)
    text = "The change of primary end point was approved by the regulator."
    assert len(packets) == 2 and packets[1]["statement"] == {"url": STATEMENT_URL, "sha256": _sha(text), "chars": len(text), "excerpt": text}
    steps = json.loads(claim.timeline_json)
    assert [s["evidence"] for s in steps] == [p["packet_sha256"] for p in packets]
    for p in packets:
        body = {k: v for k, v in p.items() if k != "packet_sha256"}
        assert p["packet_sha256"] == _sha(json.dumps(body, sort_keys=True))
