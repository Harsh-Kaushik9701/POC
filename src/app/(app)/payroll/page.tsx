import Link from "next/link";
import { requireUser } from "@/lib/session";
import { addDays, fmtDay, mondayOf, todayLocal } from "@/lib/time";
import { payrollLines } from "@/server/payroll";

export const metadata = { title: "Payroll export" };
export const dynamic = "force-dynamic";

export default async function Payroll({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser("payroll.export");
  const sp = await searchParams;
  const lastMonday = addDays(mondayOf(todayLocal()), -7);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : lastMonday;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : addDays(from, 6);
  const { lines, roundingMin, pendingDays } = await payrollLines(from, to);
  const byEmp = new Map<string, { name: string; code: string; ord: number; ot: number; actual: number; days: Set<string>; notes: number }>();
  for (const l of lines) {
    const v = byEmp.get(l.employeeId) ?? { name: `${l.first} ${l.last}`, code: l.code, ord: 0, ot: 0, actual: 0, days: new Set(), notes: 0 };
    if (l.item.startsWith("Overtime")) v.ot += l.hours; else v.ord += l.hours;
    v.actual += l.actual; v.days.add(l.date); if (l.note) v.notes++;
    byEmp.set(l.employeeId, v);
  }
  const qs = `from=${from}&to=${to}`;
  return (
    <>
      <div className="pagehead">
        <div><h1>Payroll export</h1><p className="sub">Approved hours for {fmtDay(from)} – {fmtDay(to)}, rounded to the nearest {roundingMin} min for payroll only.</p></div>
        <div className="row">
          <Link className="btn" href={`/payroll?from=${addDays(from, -7)}&to=${addDays(to, -7)}`}>← Previous week</Link>
          <Link className="btn" href={`/payroll?from=${addDays(from, 7)}&to=${addDays(to, 7)}`}>Next week →</Link>
        </div>
      </div>
      <form className="row" action="/payroll">
        <label className="field">From<input type="date" name="from" defaultValue={from} /></label>
        <label className="field">To<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn" style={{ alignSelf: "end" }}>Show</button>
      </form>
      {pendingDays > 0 && <div className="callout"><p><b>{pendingDays} day{pendingDays > 1 ? "s" : ""} in this period {pendingDays > 1 ? "aren't" : "isn't"} approved yet</b> and won&apos;t be exported. <Link href={`/timesheets?week=${mondayOf(from)}`}>Review timesheets</Link>.</p></div>}
      <div className="tbl"><table>
        <thead><tr><th>Employee</th><th>Staff no</th><th className="num">Days</th><th className="num">Ordinary hours</th><th className="num">Overtime hours</th><th className="num">Total (rounded)</th><th className="num">Actual</th><th className="num">Flagged days</th></tr></thead>
        <tbody>
          {[...byEmp.entries()].map(([id, v]) => (
            <tr key={id}><td><Link href={`/timesheets/${id}?week=${mondayOf(from)}`}>{v.name}</Link></td><td className="mono">{v.code}</td><td className="num">{v.days.size}</td>
              <td className="num">{v.ord.toFixed(2)}</td><td className="num">{v.ot ? v.ot.toFixed(2) : "–"}</td><td className="num"><b>{(v.ord + v.ot).toFixed(2)}</b></td><td className="num">{v.actual.toFixed(2)}</td><td className="num">{v.notes || "–"}</td></tr>
          ))}
          {!byEmp.size && <tr><td colSpan={8} className="muted">No approved hours in this period.</td></tr>}
        </tbody>
      </table></div>
      <div className="row">
        <a className="btn primary" href={`/api/v1/exports/payroll?${qs}`}>Download CSV (Xero / Employment Hero layout)</a>
        <a className="btn" href={`/api/v1/exports/payroll?${qs}&lock=1`}>Download and lock these days</a>
      </div>
      <p className="small muted">Locking stops any further edits to exported days. Overtime here is simple daily overtime at time and a half; full award interpretation is a production item.</p>
    </>
  );
}
