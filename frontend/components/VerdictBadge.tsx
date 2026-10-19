import { VERDICT_STYLE, type Verdict } from "@/lib/contracts/types";

export function VerdictBadge({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  const s = VERDICT_STYLE[verdict];
  if (!s) return null;
  return (
    <span title={s.help} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls} ${className}`}>
      {s.label}
    </span>
  );
}

export function EcoBadge({ eco }: { eco: string }) {
  return (
    <span className="mono inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {eco}
    </span>
  );
}
