"use client";

import { useState } from "react";
import { BookOpen, Clock, Loader2 } from "lucide-react";
import { DOI_RE, formatGen, normDoi, parseJson, stakeFor, todayUtc, type Claim, type Pledge, type TrialLookup } from "@/lib/contracts/types";
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
  // The same rules the contract applies; a claim it would refund is blocked here with the reason.
  const paid = parseJson<string[]>(pledge.paid_json, []);
  const resolved = parseJson<string[]>(pledge.resolved_json, []);
  const ruled = parseJson<string[]>(pledge.ruled_dois_json, []);
  const d = normDoi(doi);
  const openClaim = claims.find((c) => c.state === "pending" && c.kind === kind);
  const blocked = paid.includes(kind)
    ? "This promise has already been paid from this pledge (each promise pays once)."
    : resolved.includes(kind)
      ? "This promise has already been ruled kept."
      : openClaim
        ? `${openClaim.id} is already open for this promise; follow it on the card.`
        : kind === "paper" && todayUtc() > pledge.expires
          ? `The publication promise was covered until ${pledge.expires}.`
          : kind === "paper" && pledge.main_doi && d && d !== pledge.main_doi
            ? `Validators already identified the main results report as ${pledge.main_doi}; the publication promise covers that one paper.`
            : kind === "paper" && d && ruled.includes(d)
              ? `${d} has already been ruled on for this pledge.`
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
                {paper.found === false && (
                  <p className="text-[#A6640F]">
                    Europe PMC has no record of this DOI. If doi.org knows it, validators treat that as an indexing delay and your stake comes back;
                    if the DOI does not exist, the claim is ruled not covered.
                  </p>
                )}
                {paper.found && (
                  <>
                    <p className="font-medium">{paper.title}</p>
                    <p className="text-muted-foreground">{paper.journal} {paper.year}</p>
                    <p className={paper.linked ? "text-[#0B7F70]" : "text-[#B83A26]"}>
                      {paper.linked ? `Linked to ${pledge.nct} in Europe PMC.` : `Not linked to ${pledge.nct}: the claim would be ruled not covered.`}
                    </p>
                    {paper.linked && (
                      <p className="text-muted-foreground">
                        Validators will compare its abstract ({paper.abstract_chars} characters) with the registered primary outcomes frozen in the pledge.
                        A kept or broken ruling needs the abstract to name its primary outcome; otherwise nothing is decided and your stake comes back.
                      </p>
                    )}
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
