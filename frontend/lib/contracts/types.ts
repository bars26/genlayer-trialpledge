/** Types and display helpers for the TrialPledge contract. */

export type Verdict = "BREACHED" | "KEPT" | "NOT_COVERED" | "UNCLEAR";
export type ClaimKind = "results" | "paper";
type Num = string | number | bigint;

export interface Pledge {
  id: string;
  pledger: string;
  nct: string;
  title: string;
  lead_sponsor: string;
  outcomes_json: string;
  deadline_days: Num;
  honor_delay_cert: boolean;
  payout: Num;
  beneficiary: string;
  expires: string;
  state: "active" | "closed";
  bond: Num;
  total_bonded: Num;
  total_paid: Num;
  stakes_kept: Num;
  pending: Num;
  paid_json: string;
  claim_ids_json: string;
  n_breached: Num;
  n_kept: Num;
  n_other: Num;
  history_json: string;
}

export interface Claim {
  id: string;
  pledge_id: string;
  kind: ClaimKind;
  doi: string;
  claimant: string;
  stake: Num;
  filed_at: string;
  window_from: string;
  state: "pending" | "settled";
  verdict: Verdict;
  code: string;
  facts_json: string;
  why: string;
  statement_url: string;
  pledger_contested: boolean;
  claimant_contested: boolean;
  outcome: "" | "paid" | "stake_returned" | "stake_to_bond";
  timeline_json: string;
}

/** What every validator read and agreed on for a ruling. */
export interface ClaimFacts {
  nct?: string;
  completion?: string;
  completion_type?: string;
  results_posted?: string;
  delay_cert?: string;
  deadline?: string;
  cert_extended?: boolean;
  days_late?: number | null;
  doi?: string;
  paper_title?: string;
  outcome_count?: number;
  answer?: string;
}

export interface Outcome {
  measure: string;
  time_frame: string;
}

/** A trial as /api/trial reports it (ClinicalTrials.gov, with the deadline arithmetic the contract uses). */
export interface TrialLookup {
  nct: string;
  found: boolean;
  error?: string;
  title?: string;
  lead_sponsor?: string;
  completion?: string;
  completion_type?: string;
  results_posted?: string;
  delay_cert?: string;
  outcomes?: Outcome[];
  deadline?: string;
  extended_deadline?: string;
  cert_extends?: boolean;
  status?: "not_completed" | "not_due" | "on_time" | "late" | "missing";
  days_late?: number;
}

export interface TimelineStep {
  at: string;
  event: "filed" | "contested" | "settled";
  by?: string;
  before?: string;
  verdict?: string;
  code?: string;
  outcome?: string;
  amount?: string;
  beneficiary?: string;
  reporter?: string;
}

export const RESPONSE_WINDOW_SECONDS = 600;
export const MIN_PAYOUT_WEI = 10n ** 18n;
export const NCT_RE = /^NCT\d{8}$/i;
export const DOI_RE = /^(https:\/\/doi\.org\/|doi:)?10\.\d{4,9}\/\S+$/i;

export function wei(v: Num | undefined): bigint {
  try {
    return BigInt(String(v ?? "0").split(".")[0]);
  } catch {
    return 0n;
  }
}

export function formatGen(v: Num | undefined, digits = 2): string {
  const n = Number(wei(v)) / 1e18;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function parseGen(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export function parseJson<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function utcMs(iso: string): number {
  if (!iso) return NaN;
  const t = iso.trim();
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`);
}

export function windowLeftSeconds(claim: Claim, now = Date.now()): number {
  return Math.max(0, Math.ceil(RESPONSE_WINDOW_SECONDS - (now - utcMs(claim.window_from)) / 1000));
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const factsOf = (c: Claim) => parseJson<ClaimFacts>(c.facts_json, {});
export const timelineOf = (c: Claim) => parseJson<TimelineStep[]>(c.timeline_json, []);
export const outcomesOf = (p: Pledge) => parseJson<Outcome[]>(p.outcomes_json, []);
export const stakeFor = (p: Pledge) => wei(p.payout) / 10n;
export const normDoi = (doi: string) => doi.trim().toLowerCase().replace(/^(https?:\/\/doi\.org\/|doi:)/, "");

export const trialUrl = (nct: string) => `https://clinicaltrials.gov/study/${nct}`;
export const doiUrl = (doi: string) => `https://doi.org/${doi}`;

export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; help: string }> = {
  BREACHED: {
    label: "Promise broken",
    cls: "bg-[#FDEAE6] text-[#B83A26] border-[#F6C6BC]",
    help: "The bond pays the beneficiary, and the reporter gets 10%.",
  },
  KEPT: {
    label: "Promise kept",
    cls: "bg-[#E3F5F2] text-[#0B7F70] border-[#B6E3DB]",
    help: "The reporter's stake goes to the bond.",
  },
  NOT_COVERED: {
    label: "Not covered",
    cls: "bg-[#EEF3F6] text-[#3B5566] border-[#D5E1E8]",
    help: "The paper is not this trial's main results report, or the claim does not apply. The stake goes to the bond.",
  },
  UNCLEAR: {
    label: "Unclear",
    cls: "bg-[#FEF4E4] text-[#A6640F] border-[#F6DDB0]",
    help: "A source could not be read or the abstract said too little. The stake comes back.",
  },
};

export const OUTCOME_TEXT: Record<string, string> = {
  paid: "Paid from the bond",
  stake_returned: "Stake returned to the reporter",
  stake_to_bond: "Stake added to the bond",
};

export const CODE_LABEL: Record<string, string> = {
  on_time: "results on time",
  late: "results late",
  missing: "no results",
  not_found: "trial not found",
  unreachable: "source unreachable",
  reported_as_registered: "outcome as registered",
  switched: "primary outcome changed",
  secondary_report: "not the main report",
  unlinked: "paper not linked to trial",
  paper_not_found: "paper not found",
  no_abstract: "no abstract",
  unclear: "abstract unclear",
};

/** The same deadline arithmetic the contract uses, for previews and the timeline. */
export function deadlineFor(completion: string, days: number, cert: string | undefined, honor: boolean) {
  const comp = dayMs(completion);
  let deadline = comp + days * 86_400_000;
  let extended = false;
  if (honor && cert && /^\d{4}-\d{2}-\d{2}$/.test(cert) && dayMs(cert) <= deadline) {
    deadline = Math.max(deadline, comp + 730 * 86_400_000);
    extended = true;
  }
  return { deadline: new Date(deadline).toISOString().slice(0, 10), extended };
}

export function dayMs(day: string): number {
  const d = day.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(d)) {
    const [y, m] = d.split("-").map(Number);
    return Date.UTC(m === 12 ? y + 1 : y, m % 12, 1) - 86_400_000;
  }
  return Date.parse(`${d}T00:00:00Z`);
}
