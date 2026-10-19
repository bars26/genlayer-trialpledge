"use client";

import { useState } from "react";
import { BookOpen, Clock, Loader2 } from "lucide-react";
import { DOI_RE, formatGen, normDoi, parseJson, stakeFor, type Claim, type Pledge, type TrialLookup } from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/useTrialPledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Paper = { found?: boolean; linked?: boolean; title?: string; journal?: string; year?: string; abstract_chars?: number; error?: string };

/** Report a broken promise: pick which one, see what the public data says, then stake and file. */
export function FileClaimModal({ pledge, claims, trial }: { pledge: Pledge; claims: Claim[]; trial?: TrialLookup }) {
  const { isConnected } = useWallet();
  const { writeAsync, pending } = usePledgeWrite();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"results" | "paper">("results");
  const [doi, setDoi] = useState("");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [checking, setChecking] = useState(false);
  const stake = stakeFor(pledge);
  const paid = parseJson<string[]>(pledge.paid_json, []);
  const key = kind === "results" ? "results" : `paper:${normDoi(doi)}`;
  const openClaim = claims.find((c) => c.state === "pending" && (c.kind === "results" ? "results" : `paper:${c.doi}`) === key);
  const blocked = paid.includes(key)
    ? "This has already been paid from this pledge."
    : openClaim
      ? `${openClaim.id} is already open for this; follow it on the card.`
      : kind === "results" && trial && (trial.status === "not_due" || trial.status === "not_completed")
        ? "Nothing is due yet: the contract would refund the claim."
        : "";
  const validDoi = kind === "results" || DOI_RE.test(doi.trim());

  const checkPaper = async () => {
    setChecking(true);
    setPaper(null);
    try {
      setPaper(await (await fetch(`/api/trial?nct=${pledge.nct}&doi=${encodeURIComponent(normDoi(doi))}`)).json());
    } catch {
      setPaper({ error: "Europe PMC could not be reached right now." });
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    try {
      await writeAsync({ kind: "file", pledgeId: pledge.id, claimKind: kind, doi: kind === "paper" ? normDoi(doi) : "" });
      setOpen(false);
      setDoi("");
      setPaper(null);
    } catch {
      // shown in the toast and the transactions panel
    }
  };

  const choice = (k: "results" | "paper", Icon: typeof Clock, title: string, body: string) => (
    <button
      type="button"
      onClick={() => setKind(k)}
      className={`rounded-xl border p-3 text-left transition ${kind === k ? "border-[#0F9D8A] bg-[#E3F5F2]" : "border-border hover:bg-muted/50"}`}
    >
      <span className="flex items-center gap-2 font-semibold"><Icon className="w-4 h-4 text-[#0F9D8A]" />{title}</span>
      <span className="block text-xs text-muted-foreground mt-1">{body}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Report a broken promise</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="display text-2xl">Which promise was broken?</DialogTitle>
          <DialogDescription>
            You stake <strong>{formatGen(stake)} GEN</strong>. If validators agree, you get it back plus <strong>{formatGen(stake)} GEN</strong>; if
            the promise was kept, your stake goes to the bond; if a source cannot be read, it comes back.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {choice("results", Clock, "Results are late", `Not posted on ClinicalTrials.gov within ${String(pledge.deadline_days)} days of completion.`)}
          {choice("paper", BookOpen, "The paper changed the outcome", "The main publication does not report the registered primary outcome as primary.")}
        </div>

        {kind === "paper" && (
          <div className="space-y-2">
            <Label htmlFor="doi">Publication DOI</Label>
            <div className="flex gap-2">
              <Input id="doi" value={doi} onChange={(e) => { setDoi(e.target.value); setPaper(null); }} placeholder="10.1056/NEJMoa2032183" className="mono" />
              <Button type="button" variant="secondary" disabled={!DOI_RE.test(doi.trim()) || checking} onClick={checkPaper}>
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
              </Button>
            </div>
            {paper && (
              <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1">
                {paper.error && <p className="text-[#B83A26]">{paper.error}</p>}
                {paper.found === false && <p className="text-[#B83A26]">Europe PMC has no record of this DOI; the claim would be ruled not covered.</p>}
                {paper.found && (
                  <>
                    <p className="font-medium">{paper.title}</p>
                    <p className="text-muted-foreground">{paper.journal} {paper.year}</p>
                    <p className={paper.linked ? "text-[#0B7F70]" : "text-[#B83A26]"}>
                      {paper.linked ? `Linked to ${pledge.nct} in Europe PMC.` : `Not linked to ${pledge.nct}: the claim would be ruled not covered.`}
                    </p>
                    {paper.linked && <p className="text-muted-foreground">Validators will compare its abstract ({paper.abstract_chars} characters) with the registered primary outcomes frozen in the pledge.</p>}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {kind === "results" && trial?.found && (
          <p className="text-xs text-muted-foreground">
            Registry today: completed {trial.completion || "—"}, results {trial.results_posted ? `posted ${trial.results_posted}` : "not posted"}
            {trial.delay_cert ? `, delay certification ${trial.delay_cert}` : ""}.
          </p>
        )}

        {blocked && <p className="text-xs text-[#A6640F]">{blocked}</p>}
        <Button className="w-full" onClick={submit} disabled={!isConnected || !validDoi || !!blocked || pending === `file:${pledge.id}`}>
          {pending === `file:${pledge.id}` && <Loader2 className="w-4 h-4 animate-spin" />}
          {isConnected ? `Stake ${formatGen(stake)} GEN and report` : "Connect a wallet to report"}
        </Button>
        <p className="text-xs text-muted-foreground">Validators read ClinicalTrials.gov and Europe PMC during the transaction; it usually takes 1 to 3 minutes.</p>
      </DialogContent>
    </Dialog>
  );
}
