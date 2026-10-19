"use client";

import { useSyncExternalStore } from "react";

export type TxKind = "create" | "bond" | "file" | "contest" | "settle" | "withdraw";
export type TxState = "estimating" | "awaiting_wallet" | "confirming" | "accepted" | "failed";

export interface TxEntry {
  id: string;
  kind: TxKind;
  /** The package being pledged, or the pledge / claim id acted on. */
  target: string;
  state: TxState;
  txHash?: string;
  /** Consensus status as last observed (ACCEPTED, FINALIZED, ...). */
  status?: string;
  /** What the contract did: SUCCESS or ERROR. */
  executionResult?: string;
  progress?: string;
  error?: { kind: string; message: string; hint?: string; detail: string; phase?: string };
  startedAt: number;
}

const MAX_ENTRIES = 6;
let entries: TxEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  entries = [...entries];
  listeners.forEach((l) => l());
}

export function startTx(kind: TxKind, target: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: TxEntry = { id, kind, target, state: "estimating", startedAt: Date.now() };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
  return id;
}

export function updateTx(id: string, patch: Partial<TxEntry>) {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  emit();
}

export function useTxLog(): TxEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => entries,
    () => entries
  );
}
