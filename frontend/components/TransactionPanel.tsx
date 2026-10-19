"use client";

import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { usePledgeContract, WRITE_LABEL } from "@/lib/hooks/useTrialPledge";
import { useTxLog, updateTx, type TxEntry } from "@/lib/hooks/useTxLog";
import { EXPLORER_TX_URL } from "@/lib/utils/errors";
import { BUDGET, useRateBudget } from "@/lib/utils/rateBudget";
import { Button } from "./ui/button";

const STATE_LABEL: Record<TxEntry["state"], string> = {
  estimating: "Preparing",
  awaiting_wallet: "Waiting for wallet",
  confirming: "Waiting for validators",
  accepted: "Done",
  failed: "Failed",
};

const shortHash = (h: string) => `${h.slice(0, 10)}...${h.slice(-8)}`;

function TxRow({ tx }: { tx: TxEntry }) {
  const contract = usePledgeContract();
  const [checking, setChecking] = useState(false);
  const busy = tx.state === "estimating" || tx.state === "awaiting_wallet" || tx.state === "confirming";

  const checkFinality = async () => {
    if (!contract || !tx.txHash) return;
    setChecking(true);
    try {
      updateTx(tx.id, { status: await contract.getTransactionStatus(tx.txHash) });
    } catch {
      updateTx(tx.id, { progress: "Could not read the status right now (RPC busy). Try again in a moment." });
    } finally {
      setChecking(false);
    }
  };

  return (
    <li className="rounded-lg border border-border bg-[#FBFDFC] p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">
          {WRITE_LABEL[tx.kind]} <span className="mono text-xs text-muted-foreground">{tx.target}</span>
        </span>
        <span className={`flex items-center gap-1 text-xs whitespace-nowrap ${tx.state === "failed" ? "text-[#B42318]" : tx.state === "accepted" ? "text-[#0B7F70]" : "text-[#B45309]"}`}>
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {tx.state === "failed" && <AlertTriangle className="w-3 h-3" />}
          {tx.state === "accepted" && <CheckCircle2 className="w-3 h-3" />}
          {STATE_LABEL[tx.state]}
        </span>
      </div>

      {tx.progress && !tx.error && <p className="text-xs text-muted-foreground">{tx.progress}</p>}

      {tx.txHash && (
        <div className="flex items-center gap-2 text-xs mono text-muted-foreground">
          <span title={tx.txHash}>{shortHash(tx.txHash)}</span>
          <button type="button" aria-label="Copy transaction hash" className="hover:text-primary" onClick={() => navigator.clipboard?.writeText(tx.txHash!)}>
            <Copy className="w-3 h-3" />
          </button>
          <a href={EXPLORER_TX_URL(tx.txHash)} target="_blank" rel="noopener noreferrer" aria-label="Open transaction in the explorer" className="hover:text-primary">
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {tx.status && (
        <p className="text-xs">
          Consensus status: <strong>{tx.status}</strong>
          {tx.executionResult && (
            <>
              {" "}
              · contract execution: <strong>{tx.executionResult}</strong>
            </>
          )}
          {tx.status === "ACCEPTED" && <span className="text-muted-foreground"> · reads already reflect it; it finalizes after the appeal window.</span>}
        </p>
      )}

      {tx.txHash && tx.state !== "estimating" && (
        <Button type="button" size="sm" variant="secondary" onClick={checkFinality} disabled={checking}>
          {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : "Check finality"}
        </Button>
      )}

      {tx.error && (
        <div className="rounded-md border border-[#F4C7C1] bg-[#FDECEA] p-2 space-y-1 text-xs">
          <p className="font-semibold text-[#B42318]">{tx.error.message}</p>
          {tx.error.hint && <p>{tx.error.hint}</p>}
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Underlying error ({tx.error.kind}
              {tx.error.phase ? `, during ${tx.error.phase}` : ""})
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-words mono text-[11px] text-muted-foreground">{tx.error.detail}</pre>
          </details>
        </div>
      )}
    </li>
  );
}

/** Transaction log: hash, consensus status, contract outcome and the exact failure for every write. */
export function TransactionPanel() {
  const entries = useTxLog();
  const [used, waitMs] = useRateBudget().split("|").map(Number);

  return (
    <div className="brand-card p-5 space-y-3">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Your transactions
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Every write shows its hash and status here. <strong>ACCEPTED</strong> means validators reached consensus; the contract outcome (SUCCESS or ERROR) is
          shown separately, because a refused call is still ACCEPTED.
        </p>
        <p className="text-xs text-muted-foreground mt-2" title="GenLayer Studio allows 30 contract reads and sends per minute per IP; this app stays under its own budget.">
          Studio requests from this tab in the last minute: <strong className="text-foreground">{used}/{BUDGET}</strong>
          {waitMs > 0 && <span className="text-[#B45309]"> · next slot in {Math.ceil(waitMs / 1000)}s</span>}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. Connect a wallet, press Test GEN, then back a trial or report a broken promise.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((tx) => (
            <TxRow key={tx.id} tx={tx} />
          ))}
        </ul>
      )}
    </div>
  );
}
