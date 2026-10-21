"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MIN_PAYOUT_WEI, NCT_RE, REPORT_DAYS, dayMs, formatGen, parseGen, todayUtc, type TrialLookup } from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/useTrialPledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const twoYears = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 2);
  return d.toISOString().slice(0, 10);
};

/** Back a trial's transparency with GEN. Plain-language terms, checked here with the contract's rules. */
export function CreatePledgeModal({ open, onOpenChange, nct: initialNct }: { open: boolean; onOpenChange: (o: boolean) => void; nct: string }) {
  const { address, isConnected } = useWallet();
  const { writeAsync, pending } = usePledgeWrite();
  const [f, setF] = useState({ nct: initialNct, days: "365", honor: true, payout: "2", bond: "6", beneficiary: "", expires: twoYears() });
  const [trial, setTrial] = useState<TrialLookup | null>(null);

  useEffect(() => {
    if (open) setF((x) => ({ ...x, nct: initialNct || x.nct }));
  }, [open, initialNct]);

  useEffect(() => {
    const n = f.nct.trim().toUpperCase();
    if (!NCT_RE.test(n)) {
      setTrial(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/trial?nct=${n}`)
      .then((r) => r.json())
      .then((t) => !cancelled && setTrial(t))
      .catch(() => !cancelled && setTrial(null));
    return () => {
      cancelled = true;
    };
  }, [f.nct]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "honor" ? e.target.checked : e.target.value });
  const payout = parseGen(f.payout);
  const bond = parseGen(f.bond);
  const days = Number(f.days);
  // Same rule as the contract: coverage must outlive the latest results deadline plus the report period.
  const latest = trial?.completion && /^\d{4}-\d{2}/.test(trial.completion) && Number.isInteger(days)
    ? dayMs(trial.completion) + (f.honor ? Math.max(days, 730) : days) * 86_400_000
    : NaN;
  const minExpires = Number.isNaN(latest) ? "" : new Date(latest + REPORT_DAYS * 86_400_000).toISOString().slice(0, 10);
  // Start the end date at the earliest the contract accepts when the default is too early.
  useEffect(() => {
    if (minExpires && f.expires < minExpires) setF((x) => ({ ...x, expires: minExpires }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minExpires]);
  const problems = [
    !NCT_RE.test(f.nct.trim()) && "Enter a ClinicalTrials.gov number like NCT03548935.",
    trial && !trial.found && "That trial is not on ClinicalTrials.gov.",
    trial?.found && !trial.outcomes?.length && "That trial lists no primary outcome.",
    !(Number.isInteger(days) && days >= 30 && days <= 1095) && "The deadline must be 30 to 1095 days.",
    !(payout && payout >= MIN_PAYOUT_WEI) && "The payout must be at least 1 GEN.",
    !(bond && payout && bond >= 2n * payout) && "The bond must cover both promises: at least 2 × the payout.",
    trial?.found && !minExpires && "That trial lists no primary completion date, so no results deadline can be set.",
    minExpires && f.expires < minExpires && `The pledge must run until ${minExpires} or later: the latest results deadline plus ${REPORT_DAYS} days to report.`,
    !/^0x[0-9a-fA-F]{40}$/.test(f.beneficiary.trim()) && "Enter the beneficiary's wallet address.",
    f.expires < todayUtc() && "The pledge cannot expire in the past.",
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length || !payout || !bond) return;
    try {
      await writeAsync({
        kind: "create",
        bond,
        input: { nct: f.nct.trim().toUpperCase(), deadlineDays: days, honorDelayCert: f.honor, payout, beneficiary: f.beneficiary.trim(), expires: f.expires },
      });
      onOpenChange(false);
    } catch {
      // shown in the toast and the transactions panel
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="display text-2xl">Back a trial with a pledge</DialogTitle>
          <DialogDescription>
            Your GEN stands behind two promises: results on ClinicalTrials.gov on time, and a main paper that reports the primary outcome registered
            today. Validators freeze today&apos;s registered outcomes when you pledge.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label>Trial number</Label>
            <Input value={f.nct} onChange={set("nct")} placeholder="NCT03548935" className="mono" />
            {trial?.found && (
              <p className="text-xs text-muted-foreground">
                {trial.title} · {trial.lead_sponsor} · {trial.outcomes?.length ?? 0} registered primary outcome{trial.outcomes?.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Results due within (days of completion)</Label>
              <Input value={f.days} onChange={set("days")} inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label>Pledge open until</Label>
              <Input type="date" value={f.expires} onChange={set("expires")} />
              {minExpires && <p className="text-[11px] text-muted-foreground">Earliest: {minExpires} (latest results deadline + {REPORT_DAYS} days to report).</p>}
            </div>
            <div className="space-y-1">
              <Label>Payout per broken promise (GEN)</Label>
              <Input value={f.payout} onChange={set("payout")} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label>Bond (GEN)</Label>
              <Input value={f.bond} onChange={set("bond")} inputMode="decimal" />
              <p className="text-[11px] text-muted-foreground">At least 2 × payout, so both promises are always paid in full.</p>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.honor} onChange={set("honor")} className="mt-1" />
            <span>
              Count a <strong>delay certification</strong> filed before the deadline (US law allows up to two years after completion while a drug awaits
              approval). Untick for a stricter promise.
            </span>
          </label>
          <p className="rounded-lg bg-[#F3FAF8] px-3 py-2 text-xs text-muted-foreground">
            Your bond stays locked after the end date until the results promise has matured (results posted, or the deadline and {REPORT_DAYS} days to
            report have passed), checked again on ClinicalTrials.gov when you withdraw; at the latest three years after the end date. The publication
            promise is watched until the end date.
          </p>
          <div className="space-y-1">
            <Label>Beneficiary wallet</Label>
            <div className="flex gap-2">
              <Input value={f.beneficiary} onChange={set("beneficiary")} placeholder="0x… e.g. a patient group's fund" className="mono" />
              {address && <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, beneficiary: address })}>Use mine</Button>}
            </div>
          </div>
        </div>
        {problems.length > 0 && f.nct && (
          <ul className="text-xs text-[#B83A26] list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <Button onClick={submit} className="w-full" disabled={!isConnected || problems.length > 0 || pending === "create"}>
          {pending === "create" && <Loader2 className="w-4 h-4 animate-spin" />}
          {isConnected ? `Bond ${bond ? formatGen(bond) : "?"} GEN and pledge` : "Connect a wallet to pledge"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
