import { fmtTime } from "@/lib/time";
import { dur, KIND_LABEL } from "@/lib/format";

export interface TLSeg { kind: string; start: number; end: number | null; label?: string | null; title?: string | null }

/** Horizontal day timeline, one colour per state. Works in server and client components. */
export function Timeline({ segs, shiftStart, shiftEnd, now, pins = [] }: {
  segs: TLSeg[]; shiftStart?: number | null; shiftEnd?: number | null; now?: number | null; pins?: number[];
}) {
  const ends = segs.map((s) => s.end ?? now ?? s.start);
  const lo = Math.min(...[...segs.map((s) => s.start), shiftStart ?? Infinity].filter(isFinite));
  const hi = Math.max(...[...ends, shiftEnd ?? -Infinity].filter(isFinite));
  if (!isFinite(lo) || !isFinite(hi)) return <p className="muted small">No time recorded.</p>;
  const H = 3600_000;
  const from = Math.floor((lo - 15 * 60_000) / H) * H;
  const to = Math.ceil((hi + 15 * 60_000) / H) * H;
  const x = (v: number) => ((v - from) / (to - from)) * 100;
  const ticks: number[] = [];
  for (let v = from; v <= to; v += H) ticks.push(v);
  return (
    <div className="tl">
      <div className="tl-in">
        <div className="tl-ticks">{ticks.map((v, i) => <span key={v} style={{ left: `${x(v)}%`, transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : undefined }}>{fmtTime(v)}</span>)}</div>
        <div className="tl-track" style={{ backgroundImage: `repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px ${100 / ((to - from) / H)}%)` }}>
          {shiftStart && shiftEnd ? <div className="tl-shift" style={{ left: `${x(shiftStart)}%`, width: `${x(shiftEnd) - x(shiftStart)}%` }} title="Rostered shift" /> : null}
          {segs.map((s, i) => {
            const e = s.end ?? now ?? s.start;
            const w = x(e) - x(s.start);
            return (
              <div key={i} className={`tl-seg c-${s.kind}${s.end === null ? " running" : ""}`} style={{ left: `${x(s.start)}%`, width: `${Math.max(w, 0.15)}%` }}
                title={`${fmtTime(s.start)}–${s.end === null ? "now" : fmtTime(s.end)} · ${KIND_LABEL[s.kind] ?? s.kind}${s.title ? ` · ${s.title}` : ""} · ${dur((e - s.start) / 1000)}`}>
                {w > 6 ? s.label ?? "" : ""}
              </div>
            );
          })}
          {pins.map((p) => <span key={p} className="tl-pin" style={{ left: `${x(p)}%` }} title={`Idle alert at ${fmtTime(p)}`}>!</span>)}
          {now && now < to ? <div className="tl-now" style={{ left: `${x(now)}%` }} title={`Now ${fmtTime(now)}`} /> : null}
        </div>
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><i className="dot c-direct" />On a job</span>
      <span><i className="dot c-indirect" />Indirect</span>
      <span><i className="dot c-waiting" />Waiting</span>
      <span><i className="dot c-break_paid" />Smoko (paid)</span>
      <span><i className="dot c-break_unpaid" />Lunch (unpaid)</span>
      <span><i className="dot c-unallocated" />Idle</span>
      <span><i className="dot c-off" />Before / after shift</span>
      <span>Dashed box: rostered shift</span>
    </div>
  );
}
