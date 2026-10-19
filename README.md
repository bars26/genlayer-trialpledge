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
   Validators read the trial and **freeze its registered primary outcomes** in the pledge, so editing the registry later
   cannot launder a switch.
2. **Anyone reports** a broken promise by staking 10% of the payout: *results are late*, or *the paper changed the
   outcome* (with the publication's DOI).
3. **Every validator** reads the public record itself:
   - *Results on time?* Decided in code from the ClinicalTrials.gov v2 API: primary completion (must be `ACTUAL`; a
     month-only date counts as its last day), results first-posted date, and the delay certification date.
   - *Outcome as registered?* Code first checks Europe PMC knows the DOI, **links it to this trial** (the registry number
     is indexed in the abstract or full text) and has an abstract. Only then are validators asked one question: is this
     the main results report, and does it present the frozen registered primary outcome(s) as primary? `MAIN_CONSISTENT`,
     `MAIN_SWITCHED`, `NOT_MAIN_REPORT` (post-hoc, pooled, sub-study) or `UNCLEAR`.
4. The side the ruling goes against may ask **once** for a second look within 10 minutes (the pledger can attach a
   statement link explaining an outcome change). Every ruling stores a **plain-English reason** and a **timeline**.
5. A broken promise pays 90% of the payout to the beneficiary and 10% plus the stake back to the reporter. A kept promise
   adds the reporter's stake to the bond. If a source cannot be read, nothing is decided and the stake goes back.

**Live app:** [trialpledge-bars26.vercel.app](https://trialpledge-bars26.vercel.app). Paste any NCT number to see its
results clock without a wallet. Writes need MetaMask on GenLayer Studio (chain 61999); **Test GEN** funds your wallet.
**Contract:** [`0x9dd109BeAaB9edCF011C28F0d82A7B87fE25927a`](https://explorer-studio.genlayer.com/address/0x9dd109BeAaB9edCF011C28F0d82A7B87fE25927a) on GenLayer Studio.

## Verified live, on real trials and papers

`scripts/demo.mjs` ran demo pledges (made by a test wallet, not by the sponsors) against real registry records and
real publications, with real validator consensus and LLM calls. Every transaction hash is in
[`docs/REPRODUCTION.md`](docs/REPRODUCTION.md).

| Pledge | Claim | What validators read | Ruling and stored reason |
|---|---|---|---|
| STEP 1, semaglutide (NCT03548935), 365 days, delay certification counts | results on time? | completed 2020-03-30, certification 2021-03-03, results 2021-08-11 | **Kept**: *"…within the pledged deadline 2022-03-30, extended to two years by the delay certification submitted 2021-03-03."* |
| same | NEJM 2021 main paper (10.1056/NEJMoa2032183) | linked to the trial; abstract vs the two frozen co-primary outcomes | **Kept**: *"…reports the 2 registered primary outcome(s) as primary."* The pledger could not settle early; the reporter's second look confirmed it |
| same | a post hoc analysis (10.1002/oby.23732) | linked to the trial | **Not covered**: *"…a secondary or post-hoc analysis, not the main results report."* |
| same | a paper about another study | Europe PMC does not link it to NCT03548935 | **Not covered** (decided in code) |
| STEP 1 again, 365 days, **no** extensions | results on time? | same dates | **Broken**: *"…first posted 2021-08-11, 134 days after the pledged deadline 2021-03-30; this pledge does not accept delay certifications."* The pledger conceded; refiling was refused (paid once) |
| NCT04636229 (completed 2023-07-30) | results on time? | no results posted | **Broken** (missing); the pledger's second look confirmed it; settled after the window |
| NCT05608343 (completed 2023-10-27, certification 2024-08-13) | results on time? | extended deadline 2025-10-26, no results | **Broken**, even with the extension |
| NCT07219953 (still recruiting) | results on time? | primary completion estimated 2028-04 | refunded: not due |

Also refused on-chain: a malformed NCT number, an NCT number that does not exist, a claim with the wrong stake, and
the reporter and the beneficiary trying to settle a breach before the window.

## Who can do what (and the attacks this blocks)

| Rule | Why |
|---|---|
| The registered primary outcomes are frozen when the pledge is made | A sponsor cannot edit the registry later to match a switched paper |
| A paper must be linked to the trial in Europe PMC before any model is asked | A reporter cannot claim a breach with an unrelated paper |
| Secondary, post-hoc and pooled analyses are "not the main report" | Many legitimate papers reuse a trial; only the main report is held to the registered outcome |
| Only the side a ruling goes against contests, once per side; every contest restarts the window | Nobody spends the other side's only answer; a changed ruling can always be answered |
| Early settlement only against your own interest (the pledger concedes, the reporter accepts) | The reporter or beneficiary cannot rush a payout; the pledger cannot rush taking a stake |
| One open claim per promise; each promise pays once (`results`, `paper:<doi>`) | No double payouts, no claim spam on one promise |
| Not-due claims (trial not completed, deadline not passed) are refunded, not opened | A reporter cannot lock a pledge early |
| 404 means not found; any other source failure is `UNCLEAR` and returns the stake | An outage never decides a breach |
| Payable calls never revert; they refund and return `REFUNDED: <reason>` | GenLayer keeps the value of a reverted call |
| The bond is locked until the pledge expires and every claim is settled | The pledger cannot run from an open claim |

## The app

- **No-wallet first step:** paste an NCT number and see the trial's **results clock**: a ruler from primary
  completion to the deadline (and the extended deadline when a delay certification counts), with the results date or
  today marked, and the registered primary outcomes. Same arithmetic as the contract (`/api/trial`).
- **Report flow** with a live check: for a paper, Europe PMC is asked whether the DOI exists, is linked to the trial and
  has an abstract before you stake anything; claims that would be refunded are blocked with the reason.
- **Studio's 30 requests per minute:** page loads read the registry server-side with one `get_pledges` and one
  `get_claims` call, CDN-cached; the browser keeps its own 24-per-minute budget and shows it.
- Every write shows its hash, consensus status and the contract's own result; refusals show the contract's message.

## Run it

```bash
pip install -r requirements.txt
genvm-lint check contracts/trial_pledge.py
pytest tests/direct/ -v                     # 43 tests, ClinicalTrials.gov / Europe PMC / LLM mocked

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
- The outcome check reads the title and abstract, not the full text; an abstract that says too little is `UNCLEAR`.
- ClinicalTrials.gov's version history is not available through its public API, so the frozen copy starts when the
  pledge is made.
- Not medical advice: rulings are about registry and publication records only.

MIT licensed.
