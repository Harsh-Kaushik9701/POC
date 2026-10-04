import { kpis, KPI_FORMULAS } from "@/lib/engine";
import { dur, pct } from "@/lib/format";

export interface Totals {
  attendanceS: number; paidS: number; availableS: number; directS: number; indirectS: number; waitingS: number;
  unallocatedS: number; overtimeS: number; stdEarnedS: number; directDoneS: number; breakPaidS?: number; breakUnpaidS?: number;
}

/** The standard KPI row. Every tile shows its formula on hover. */
export function KpiTiles({ t, compact = false }: { t: Totals; compact?: boolean }) {
  const k = kpis(t);
  const tile = (label: string, value: string, key: string, cls = "") => (
    <div className={`kpi ${cls}`} title={KPI_FORMULAS[key]}><small>{label}</small><b>{value}</b></div>
  );
  return (
    <div className="kpis">
      {tile("Attendance", dur(t.attendanceS), "attendance")}
      {tile("Paid", dur(t.paidS), "paid")}
      {tile("Available", dur(t.availableS), "available")}
      {tile("On jobs", dur(t.directS), "direct", "good")}
      {!compact && tile("Indirect", dur(t.indirectS), "indirect")}
      {!compact && tile("Waiting", dur(t.waitingS), "waiting", t.waitingS > 1800 ? "warn" : "")}
      {tile("Idle", dur(t.unallocatedS), "idle", "bad")}
      {tile("Utilisation", pct(k.utilisation), "utilisation", (k.utilisation ?? 0) >= 0.75 ? "good" : "")}
      {tile("Idle %", pct(k.idlePct), "idlePct", (k.idlePct ?? 0) > 0.15 ? "bad" : "")}
      {!compact && tile("Efficiency", pct(k.efficiency), "efficiency")}
      {!compact && tile("Overtime", dur(t.overtimeS), "overtime")}
    </div>
  );
}
