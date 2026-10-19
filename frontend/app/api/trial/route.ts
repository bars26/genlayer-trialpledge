/**
 * Wallet-free lookups, computed exactly as the contract's coded checks:
 *
 *   /api/trial?nct=NCT03548935[&days=365&honor=1]   the trial's registry facts and results-deadline status
 *   /api/trial?nct=NCT03548935&doi=10.1056/...      whether Europe PMC links that paper to the trial
 *
 * The publication judgment itself (is the registered primary outcome reported as primary?) is made
 * on-chain by the validators; this route only says whether the paper is linked and has an abstract.
 */

import { deadlineFor, dayMs, type TrialLookup } from "@/lib/contracts/types";

export const dynamic = "force-dynamic";

const NCT_RE = /^NCT\d{8}$/;
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json";

async function getJson(url: string): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 600 } });
    return { status: res.status, data: res.ok ? await res.json() : null };
  } catch {
    return { status: 0, data: null };
  }
}

const cache = { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const nct = (q.get("nct") || "").trim().toUpperCase();
  if (!NCT_RE.test(nct)) return Response.json({ nct, found: false, error: "Use a ClinicalTrials.gov number like NCT03548935." }, { status: 400 });

  const doi = (q.get("doi") || "").trim().toLowerCase().replace(/^(https?:\/\/doi\.org\/|doi:)/, "");
  if (doi) {
    const core = await getJson(`${EPMC}&resultType=core&query=${encodeURIComponent(`DOI:"${doi}"`)}`);
    if (core.status !== 200) return Response.json({ doi, error: "Europe PMC could not be reached." }, cache);
    const rec = core.data?.resultList?.result?.[0];
    if (!rec) return Response.json({ doi, found: false }, cache);
    const linked = await getJson(`${EPMC}&resultType=idlist&query=${encodeURIComponent(`(DOI:"${doi}") AND (${nct})`)}`);
    const abstract = String(rec.abstractText || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return Response.json(
      {
        doi,
        found: true,
        title: String(rec.title || "").replace(/<[^>]+>/g, ""),
        journal: rec.journalTitle || rec.bookOrReportDetails?.publisher || "",
        year: rec.pubYear || "",
        linked: Number(linked.data?.hitCount || 0) > 0,
        abstract_chars: abstract.length,
      },
      cache
    );
  }

  const { status, data } = await getJson(`https://clinicaltrials.gov/api/v2/studies/${nct}`);
  if (status === 404) return Response.json({ nct, found: false } satisfies TrialLookup, cache);
  if (status !== 200 || !data?.protocolSection) return Response.json({ nct, found: false, error: "ClinicalTrials.gov could not be reached." }, cache);
  const p = data.protocolSection;
  const s = p.statusModule || {};
  const out: TrialLookup = {
    nct,
    found: true,
    title: p.identificationModule?.briefTitle || "",
    lead_sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || "",
    completion: s.primaryCompletionDateStruct?.date || "",
    completion_type: s.primaryCompletionDateStruct?.type || "",
    results_posted: s.resultsFirstPostDateStruct?.date || "",
    delay_cert: s.dispFirstSubmitDate || "",
    outcomes: (p.outcomesModule?.primaryOutcomes || []).map((o: any) => ({ measure: o.measure || "", time_frame: o.timeFrame || "" })),
  };
  const days = Math.min(1095, Math.max(30, Number(q.get("days") || 365)));
  const honor = q.get("honor") !== "0";
  if (out.completion_type !== "ACTUAL" || !/^\d{4}-\d{2}/.test(out.completion || "")) {
    out.status = "not_completed";
    return Response.json(out, cache);
  }
  const plain = deadlineFor(out.completion!, days, undefined, false);
  const used = deadlineFor(out.completion!, days, out.delay_cert, honor);
  out.deadline = plain.deadline;
  out.extended_deadline = used.extended ? used.deadline : undefined;
  out.cert_extends = used.extended;
  const due = dayMs(used.deadline);
  if (out.results_posted) {
    const posted = dayMs(out.results_posted);
    out.status = posted <= due ? "on_time" : "late";
    if (posted > due) out.days_late = Math.floor((posted - due) / 86_400_000);
  } else {
    out.status = Date.now() <= due ? "not_due" : "missing";
  }
  return Response.json(out, cache);
}
