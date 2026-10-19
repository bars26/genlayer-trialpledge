import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Claim, Pledge } from "./types";
import { PledgeError, classifyError, rawMessage } from "../utils/errors";
import { withBackoff } from "../utils/retry";
import { takeSlot } from "../utils/rateBudget";

export type TxStep = "awaiting_wallet" | "submitted" | "retrying" | "accepted";

export interface TxProgress {
  step: TxStep;
  txHash?: string;
  message?: string;
}

export interface TxResult {
  txHash: string;
  status: string;
  executionResult: string;
  receipt: any;
  /** The contract method's return value (pledge id, claim id, verdict, outcome, ...). */
  returned?: unknown;
}

/**
 * Pull the contract-execution outcome out of a consensus receipt.
 *   result.status "rollback" -> the contract raised; payload is its message.
 *   result.status "return"   -> payload.readable is the JSON-encoded return value.
 */
export function executionOutcome(receipt: any): { result: string; message: string; returned: unknown } {
  const lr = receipt?.consensus_data?.leader_receipt;
  const first = Array.isArray(lr) ? lr[0] : lr;
  const result = String(first?.execution_result ?? receipt?.execution_result ?? "UNKNOWN");
  const r = first?.result ?? {};
  let returned: unknown = undefined;
  if (r?.status === "return") {
    const readable = r?.payload?.readable;
    try {
      returned = typeof readable === "string" ? JSON.parse(readable) : readable;
    } catch {
      returned = readable;
    }
  }
  const g = first?.genvm_result ?? {};
  const message = [
    r?.status === "rollback" && typeof r?.payload === "string" ? r.payload : "",
    g.error_description,
    g.stderr,
    Array.isArray(g.raw_error?.causes) ? g.raw_error.causes.join(",") : "",
  ]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join(" | ");
  return { result, message, returned };
}

const WRITE_EFFECT: Record<string, string> = {
  create_pledge: "no pledge was created",
  add_bond: "the bond was not changed",
  file_claim: "no claim was recorded (validators may have failed to read the registry or to agree)",
  contest: "the contest was not recorded",
  settle: "nothing was paid or returned",
  withdraw: "the bond was not withdrawn",
};

export interface CreatePledgeInput {
  nct: string;
  deadlineDays: number;
  honorDelayCert: boolean;
  payout: bigint;
  beneficiary: string;
  expires: string;
}

/** Typed wrapper around the TrialPledge Intelligent Contract. */
class TrialPledge {
  private contractAddress: `0x${string}`;
  private client: any;

  constructor(contractAddress: string, address?: string | null, studioUrl?: string) {
    this.contractAddress = contractAddress as `0x${string}`;
    const config: any = { chain: studionet };
    if (address) config.account = address as `0x${string}`;
    if (studioUrl) config.endpoint = studioUrl;
    this.client = createClient(config);
  }

