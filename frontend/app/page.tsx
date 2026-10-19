"use client";

import { useState } from "react";
import { BookOpenCheck, Clock3, HandCoins, Loader2, RefreshCw, Scale } from "lucide-react";
import { CreatePledgeModal } from "@/components/CreatePledgeModal";
import { Navbar } from "@/components/Navbar";
import { TransactionPanel } from "@/components/TransactionPanel";
import { TrialCard } from "@/components/TrialCard";
import { TrialLookup } from "@/components/TrialLookup";
import { Button } from "@/components/ui/button";
import { formatGen, wei } from "@/lib/contracts/types";
import { useRegistry } from "@/lib/hooks/useTrialPledge";

const STEPS = [
  { icon: HandCoins, title: "A sponsor pledges", body: "GEN is locked behind two promises about one trial: results on time, and the registered main outcome in the paper." },
  { icon: Clock3, title: "Anyone checks", body: "Paste the trial number. If a promise looks broken, report it by staking 10% of the payout." },
  { icon: Scale, title: "Validators decide", body: "Each GenLayer validator reads ClinicalTrials.gov and Europe PMC itself; every ruling comes with its reason." },
  { icon: BookOpenCheck, title: "Money follows", body: "A broken promise pays the beneficiary (say, a patient group) and rewards the reporter. A kept one keeps the stake." },
];

export default function HomePage() {
  const { pledges, claims, isLoading, isError, error, isFetching, refetch, fetchedAt } = useRegistry();
  const [modal, setModal] = useState<{ open: boolean; nct: string }>({ open: false, nct: "" });
  const ordered = [...pledges].sort((a, b) => Number(b.id.split("_")[1]) - Number(a.id.split("_")[1]));
  const bonded = pledges.filter((p) => p.state === "active").reduce((t, p) => t + wei(p.bond), 0n);
  const paidOut = claims.filter((c) => c.outcome === "paid").length;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onPledge={() => setModal({ open: true, nct: "" })} />
      <main className="flex-grow pt-24 pb-12 px-4 md:px-6">
        <div className="max-w-6xl mx-auto space-y-10">
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-4 lg:pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0B7F70]">Clinical-trial transparency, with money on it</p>
              <h1 className="display text-4xl md:text-5xl font-semibold leading-[1.05]">Did the trial keep its promise?</h1>
              <p className="text-lg text-muted-foreground">
                Many clinical trials post their results late or never, and some papers quietly swap the outcome they promised to measure. On
                TrialPledge a sponsor puts GEN behind both promises, and GenLayer validators check the public record themselves.
              </p>
              <dl className="flex gap-6 pt-1">
                <div><dt className="text-xs text-muted-foreground">GEN bonded</dt><dd className="display text-2xl font-semibold">{formatGen(bonded, 1)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">trials backed</dt><dd className="display text-2xl font-semibold">{new Set(pledges.map((p) => p.nct)).size}</dd></div>
                <div><dt className="text-xs text-muted-foreground">broken promises paid</dt><dd className="display text-2xl font-semibold">{paidOut}</dd></div>
              </dl>
            </div>
            <div className="lg:col-span-7">
              <TrialLookup onPledge={(nct) => setModal({ open: true, nct })} />
            </div>
          </section>

          <section>
            <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rounded-2xl border border-border bg-white/70 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0F2A3D] text-xs font-semibold text-white">{i + 1}</span>
                    <Icon className="w-4 h-4 text-[#0F9D8A]" />
                    <span className="font-semibold">{title}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Browsing and checking need no wallet. To pledge or report, connect MetaMask and press Test GEN for free GenLayer Studio tokens. The pledges
              below are demo pledges made by test wallets, not by the trials&apos; sponsors.
            </p>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="display text-2xl font-semibold">Backed trials</h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {fetchedAt && <span>updated {new Date(fetchedAt).toLocaleTimeString()}</span>}
                  <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
                    {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              {isLoading && <p className="text-sm text-muted-foreground">Reading the pledges from GenLayer Studio…</p>}
              {isError && <p className="rounded-xl border border-[#F6C6BC] bg-[#FDEAE6] p-3 text-sm">Could not read the pledges: {error?.message}. Try Refresh in a minute.</p>}
              {!isLoading && !isError && ordered.length === 0 && <p className="text-sm text-muted-foreground">No trial is backed yet. Check one above and be the first.</p>}
              {ordered.map((p) => (
                <div id={p.id} key={p.id}>
                  <TrialCard pledge={p} claims={claims.filter((c) => c.pledge_id === p.id)} />
                </div>
              ))}
            </div>
            <aside className="lg:col-span-4 space-y-6">
              <div className="brand-card p-5 space-y-3 text-sm">
                <h3 className="display text-lg font-semibold">How a ruling is made</h3>
                <p><strong>Results on time?</strong> Decided in code from ClinicalTrials.gov: primary completion (must be actual), results first-posted date, and a delay certification if the pledge counts it.</p>
                <p><strong>Outcome as registered?</strong> Code first checks Europe PMC links the paper to the trial and has an abstract. Then validators compare the abstract with the primary outcomes frozen in the pledge: main report as registered, outcome changed, or not the main report.</p>
                <p><strong>Fair play.</strong> Only the side a ruling goes against can ask for a second look, once, within 10 minutes. Nobody can rush a payout in their own favour. If a source is down, nothing is decided and the stake comes back.</p>
              </div>
              <TransactionPanel />
            </aside>
          </section>
        </div>
      </main>
      <footer className="border-t border-border py-4 text-center text-sm text-muted-foreground">
        Data: <a href="https://clinicaltrials.gov" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">ClinicalTrials.gov</a> and{" "}
        <a href="https://europepmc.org" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Europe PMC</a>
        {" · "}
        <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Built on GenLayer</a>
        {" · "}
        <a href="https://github.com/bars26/genlayer-trialpledge" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Source</a>
        {" · "}Not medical advice; rulings are about registry and publication records only.
      </footer>
      <CreatePledgeModal open={modal.open} nct={modal.nct} onOpenChange={(open) => setModal((m) => ({ ...m, open }))} />
    </div>
  );
}
