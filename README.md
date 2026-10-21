# TrialPledge

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)

<img src="assets/trialpledge-logo.png" alt="TrialPledge logo" width="96" align="right" />

**Clinical-trial transparency pledges, backed by GEN and ruled by GenLayer validators.**

Two promises are made for every registered clinical trial and too often broken: post the results on ClinicalTrials.gov
within a year of primary completion (US law, FDAAA 801), and publish the primary outcome that was registered instead of
quietly switching to a better-looking one. Both leave public traces, but nobody is paid to check them and nothing
happens when they are broken.

TrialPledge puts money behind both:

1. A **pledger** (the sponsor, or anyone backing the trial's transparency with their own GEN) bonds GEN for one trial
   (NCT number) and sets the terms: results due within N days of primary completion (365 by default), whether a **delay
   certification** filed in time extends it to two years (as US law allows while a drug awaits approval), the payout per
   broken promise, a **beneficiary** wallet (for example a patient group) and how long the pledge stays open.
   The bond must cover **both promises in full** (at least 2 × payout), and the pledge must run at least until the
   latest results deadline its terms allow plus 30 days to report.
   Validators read the trial and **freeze its registered primary outcomes** in the pledge, so editing the registry later
   cannot launder a switch.
2. **Anyone reports** a broken promise by staking 10% of the payout: *results are late*, or *the paper changed the
   outcome* (with the publication's DOI).
3. **Every validator** reads the public record itself:
   - *Results on time?* Decided in code from the ClinicalTrials.gov v2 API: primary completion (must be `ACTUAL`; a
     month-only date counts as its last day), results first-posted date, and the delay certification date.
   - *Outcome as registered?* Code first checks Europe PMC knows the DOI (if not, doi.org tells a DOI that does not
     exist from one that is not indexed yet), **links it to this trial** (the registry number is indexed in the abstract
     or full text) and has an abstract. Only then are validators asked one question: is this the main results report,
     and does it present the frozen registered primary outcome(s) as primary? `MAIN_CONSISTENT`, `MAIN_SWITCHED`,
     `MAIN_CHANGE_DISCLOSED` (the paper itself says the outcome changed), `NOT_MAIN_REPORT` (post-hoc, pooled,
     sub-study) or `UNCLEAR`. A kept or broken outcome ruling also needs the abstract to **name its primary outcome**
     (checked in code); otherwise nothing is decided.
4. The side the ruling goes against may ask **once** for a second look within 10 minutes (the pledger can attach a
   statement link, which can only point validators to a disclosure inside the paper). Every ruling stores a
   **plain-English reason**, a **timeline** and an **evidence packet**: the exact registry fields or abstract read,
   durable record links, the registry version, and sha256 hashes.
5. A broken promise pays 90% of the payout to the beneficiary and 10% plus the stake back to the reporter, always in
   full. A kept promise adds the reporter's stake to the bond. If a source cannot be read, returns a 404 for a trial
   that existed, or has not indexed a paper yet, nothing is decided and the stake goes back.

**Live app:** [trialpledge-bars26.vercel.app](https://trialpledge-bars26.vercel.app). Paste any NCT number to see its
results clock without a wallet. Writes need MetaMask on GenLayer Studio (chain 61999); **Test GEN** funds your wallet.
**Contract:** [`0x1A9e92B1Fad92F55D493dda45cfF11E85FA75762`](https://explorer-studio.genlayer.com/address/0x1A9e92B1Fad92F55D493dda45cfF11E85FA75762) on GenLayer Studio
(v2; the first contract and its run are in [`docs/REPRODUCTION-v1.md`](docs/REPRODUCTION-v1.md)).

## What changed after review (v2)

| Review point | What the contract does now | Tests |
|---|---|---|
| Concurrent breaches could be paid partially, in settlement order | The bond must cover every promise that can still pay (payout × open promises, so 2 × payout at pledging). Each promise pays once, so the bond can never fall short: every confirmed breach is paid in full, in any order. `coverage(pledge_id)` returns the open promises, liability and bond; `totals()` returns what the contract should hold for balance reconciliation | `test_concurrent_breaches_are_both_paid_in_full` (both orders, exact conservation), `test_coverage_tracks_open_promises` |
| The bond could leave before the results were due | `expires` must be at least the latest results deadline the terms allow (from the actual or estimated completion) plus 30 days to report. After expiry, `withdraw` reads ClinicalTrials.gov again and refuses while the results promise has not matured (completion estimate slipped, deadline or report period still running, registry unreadable). A 3-year backstop after expiry prevents a permanent lock. Results claims stay open until then; the publication promise is watched until `expires`, shown on every card | `test_bond_waits_for_the_results_obligation`, `test_bond_unlocks_when_results_are_posted_or_at_the_backstop`, refusals in `test_invalid_pledges_are_refunded` |
| Different DOIs could be paid for the same main publication | The publication promise is one obligation keyed `paper`, not per DOI: one open paper claim at a time, at most one payout. Once validators identify the main report (kept, switched or disclosed change), no other DOI can be claimed; a DOI with a settled ruling is never assessed again | `test_the_publication_promise_is_one_obligation`, `test_once_the_main_report_is_known_other_dois_are_refused` |
| Rulings did not commit to the exact evidence | Every assessment (filing and each contest) appends an evidence packet to the claim: source and record URLs, registry `lastUpdatePostDate` and version, the fields read, the exact abstract evaluated, PMID, linkage query and hit count, the pledger statement (URL, sha256, excerpt), sha256 of the frozen outcomes, and a packet hash that the timeline also records. A statement is a claim, not evidence: it can only point to a disclosure inside the paper | `test_every_assessment_keeps_an_evidence_packet` (including a statement that contradicts the paper) |
| Abstract-only inference could decide money; 404s could forfeit stakes | A kept or broken outcome ruling needs the abstract to name its primary outcome (checked in code), else `UNCLEAR` (`insufficient_detail`). A 404 for a trial that existed at pledging is `UNCLEAR`; a paper missing from Europe PMC is `UNCLEAR` if doi.org knows the DOI and not covered only if the DOI does not exist; an unlinked paper first published under 120 days ago is `UNCLEAR` | `test_publication_checks_in_code`, `test_registry_failures` |
| Frontend | Each pledge shows what is still payable, the liability against the bond, the results due date, how long the bond stays locked, the paper watch period and the identified main report. Each claim shows its evidence packets with hashes and the exact abstract evaluated. The pledge form enforces the 2 × payout bond and the earliest end date | live run below |

## Verified live, on real trials and papers

`scripts/demo.mjs` ran demo pledges (made by a test wallet, not by the sponsors) against real registry records and
real publications, with real validator consensus and LLM calls. Every transaction hash, the coverage reads, the balance
reconciliation and every evidence packet are in [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md).

| Pledge | Claim | What validators read | Ruling and stored reason |
|---|---|---|---|
| STEP 1, semaglutide (NCT03548935), 365 days, delay certification counts | results on time? | completed 2020-03-30, certification 2021-03-03, results 2021-08-11 | **Kept**: *"…within the pledged deadline 2022-03-30, extended to two years by the delay certification submitted 2021-03-03."* Refiling was refused (ruled kept) |
| same | a post hoc analysis (10.1002/oby.23732) | linked to the trial | **Not covered**: *"…a secondary or post-hoc analysis, not the main results report."* |
| same | a paper about another study | Europe PMC does not link it to NCT03548935 | **Not covered** (decided in code) |
| same | a DOI that does not exist (10.1056/NEJMoa9999999) | not in Europe PMC; doi.org answers 404 | **Not covered**: *"…is not a registered DOI: doi.org has no record of it."* |
| same | NEJM 2021 main paper (10.1056/NEJMoa2032183) | linked; the abstract names its co-primary end points; compared with the two frozen outcomes | **Kept**: *"…reports the 2 registered primary outcome(s) as primary."* The pledger could not settle early; the reporter's second look confirmed it. It became the pledge's main report, so the post hoc DOI was then refused |
| STEP 1 again, 365 days, **no** extensions, bond exactly 2 × payout | results on time? **and** the NEJM paper, filed together | same dates; same paper | **Broken** (134 days late) and **kept**, both open at once with the bond covering both promises; the pledger conceded and was paid in full; a third claim on the open paper promise was refused |
| NCT04636229 (completed 2023-07-30) | results on time? | no results posted | **Broken** (missing); the pledger's second look confirmed it; settled after the window |
| NCT05608343 (completed 2023-10-27, certification 2024-08-13) | results on time? | extended deadline 2025-10-26, no results | **Broken**, even with the extension |
| NCT07219953 (still recruiting, completion estimated 2028-04), open until 2030-12-31 | results on time? | not completed | refunded: not due; the pledger's early `withdraw` was refused; results due by 2030-04-30 at the latest |

Also refused on-chain: a malformed NCT number, an NCT number that does not exist, a bond below 2 × payout, a pledge on
NCT07219953 ending 2029-12-31 (before its latest results deadline plus 30 days), a claim with the wrong stake, and the
reporter and the beneficiary trying to settle a breach before the window. The contract's balance was reconciled with
`totals()` (active bonds plus open stakes) at four points of the run.

## Who can do what (and the attacks this blocks)

| Rule | Why |
|---|---|
| The registered primary outcomes are frozen when the pledge is made | A sponsor cannot edit the registry later to match a switched paper |
| A paper must be linked to the trial in Europe PMC before any model is asked | A reporter cannot claim a breach with an unrelated paper |
| Secondary, post-hoc and pooled analyses are "not the main report" | Many legitimate papers reuse a trial; only the main report is held to the registered outcome |
| Only the side a ruling goes against contests, once per side; every contest restarts the window | Nobody spends the other side's only answer; a changed ruling can always be answered |
| Early settlement only against your own interest (the pledger concedes, the reporter accepts) | The reporter or beneficiary cannot rush a payout; the pledger cannot rush taking a stake |
| The bond covers every promise that can still pay (2 × payout at pledging) | Every confirmed breach is paid in full, whatever the settlement order |
| One open claim per promise; each promise pays once (`results`, `paper`); the main paper is one obligation | No double payouts through several DOIs, no claim spam on one promise |
| `expires` ≥ latest results deadline + 30 days; withdrawing re-reads the registry | The pledger cannot leave before the results are due, even if the completion estimate slips |
| A kept or broken outcome ruling needs the abstract to name its primary outcome | A model's guess from a vague abstract never moves money |
| Not-due claims (trial not completed, deadline not passed) are refunded, not opened | A reporter cannot lock a pledge early |
| Any source failure, a 404 for a trial that existed, or a paper not yet indexed is `UNCLEAR` and returns the stake | An outage or an indexing delay never decides a ruling |
| Payable calls never revert; they refund and return `REFUNDED: <reason>` | GenLayer keeps the value of a reverted call |
| The bond is locked until the pledge expires and every claim is settled | The pledger cannot run from an open claim |

## The app

- **No-wallet first step:** paste an NCT number and see the trial's **results clock**: a ruler from primary
  completion to the deadline (and the extended deadline when a delay certification counts), with the results date or
  today marked, and the registered primary outcomes. Same arithmetic as the contract (`/api/trial`).
- **Coverage on every pledge:** what can still pay, the liability against the bond, the latest results due date, how
  long the bond stays locked, the paper watch period and the identified main report.
- **Evidence on every claim:** each assessment's packet with record links, registry version, hashes and the exact
  abstract that was evaluated.
- **Report flow** with a live check: for a paper, Europe PMC is asked whether the DOI exists, is linked to the trial and
  has an abstract before you stake anything; claims that would be refunded are blocked with the reason.
- **Studio's 30 requests per minute:** page loads read the registry server-side with one `get_pledges` and one
  `get_claims` call, CDN-cached; the browser keeps its own 24-per-minute budget and shows it.
- Every write shows its hash, consensus status and the contract's own result; refusals show the contract's message.

## Run it

```bash
pip install -r requirements.txt
genvm-lint check contracts/trial_pledge.py
pytest tests/direct/ -v                     # 59 tests, ClinicalTrials.gov / Europe PMC / doi.org / LLM mocked

npm install
node scripts/deploy.mjs
node scripts/verify-code.mjs <address>
node scripts/demo.mjs <address>             # the live run above (about 20 minutes)
node scripts/reproduction.mjs               # regenerate docs/REPRODUCTION.md

cd frontend && cp .env.example .env.local && npm run dev
```

## Limits, stated plainly

- The contract does not verify that a pledger is the trial's sponsor; a pledge is a promise backed by the pledger's own
  GEN. The demo pledges are made by a test wallet.
- "Late" and "missing" are judged against the pledge's own terms. Whether a trial is legally required to report
  (an "applicable clinical trial" under FDAAA) is not judged.
- The outcome check reads the title and abstract, not the full text; an abstract that does not name its primary
  outcome is `UNCLEAR`.
- The bond can stay locked after `expires` while a trial's completion keeps slipping, up to three years; that is the
  price of an enforceable results promise and is shown on the pledge.
- ClinicalTrials.gov's version history is not available through its public API, so the frozen copy starts when the
  pledge is made.
- Not medical advice: rulings are about registry and publication records only.

MIT licensed.
