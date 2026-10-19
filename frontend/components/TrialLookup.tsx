"use client";

import { useState } from "react";
import { ArrowRight, ExternalLink, Loader2, Search } from "lucide-react";
import { NCT_RE, trialUrl, type TrialLookup as Lookup } from "@/lib/contracts/types";
import { useRegistry } from "@/lib/hooks/useTrialPledge";
import { Timeline } from "./Timeline";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const EXAMPLES = [
  { nct: "NCT03548935", label: "STEP 1, semaglutide" },
  { nct: "NCT04636229", label: "knee osteoarthritis" },
  { nct: "NCT07219953", label: "still recruiting" },
];

function verdictLine(t: Lookup): { text: string; tone: string } {
  switch (t.status) {
    case "not_completed":
      return { text: "Not completed yet: results are not due.", tone: "text-muted-foreground" };
    case "not_due":
      return { text: `Completed ${t.completion}. Results are due by ${t.extended_deadline || t.deadline}.`, tone: "text-[#A6640F]" };
    case "on_time":
      return {
        text: `Results were posted on ${t.results_posted}, within the deadline${t.cert_extends ? " (extended by a delay certification)" : ""}.`,
        tone: "text-[#0B7F70]",
      };
    case "late":
      return { text: `Results were posted on ${t.results_posted}, ${t.days_late} days after the deadline.`, tone: "text-[#B83A26]" };
    case "missing":
      return { text: `The deadline (${t.extended_deadline || t.deadline}) has passed and no results are posted.`, tone: "text-[#B83A26]" };
    default:
      return { text: "", tone: "" };
  }
}

/** Paste a trial number, see its results clock: no wallet, no jargon. */
export function TrialLookup({ onPledge }: { onPledge: (nct: string) => void }) {
  const { pledges } = useRegistry();
  const [nct, setNct] = useState("");
  const [busy, setBusy] = useState(false);
  const [trial, setTrial] = useState<Lookup | null>(null);

  const check = async (id = nct) => {
    const n = id.trim().toUpperCase();
    setNct(n);
    if (!NCT_RE.test(n)) {
      setTrial({ nct: n, found: false, error: "A ClinicalTrials.gov number looks like NCT03548935." });
      return;
    }
    setBusy(true);
    try {
      setTrial(await (await fetch(`/api/trial?nct=${n}`)).json());
    } catch {
      setTrial({ nct: n, found: false, error: "Could not reach ClinicalTrials.gov. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  const backing = trial?.found ? pledges.filter((p) => p.nct === trial.nct && p.state === "active") : [];
  const line = trial?.found ? verdictLine(trial) : null;

  return (
    <div className="brand-card p-5 md:p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute left-3 top-3 text-muted-foreground" />
          <Input value={nct} onChange={(e) => setNct(e.target.value)} placeholder="Type a trial number, e.g. NCT03548935" className="h-11 pl-10 text-base mono" />
        </div>
        <Button type="submit" className="h-11 px-5" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check the trial"}
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        Try:
        {EXAMPLES.map((e) => (
          <button key={e.nct} type="button" className="mono text-[#0B7F70] hover:underline" onClick={() => check(e.nct)}>
            {e.nct} <span className="font-sans text-muted-foreground">({e.label})</span>
          </button>
        ))}
      </div>

      {trial && !trial.found && <p className="mt-4 text-sm text-[#B83A26]">{trial.error || `${trial.nct} is not on ClinicalTrials.gov.`}</p>}

      {trial?.found && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <a href={trialUrl(trial.nct)} target="_blank" rel="noopener noreferrer" className="mono text-sm text-[#0B7F70] inline-flex items-center gap-1 hover:underline">
                {trial.nct} <ExternalLink className="w-3 h-3" />
              </a>
              <h3 className="display text-xl font-semibold leading-snug">{trial.title}</h3>
              <p className="text-sm text-muted-foreground">Sponsor: {trial.lead_sponsor}</p>
            </div>
          </div>
          <Timeline
            completed={trial.status !== "not_completed"}
            completion={trial.completion}
            deadline={trial.deadline}
            extended={trial.extended_deadline}
            resultsPosted={trial.results_posted}
          />
          {line && <p className={`font-semibold ${line.tone}`}>{line.text}</p>}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Registered primary outcome{(trial.outcomes?.length ?? 0) === 1 ? "" : "s"} ({trial.outcomes?.length ?? 0})</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {trial.outcomes?.map((o, i) => (
                <li key={i}>
                  {o.measure} <span className="text-muted-foreground">({o.time_frame})</span>
                </li>
              ))}
            </ul>
          </details>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={() => onPledge(trial.nct)}>
              Back this trial with a pledge <ArrowRight className="w-4 h-4" />
            </Button>
            {backing.length > 0 && (
              <a href={`#${backing[0].id}`} className="text-sm text-[#0B7F70] hover:underline">
                {backing.length} active pledge{backing.length > 1 ? "s" : ""} below
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The clock uses a 12-month deadline and counts a delay certification filed before it, like US law. A pledge can set its own terms.
          </p>
        </div>
      )}
    </div>
  );
}
