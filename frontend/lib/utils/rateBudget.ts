"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side budget for GenLayer Studio's per-IP rate limit.
 *
 * Studio allows 30 requests per minute per IP for the expensive methods (`gen_call`, i.e.
 * contract reads, and `eth_sendRawTransaction`/`eth_sendTransaction`). Receipt polling,
 * balances and fee estimates sit in a separate, much larger bucket. This app keeps its own
 * sliding-window count of the expensive calls it makes and stays under BUDGET, so a visitor
 * clicking quickly never gets a 429; when the budget is spent, calls wait for a free slot
 * and the transactions panel says how long.
 *
 * Page loads do not draw on this budget at all: the pool list and GDACS alerts come from the
 * app's CDN-cached server routes, and the server reads every pool with one `get_pools` call.
 */
const WINDOW_MS = 60_000;
export const BUDGET = 24; // of Studio's 30, leaving room for other tabs and the wallet

let stamps: number[] = [];
let waitingUntil = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function prune(now: number) {
  stamps = stamps.filter((t) => now - t < WINDOW_MS);
}

/** Wait (if needed) for a slot, then record the call. `onWait` reports the delay in ms. */
export async function takeSlot(onWait?: (ms: number) => void): Promise<void> {
  for (;;) {
    const now = Date.now();
    prune(now);
    if (stamps.length < BUDGET) {
      stamps.push(now);
      emit();
      return;
    }
    const waitMs = WINDOW_MS - (now - stamps[0]) + 50;
    waitingUntil = now + waitMs;
    emit();
    onWait?.(waitMs);
    await new Promise((r) => setTimeout(r, waitMs));
    waitingUntil = 0;
  }
}

/** Calls used in the last minute, and how long until a slot frees up when the budget is spent. */
export function useRateBudget() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const t = setInterval(cb, 5_000);
      return () => {
        listeners.delete(cb);
        clearInterval(t);
      };
    },
    () => {
      prune(Date.now());
      return `${stamps.length}|${Math.max(0, waitingUntil - Date.now())}`;
    },
    () => "0|0"
  );
}
