"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  CODE_LABEL,
  OUTCOME_TEXT,
  VERDICT_STYLE,
  doiUrl,
  factsOf,
  formatGen,
  sameAddress,
  timelineOf,
  windowLeftSeconds,
  type Claim,
  type Pledge,
} from "@/lib/contracts/types";
import { formatAddress, useWallet } from "@/lib/genlayer/wallet";
import { useNow } from "@/lib/hooks/useNow";
import { usePledgeWrite } from "@/lib/hooks/useTrialPledge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** One claim: the ruling, its reason, what was read, its timeline and what you can do now. */
export function ClaimCard({ claim, pledge }: { claim: Claim; pledge: Pledge }) {
  const { address } = useWallet();
  const { write, pending } = usePledgeWrite();
  const now = useNow(1000);
  const [statement, setStatement] = useState("");
  const f = factsOf(claim);
  const steps = timelineOf(claim);
  const left = windowLeftSeconds(claim, now);
  const open = claim.state === "pending";
  const breach = claim.verdict === "BREACHED";
  const isPledger = sameAddress(pledge.pledger, address);
  const isReporter = sameAddress(claim.claimant, address);
  const canContest = open && left > 0 && (breach ? isPledger && !claim.pledger_contested : isReporter && !claim.claimant_contested);
  const canSettle = open && (left === 0 || (breach ? isPledger : isReporter));
  const busy = pending === `contest:${claim.id}` || pending === `settle:${claim.id}`;
  const v = VERDICT_STYLE[claim.verdict];

  return (
    <div className="rounded-xl border border-border bg-[#FBFDFC] p-4 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${v?.cls}`} title={v?.help}>{v?.label}</span>
        <span className="font-medium">{claim.kind === "results" ? "Results on time?" : "Primary outcome as registered?"}</span>
        {claim.kind === "paper" && (
          <a href={doiUrl(claim.doi)} target="_blank" rel="noopener noreferrer" className="mono text-xs text-[#0B7F70] inline-flex items-center gap-1 hover:underline">
            {claim.doi} <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <span className="text-xs text-muted-foreground">{CODE_LABEL[claim.code] ?? claim.code}</span>
        <span className="ml-auto text-xs mono text-muted-foreground">{claim.id}</span>
      </div>

      <p className="leading-relaxed">
        <span className="font-semibold">Why: </span>
        {claim.why}
      </p>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What the validators read</summary>
        {claim.kind === "results" ? (
          <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            <Fact k="Primary completion" v={`${f.completion || "—"} (${(f.completion_type || "?").toLowerCase()})`} />
            <Fact k="Results first posted" v={f.results_posted || "none"} />
            <Fact k="Delay certification" v={f.delay_cert || "none"} />
            <Fact k="Deadline used" v={`${f.deadline || "—"}${f.cert_extended ? " (extended)" : ""}`} />
            <Fact k="Days late" v={f.days_late != null ? String(f.days_late) : "—"} />
            <Fact k="Source" v="ClinicalTrials.gov API v2" />
          </dl>
        ) : (
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <Fact k="Paper" v={f.paper_title || "—"} />
            <Fact k="Registered primary outcomes compared" v={String(f.outcome_count ?? "—")} />
            <Fact k="Validators' answer" v={f.answer || "not asked (decided in code)"} />
            <Fact k="Source" v="Europe PMC (title, abstract, registry link)" />
          </dl>
        )}
        {claim.statement_url && (
          <p className="mt-2">
            Pledger&apos;s statement: <a href={claim.statement_url} target="_blank" rel="noopener noreferrer" className="mono text-[#0B7F70] break-all hover:underline">{claim.statement_url}</a>
          </p>
        )}
      </details>

      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0F9D8A]" />
            <span className="mono">{s.at.slice(5, 16).replace("T", " ")}</span>
            <span className="text-foreground">
              {s.event === "filed" && `reported by ${formatAddress(claim.claimant)} → ${s.verdict}`}
              {s.event === "contested" && `${s.by} asked for a second look: ${s.before} → ${s.verdict}`}
              {s.event === "settled" &&
                (s.outcome === "paid"
                  ? `paid ${formatGen(s.beneficiary)} GEN to the beneficiary, ${formatGen(s.reporter)} GEN + stake to the reporter`
                  : OUTCOME_TEXT[s.outcome ?? ""] ?? "settled")}
            </span>
          </li>
        ))}
      </ol>

      {open && (
        <p className="text-xs text-[#A6640F]">
          {left > 0
            ? `Response window: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left. ${breach ? "Only the pledger can contest or concede now." : "Only the reporter can contest or accept now."} After it, anyone can settle.`
            : "The response window is over: anyone can settle."}
        </p>
      )}

      {(canContest || canSettle) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canContest && breach && claim.kind === "paper" && (
            <Input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Optional https:// link explaining the outcome change" className="h-8 text-xs flex-1 min-w-[16rem]" />
          )}
          {canContest && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => write({ kind: "contest", claimId: claim.id, statementUrl: breach ? statement.trim() : "" })}>
              {pending === `contest:${claim.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              Ask for a second look
            </Button>
          )}
          {canSettle && (
            <Button size="sm" disabled={busy} onClick={() => write({ kind: "settle", claimId: claim.id })}>
              {pending === `settle:${claim.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              {left > 0 ? (breach ? "Concede and pay now" : "Accept the ruling now") : "Settle"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="mono break-words">{v}</dd>
    </div>
  );
}
