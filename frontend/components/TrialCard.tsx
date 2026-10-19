"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { formatGen, outcomesOf, sameAddress, todayUtc, trialUrl, type Claim, type Pledge, type TrialLookup } from "@/lib/contracts/types";
import { formatAddress, useWallet } from "@/lib/genlayer/wallet";
import { usePledgeWrite } from "@/lib/hooks/useTrialPledge";
import { ClaimCard } from "./ClaimCard";
import { FileClaimModal } from "./FileClaimModal";
import { Timeline } from "./Timeline";
import { Button } from "./ui/button";

/** One pledge: the trial, its results clock under the pledge's own terms, the frozen outcomes and the claims. */
export function TrialCard({ pledge, claims }: { pledge: Pledge; claims: Claim[] }) {
  const { address } = useWallet();
  const { write, pending } = usePledgeWrite();
  const { data: trial } = useQuery<TrialLookup>({
    queryKey: ["trial", pledge.nct, String(pledge.deadline_days), pledge.honor_delay_cert],
    queryFn: async () => (await fetch(`/api/trial?nct=${pledge.nct}&days=${pledge.deadline_days}&honor=${pledge.honor_delay_cert ? 1 : 0}`)).json(),
    staleTime: 10 * 60_000,
  });
  const isPledger = sameAddress(pledge.pledger, address);
  const active = pledge.state === "active";
  const outcomes = outcomesOf(pledge);
  const open = claims.filter((c) => c.state === "pending");
  const done = claims.filter((c) => c.state !== "pending").reverse();

  return (
    <article className="brand-card overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-[#0F9D8A] via-[#3B6E8F] to-[#E0533D]" />
      <div className="p-5 md:p-6 space-y-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a href={trialUrl(pledge.nct)} target="_blank" rel="noopener noreferrer" className="mono font-semibold text-[#0B7F70] inline-flex items-center gap-1 hover:underline">
                {pledge.nct} <ExternalLink className="w-3 h-3" />
              </a>
              <span className="mono text-muted-foreground">{pledge.id}</span>
              {!active && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">closed</span>}
            </div>
            <h3 className="display text-xl font-semibold leading-snug mt-1">{pledge.title}</h3>
            <p className="text-sm text-muted-foreground">Sponsor on the registry: {pledge.lead_sponsor}</p>
          </div>
          <div className="text-right">
            <p className="display text-3xl font-semibold">{formatGen(pledge.bond)}<span className="text-sm font-sans font-medium text-muted-foreground"> GEN bonded</span></p>
            <p className="text-xs text-muted-foreground">pays {formatGen(pledge.payout)} GEN per broken promise</p>
          </div>
        </header>

        <div className="rounded-xl bg-[#F3FAF8] px-4 py-3 text-sm">
          <p className="font-medium">The promise</p>
          <p className="text-muted-foreground">
            ① Results on ClinicalTrials.gov within <strong className="text-foreground">{String(pledge.deadline_days)} days</strong> of primary completion
            {pledge.honor_delay_cert ? " (a delay certification filed in time extends it to two years)" : " (no extensions)"}. ② A main paper that reports
            the {outcomes.length} registered primary outcome{outcomes.length === 1 ? "" : "s"} as primary.
          </p>
        </div>

        {trial?.found ? (
          <Timeline
            completed={trial.status !== "not_completed"}
            completion={trial.completion}
            deadline={trial.deadline}
            extended={trial.extended_deadline}
            resultsPosted={trial.results_posted}
          />
        ) : (
          <div className="h-16 rounded-xl bg-muted/50 animate-pulse" />
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Registered primary outcomes, frozen at pledging ({outcomes.length})</summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {outcomes.map((o, i) => (
              <li key={i}>{o.measure} <span className="text-muted-foreground">({o.time_frame})</span></li>
            ))}
          </ul>
        </details>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>record: <strong className="text-[#0B7F70]">{String(pledge.n_kept)} kept</strong> · <strong className="text-[#B83A26]">{String(pledge.n_breached)} broken</strong> · {String(pledge.n_other)} other</span>
          <span>paid out <strong className="text-foreground">{formatGen(pledge.total_paid)} GEN</strong></span>
          <span>pledger <span className="mono">{formatAddress(pledge.pledger)}</span>{isPledger && " (you)"}</span>
          <span>beneficiary <span className="mono">{formatAddress(pledge.beneficiary)}</span></span>
          <span>open until {pledge.expires}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {active && todayUtc() <= pledge.expires && <FileClaimModal pledge={pledge} claims={claims} trial={trial} />}
          {isPledger && active && (
            <Button
              size="sm"
              variant="ghost"
              disabled={todayUtc() <= pledge.expires || open.length > 0 || pending === `withdraw:${pledge.id}`}
              title={todayUtc() <= pledge.expires ? `Locked until the pledge expires on ${pledge.expires}.` : open.length ? "Settle the open claims first." : ""}
              onClick={() => write({ kind: "withdraw", pledgeId: pledge.id })}
            >
              Withdraw bond
            </Button>
          )}
        </div>

        {claims.length > 0 && (
          <div className="space-y-2">
            {[...open, ...done].map((c) => <ClaimCard key={c.id} claim={c} pledge={pledge} />)}
          </div>
        )}
      </div>
    </article>
  );
}
