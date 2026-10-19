"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import TrialPledge, { type CreatePledgeInput, type TxProgress, type TxResult } from "../contracts/TrialPledge";
import { sameAddress, stakeFor, todayUtc, windowLeftSeconds, wei, VERDICT_STYLE, type Claim, type ClaimKind, type Pledge, type Verdict } from "../contracts/types";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import { useWallet } from "../genlayer/wallet";
import { PledgeError, classifyError } from "../utils/errors";
import { error, success } from "../utils/toast";
import { startTx, updateTx, type TxKind } from "./useTxLog";

export function usePledgeContract(): TrialPledge | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const studioUrl = getStudioUrl();
  return useMemo(
    () => (contractAddress ? new TrialPledge(contractAddress, address, studioUrl) : null),
    [contractAddress, address, studioUrl]
  );
}

type Registry = { pledges: Pledge[]; claims: Claim[]; fetchedAt?: string };

async function fetchJson(url: string, timeoutMs = 25_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

/**
 * Every pledge and claim, from the CDN-cached server snapshot (app/api/registry), so page
 * loads spend none of the visitor's Studio rate-limit budget. Falls back to two direct reads.
 */
export function useRegistry() {
  const contract = usePledgeContract();
  const query = useQuery<Registry, Error>({
    queryKey: ["registry"],
    queryFn: async () => {
      try {
        const body = await fetchJson("/api/registry");
        if (!Array.isArray(body.pledges) || !Array.isArray(body.claims)) throw new Error("Malformed snapshot");
        return body as Registry;
      } catch (snapshotErr) {
        if (!contract) throw classifyError(snapshotErr, "read");
        const [pledges, claims] = await Promise.all([contract.getPledges(), contract.getClaims()]);
        return { pledges, claims, fetchedAt: new Date().toISOString() };
      }
    },
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  return {
    pledges: query.data?.pledges ?? [],
    claims: query.data?.claims ?? [],
    fetchedAt: query.data?.fetchedAt,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Re-read what a write touched and merge it into the cached registry. */
async function mergeFresh(qc: ReturnType<typeof useQueryClient>, contract: TrialPledge, pledgeId?: string, claimId?: string) {
  try {
    const [pledge, claim] = await Promise.all([
      pledgeId ? contract.getPledge(pledgeId) : Promise.resolve(null),
      claimId ? contract.getClaim(claimId) : Promise.resolve(null),
    ]);
    qc.setQueryData<Registry>(["registry"], (prev) => {
      let pledges = prev?.pledges ?? [];
      let claims = prev?.claims ?? [];
      if (pledge) pledges = pledges.some((p) => p.id === pledge.id) ? pledges.map((p) => (p.id === pledge.id ? pledge : p)) : [...pledges, pledge];
      if (claim) claims = claims.some((c) => c.id === claim.id) ? claims.map((c) => (c.id === claim.id ? claim : c)) : [...claims, claim];
      return { pledges, claims, fetchedAt: prev?.fetchedAt };
    });
  } catch {
    // Already confirmed on chain; the next snapshot refresh picks it up.
  }
}

export type WriteVars =
  | { kind: "create"; input: CreatePledgeInput; bond: bigint }
  | { kind: "bond"; pledgeId: string; value: bigint }
  | { kind: "file"; pledgeId: string; claimKind: ClaimKind; doi: string }
  | { kind: "contest"; claimId: string; statementUrl: string }
  | { kind: "settle"; claimId: string }
  | { kind: "withdraw"; pledgeId: string };

export const WRITE_LABEL: Record<TxKind, string> = {
  create: "Create pledge",
  bond: "Add to bond",
  file: "Report a broken promise",
  contest: "Contest",
  settle: "Settle",
  withdraw: "Withdraw bond",
};

const verdictNote = (v: unknown) => {
  const s = VERDICT_STYLE[String(v) as Verdict];
  return s ? `Ruling: ${s.label}. ${s.help}` : "Recorded.";
};

/** One mutation for every TrialPledge write, with a transaction log entry and typed errors. */
export function usePledgeWrite() {
  const contract = usePledgeContract();
  const { address } = useWallet();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (vars: WriteVars) => {
      const target =
        vars.kind === "create"
          ? vars.input.nct
          : vars.kind === "file"
            ? `${vars.pledgeId} ${vars.claimKind === "results" ? "results" : vars.doi}`
            : "claimId" in vars
              ? vars.claimId
              : vars.pledgeId;
      const logId = startTx(vars.kind, target);
      setPending(vars.kind === "create" ? "create" : `${vars.kind}:${"claimId" in vars ? vars.claimId : vars.pledgeId}`);
      const onProgress = (p: TxProgress) =>
        updateTx(logId, {
          state: p.step === "awaiting_wallet" ? "awaiting_wallet" : p.step === "accepted" ? "accepted" : "confirming",
          txHash: p.txHash,
          progress: p.message,
        });
      const refuse = (message: string): never => {
        throw new PledgeError({ kind: "contract_revert", phase: "estimate", message, hint: "The data was refreshed; nothing was sent." });
      };
      try {
        if (!contract) throw new PledgeError({ kind: "unknown", phase: "send", message: "The contract address is not configured." });
        if (!address) throw new PledgeError({ kind: "wallet_missing", phase: "send", message: "No wallet is connected." });

        let result: TxResult;
        let pledgeId = "pledgeId" in vars ? vars.pledgeId : undefined;
        let claimId = "claimId" in vars ? vars.claimId : undefined;
        let note = "Done.";
        // Re-read right before sending, so a stale list never sends a call the contract would refuse.
        switch (vars.kind) {
          case "create":
            result = await contract.createPledge(vars.input, vars.bond, onProgress);
            pledgeId = typeof result.returned === "string" ? result.returned : undefined;
            note = pledgeId ? `Pledge ${pledgeId} is live.` : "Pledge created.";
            break;
          case "bond": {
            const p = await contract.getPledge(vars.pledgeId);
            if (!sameAddress(p.pledger, address)) refuse("Only the pledger can add to this bond.");
            if (p.state !== "active") refuse("This pledge is closed.");
            result = await contract.addBond(vars.pledgeId, vars.value, onProgress);
            break;
          }
          case "file": {
            const p = await contract.getPledge(vars.pledgeId);
            if (p.state !== "active") refuse("This pledge is closed.");
            if (wei(p.bond) === 0n) refuse("This pledge has no bond left.");
            if (todayUtc() > p.expires) refuse(`This pledge expired on ${p.expires}.`);
            result = await contract.fileClaim(vars.pledgeId, vars.claimKind, vars.doi, stakeFor(p), onProgress);
            claimId = typeof result.returned === "string" ? result.returned : undefined;
            if (claimId) {
              const c = await contract.getClaim(claimId);
              note = `${claimId}: ${verdictNote(c.verdict)}`;
            }
            break;
          }
          case "contest": {
            const c = await contract.getClaim(vars.claimId);
            const p = await contract.getPledge(c.pledge_id);
            pledgeId = p.id;
            if (c.state !== "pending") refuse("This claim is already settled.");
            if (windowLeftSeconds(c) === 0) refuse("The response window has closed; the claim can only be settled now.");
            const mine = c.verdict === "BREACHED" ? sameAddress(p.pledger, address) && !c.pledger_contested : sameAddress(c.claimant, address) && !c.claimant_contested;
            if (!mine) refuse("This ruling does not go against you, or your side has already contested it.");
            result = await contract.contest(vars.claimId, vars.statementUrl, onProgress);
            note = `Re-assessed: ${verdictNote(result.returned)} The response window restarted.`;
            break;
          }
          case "settle": {
            const c = await contract.getClaim(vars.claimId);
            const p = await contract.getPledge(c.pledge_id);
            pledgeId = p.id;
            if (c.state !== "pending") refuse("This claim is already settled.");
            if (windowLeftSeconds(c) > 0) {
              if (c.verdict === "BREACHED" && !sameAddress(p.pledger, address)) refuse("Until the window ends, only the pledger can concede a breach.");
              if (c.verdict !== "BREACHED" && !sameAddress(c.claimant, address)) refuse("Until the window ends, only the reporter can accept this ruling.");
            }
            result = await contract.settle(vars.claimId, onProgress);
            note =
              result.returned === "paid"
                ? "The breach was paid from the bond: 90% to the beneficiary, 10% plus the stake to the reporter."
                : result.returned === "stake_returned"
                  ? "The reporter's stake was returned."
                  : "The reporter's stake was added to the bond.";
            break;
          }
          case "withdraw": {
            const p = await contract.getPledge(vars.pledgeId);
            if (!sameAddress(p.pledger, address)) refuse("Only the pledger can withdraw the bond.");
            if (todayUtc() <= p.expires) refuse(`The bond stays locked until the pledge expires on ${p.expires}.`);
            if (wei(p.pending) > 0n) refuse("Settle the open claims first.");
            result = await contract.withdraw(vars.pledgeId, onProgress);
            break;
          }
        }
        updateTx(logId, { state: "accepted", txHash: result.txHash, status: result.status, executionResult: result.executionResult, progress: note });
        return { pledgeId, claimId, txHash: result.txHash, kind: vars.kind, note };
      } catch (err) {
        const e = classifyError(err, "send");
        if (contract) mergeFresh(qc, contract, "pledgeId" in vars ? vars.pledgeId : undefined, "claimId" in vars ? vars.claimId : undefined);
        updateTx(logId, {
          state: "failed",
          txHash: e.txHash,
          error: { kind: e.kind, message: e.message, hint: e.hint, detail: e.detail, phase: e.phase },
        });
        error(`${WRITE_LABEL[vars.kind]} failed`, { description: [e.message, e.hint].filter(Boolean).join(" "), duration: 12000 });
        throw err;
      } finally {
        setPending(null);
      }
    },
    onSuccess: ({ pledgeId, claimId, txHash, kind, note }) => {
      if (contract) mergeFresh(qc, contract, pledgeId, claimId);
      qc.invalidateQueries({ queryKey: ["genBalance"] });
      success(`${WRITE_LABEL[kind]} confirmed`, {
        description: `${note} Tx ${txHash.slice(0, 10)}... is ACCEPTED by validator consensus.`,
        duration: 9000,
      });
    },
  });

  return { write: mutation.mutate, writeAsync: mutation.mutateAsync, pending, isPending: mutation.isPending };
}