  private read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    // Every attempt is a gen_call, so each one draws on the client-side rate budget.
    return withBackoff(
      async () => {
        await takeSlot();
        return (await this.client.readContract({ address: this.contractAddress, functionName, args })) as T;
      },
      { phase: "read", attempts: 5 }
    );
  }

  getPledge = (id: string) => this.read<Pledge>("get_pledge", [id]);
  getClaim = (id: string) => this.read<Claim>("get_claim", [id]);
  /** The whole registry in one contract call each (pages of 200). */
  getPledges = (offset = 0, limit = 200) => this.read<Pledge[]>("get_pledges", [offset, limit]).then((v) => (Array.isArray(v) ? v : []));
  getClaims = (offset = 0, limit = 200) => this.read<Claim[]>("get_claims", [offset, limit]).then((v) => (Array.isArray(v) ? v : []));

  async getTransactionStatus(txHash: string): Promise<string> {
    const tx: any = await withBackoff(() => this.client.getTransaction({ hash: txHash as `0x${string}` }), { phase: "read" });
    return String(tx?.statusName ?? tx?.status_name ?? tx?.status ?? "UNKNOWN");
  }

  createPledge(p: CreatePledgeInput, bondWei: bigint, onProgress?: (p: TxProgress) => void) {
    return this.write(
      "create_pledge",
      [p.nct, p.deadlineDays, p.honorDelayCert, p.payout, p.beneficiary, p.expires],
      bondWei,
      onProgress
    );
  }
  addBond(id: string, valueWei: bigint, onProgress?: (p: TxProgress) => void) {
    return this.write("add_bond", [id], valueWei, onProgress);
  }
  fileClaim(id: string, kind: "results" | "paper", doi: string, stakeWei: bigint, onProgress?: (p: TxProgress) => void) {
    return this.write("file_claim", [id, kind, doi], stakeWei, onProgress);
  }
  contest(claimId: string, statementUrl: string, onProgress?: (p: TxProgress) => void) {
    return this.write("contest", [claimId, statementUrl], 0n, onProgress);
  }
  settle(claimId: string, onProgress?: (p: TxProgress) => void) {
    return this.write("settle", [claimId], 0n, onProgress);
  }
  withdraw(id: string, onProgress?: (p: TxProgress) => void) {
    return this.write("withdraw", [id], 0n, onProgress);
  }

  /**
   * Send a write and wait for consensus. Sends are never auto-retried (each attempt would
   * prompt the wallet again); receipt polling is, because the hash is already known.
   * A call the contract reverted is still ACCEPTED by consensus, so the receipt's
   * execution_result is checked and a revert is reported as such.
   */
  private async write(functionName: string, args: unknown[], value: bigint, onProgress?: (p: TxProgress) => void): Promise<TxResult> {
    // A send counts against the same per-IP bucket as contract reads; wait for a slot first
    // rather than let Studio answer with a rate-limit error after the wallet prompt.
    await takeSlot((ms) =>
      onProgress?.({ step: "retrying", message: `Waiting ${Math.ceil(ms / 1000)}s to stay under GenLayer Studio's 30 requests per minute.` })
    );
    onProgress?.({ step: "awaiting_wallet", message: "Approve the transaction in your wallet." });
    let txHash: string;
    try {
      txHash = (await this.client.writeContract({ address: this.contractAddress, functionName, args, value })) as string;
    } catch (err) {
      throw classifyError(err, "send");
    }
    onProgress?.({ step: "submitted", txHash, message: "Transaction sent. Validators are reading ClinicalTrials.gov and Europe PMC." });

    let receipt: any;
    try {
      receipt = await withBackoff(
        () => this.client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED" as any, retries: 60, interval: 5000 }),
        {
          phase: "confirm",
          onRetry: (i) => onProgress?.({ step: "retrying", txHash, message: `RPC busy while confirming; retrying in ${Math.round(i.waitMs / 1000)}s` }),
        }
      );
    } catch (err) {
      throw classifyError(err, "confirm", txHash);
    }

    const status = String(receipt?.statusName ?? receipt?.status_name ?? "ACCEPTED");
    const outcome = executionOutcome(receipt);
    onProgress?.({ step: "accepted", txHash, message: `Consensus status: ${status}` });
    // Payable methods refuse by refunding and returning "REFUNDED: <reason>" instead of reverting,
    // because GenLayer keeps a reverted call's value in the contract.
    if (typeof outcome.returned === "string" && outcome.returned.startsWith("REFUNDED:")) {
      throw new PledgeError({
        kind: "contract_revert",
        phase: "verify",
        txHash,
        message: `The contract refused this call and is sending your GEN back: ${outcome.returned.slice(9).trim()}`,
        hint: "Nothing changed. The refund lands in your wallet once the transaction finalizes.",
        detail: String(outcome.returned),
      });
    }
    if (outcome.result === "ERROR") {
      throw new PledgeError({
        kind: "accepted_no_effect",
        phase: "verify",
        txHash,
        message: `The transaction was ACCEPTED, but the contract rejected the call, so ${WRITE_EFFECT[functionName] ?? "nothing changed"}.`,
        hint: outcome.message ? `Contract message: ${outcome.message}` : "Open the transaction in the explorer for details.",
        detail: outcome.message || rawMessage(receipt?.result) || "execution_result: ERROR",
      });
    }
    return { txHash, status, executionResult: outcome.result, receipt, returned: outcome.returned };
  }
}

export default TrialPledge;
