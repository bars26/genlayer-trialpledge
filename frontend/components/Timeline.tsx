import { dayMs } from "@/lib/contracts/types";

/**
 * The promise at a glance: a ruler from primary completion to the deadline (and the extended
 * deadline when a delay certification counts), with a marker for when results were posted or for today.
 */
export function Timeline({
  completion,
  deadline,
  extended,
  resultsPosted,
  completed = true,
}: {
  completion?: string;
  deadline?: string;
  extended?: string;
  resultsPosted?: string;
  completed?: boolean;
}) {
  if (!completed || !completion || !deadline) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        The trial has not completed yet{completion ? ` (estimated ${completion})` : ""}, so the results clock has not started.
      </div>
    );
  }
  const start = dayMs(completion);
  const due = dayMs(extended || deadline);
  const today = Date.now();
  const posted = resultsPosted ? dayMs(resultsPosted) : NaN;
  const marker = Number.isNaN(posted) ? today : posted;
  const end = Math.max(due, marker) + (due - start) * 0.08;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100));
  const pos = (t: number) => `${pct(t)}%`;
  // Tick labels closer than about a third of the ruler would overlap, so the later one drops below the bar.
  const crowded = (a: number, b: number) => pct(b) - pct(a) < 34;
  const deadlineBelow = crowded(start, dayMs(deadline));
  const extendedBelow = !!extended && !deadlineBelow && crowded(dayMs(deadline), due);
  const deadlineAlign = extended && !deadlineBelow ? "center" : pct(dayMs(deadline)) < 70 ? "start" : "end";
  const late = marker > due;
  const markerColor = Number.isNaN(posted) ? (late ? "#E0533D" : "#F2A541") : late ? "#E0533D" : "#0F9D8A";
  const markerLabel = Number.isNaN(posted) ? `today, no results${late ? "" : " yet"}` : `results posted ${resultsPosted}`;

  return (
    <div className="pt-3 sm:pt-7 pb-9" aria-label={`Completed ${completion}, deadline ${extended || deadline}, ${markerLabel}`}>
      <div className="relative h-3 rounded-full bg-[#E3F5F2]">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-[#BFE6DF]" style={{ width: pos(dayMs(deadline)) }} />
        {extended && (
          <div
            className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,#BFE6DF_0,#BFE6DF_4px,#E3F5F2_4px,#E3F5F2_8px)]"
            style={{ left: pos(dayMs(deadline)), width: `calc(${pos(due)} - ${pos(dayMs(deadline))})` }}
          />
        )}
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-[#FDEAE6]" style={{ left: pos(due) }} />

        <Tick at={pos(start)} label={`completed ${completion}`} align="start" />
        <Tick at={pos(dayMs(deadline))} label={`deadline ${deadline}`} align={deadlineAlign} below={deadlineBelow} />
        {extended && <Tick at={pos(due)} label={`extended to ${extended}`} align="end" below={extendedBelow} />}

        <div className="absolute -top-1.5 -translate-x-1/2" style={{ left: pos(marker) }}>
          <div className="h-6 w-6 rounded-full border-[3px] border-white shadow" style={{ background: markerColor }} />
        </div>
        <div
          className={`absolute top-6 whitespace-nowrap text-xs font-semibold ${marker > (start + end) / 2 ? "-translate-x-full" : ""}`}
          style={{ left: pos(marker), color: markerColor }}
        >
          {markerLabel}
        </div>
      </div>
      <p className="sm:hidden mt-9 text-[11px] text-muted-foreground">
        completed {completion} · deadline {deadline}
        {extended ? ` · extended to ${extended}` : ""}
      </p>
    </div>
  );
}

function Tick({ at, label, align, below = false }: { at: string; label: string; align: "start" | "center" | "end"; below?: boolean }) {
  const shift = align === "start" ? "" : align === "center" ? "-translate-x-1/2" : "-translate-x-full";
  return (
    <>
      <div className="absolute -top-1 h-5 w-0.5 bg-[#0F2A3D]/40" style={{ left: at }} />
      <div className={`absolute ${below ? "top-5" : "-top-6"} hidden sm:block whitespace-nowrap text-[11px] text-muted-foreground ${shift}`} style={{ left: at }}>
        {label}
      </div>
    </>
  );
}
