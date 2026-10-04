import Link from "next/link";
import { notFound } from "next/navigation";
import { and, between, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { addDays, appNow, fmtDay, fmtTime, mondayOf, todayLocal } from "@/lib/time";
import { dur, hrs, money, pct } from "@/lib/format";
import { KpiTiles } from "@/components/KpiTiles";
import { segmentsFor } from "@/server/timesheets";

export const dynamic = "force-dynamic";

export default async function WorkerWeek({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ week?: string }> }) {
  const u = await requireUser("timesheets.view");
  const { employeeId } = await params;
  const sp = await searchParams;
  const monday = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayLocal());
  const sunday = addDays(monday, 6);
  const [emp] = await db.select({ e: t.employees, d: t.departments }).from(t.employees).leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId)).where(eq(t.employees.id, employeeId));
  if (!emp) notFound();
  const days = await db.select().from(t.attendanceDays).where(and(eq(t.attendanceDays.employeeId, employeeId), between(t.attendanceDays.workDate, monday, sunday))).orderBy(t.attendanceDays.workDate);
  const segs = await segmentsFor(employeeId, monday, sunday);
  const fourWeeks = await db.select().from(t.attendanceDays).where(and(eq(t.attendanceDays.employeeId, employeeId), between(t.attendanceDays.workDate, addDays(monday, -21), sunday)));
  const showCost = can(u.role, "costs.view");
  const now = appNow();
  const sum = (k: keyof typeof days[number]) => days.reduce((a, d) => a + (d[k] as number), 0);
  const totals = {
    attendanceS: sum("attendanceS"), paidS: sum("paidS"), availableS: sum("availableS"), directS: sum("directS"), indirectS: sum("indirectS"),
    waitingS: sum("waitingS"), unallocatedS: sum("unallocatedS"), overtimeS: sum("overtimeS"), stdEarnedS: sum("stdEarnedS"), directDoneS: sum("directDoneS"),
  };
  const byTask = new Map<string, { code: string; name: string; job: string; s: number; cost: number }>();
  const byCode = new Map<string, { name: string; s: number }>();
  for (const { s, tk, p, c } of segs) {
    const sec = ((s.endAt?.getTime() ?? now) - s.startAt.getTime()) / 1000;
    if (s.kind === "direct" && tk) { const v = byTask.get(tk.id) ?? { code: tk.code, name: tk.name, job: `${p?.code} ${p?.name}`, s: 0, cost: 0 }; v.s += sec; v.cost += (sec / 3600) * (s.costRateCents ?? 0); byTask.set(tk.id, v); }
    else if (c && s.kind !== "break_paid" && s.kind !== "break_unpaid") { const v = byCode.get(c.id) ?? { name: c.name, s: 0 }; v.s += sec; byCode.set(c.id, v); }
  }
  const maxAv = Math.max(1, ...days.map((d) => d.availableS));
  const weeks = [0, 1, 2, 3].map((i) => {
    const m = addDays(monday, -7 * (3 - i));
    const ds = fourWeeks.filter((d) => d.workDate >= m && d.workDate <= addDays(m, 6));
    const av = ds.reduce((a, d) => a + d.availableS, 0), di = ds.reduce((a, d) => a + d.directS, 0), id = ds.reduce((a, d) => a + d.unallocatedS, 0);
    return { m, util: av ? di / av : null, idle: av ? id / av : null };
  });

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow"><Link href={`/timesheets?week=${monday}`}>Timesheets</Link></div>
          <h1>{emp.e.firstName} {emp.e.lastName}</h1>
          <p className="sub">{emp.e.trade} · {emp.d?.name} · {emp.e.code} · week of {fmtDay(monday)}</p>
        </div>
        <div className="row">
          <Link className="btn" href={`/timesheets/${employeeId}?week=${addDays(monday, -7)}`}>← Previous week</Link>
          <Link className="btn" href={`/timesheets/${employeeId}?week=${addDays(monday, 7)}`}>Next week →</Link>
        </div>
      </div>

      <KpiTiles t={totals} />

      <div className="grid2">
        <section className="panel">
          <header><h2>Day by day</h2><span className="muted small">Bar height = available time</span></header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8, alignItems: "end", height: 170 }}>
            {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((dt) => {
              const d = days.find((x) => x.workDate === dt);
              const h = d ? (d.availableS / maxAv) * 130 : 0;
              const av = Math.max(d?.availableS ?? 1, 1);
              return (
                <Link key={dt} href={`/timesheets/${employeeId}/${dt}`} style={{ display: "grid", gap: 4, justifyItems: "center", color: "inherit" }} title={d ? `On jobs ${dur(d.directS)}, idle ${dur(d.unallocatedS)}` : "No time"}>
                  <span className="mono small">{d ? pct(d.directS / av) : ""}</span>
                  <span style={{ width: "100%", maxWidth: 44, height: h, display: "flex", flexDirection: "column-reverse", borderRadius: "3px 3px 0 0", overflow: "hidden", background: "var(--surface-2)" }}>
                    {d && <><i className="c-direct" style={{ height: `${(d.directS / av) * 100}%` }} /><i className="c-indirect" style={{ height: `${(d.indirectS / av) * 100}%` }} /><i className="c-waiting" style={{ height: `${(d.waitingS / av) * 100}%` }} /><i className="c-unallocated" style={{ height: `${(d.unallocatedS / av) * 100}%` }} /></>}
                  </span>
                  <span className="small muted">{fmtDay(dt).split(" ")[0]}</span>
                </Link>
              );
            })}
          </div>
          <div className="legend"><span><i className="dot c-direct" />On jobs</span><span><i className="dot c-indirect" />Indirect</span><span><i className="dot c-waiting" />Waiting</span><span><i className="dot c-unallocated" />Idle</span><span>Number = utilisation</span></div>
        </section>
        <section className="panel">
          <header><h2>Last 4 weeks</h2></header>
          <div className="tbl"><table>
            <thead><tr><th>Week of</th><th className="num">Utilisation</th><th className="num">Idle</th></tr></thead>
            <tbody>{weeks.map((w) => <tr key={w.m}><td><Link href={`/timesheets/${employeeId}?week=${w.m}`}>{fmtDay(w.m)}</Link></td><td className="num">{pct(w.util)}</td><td className="num">{pct(w.idle)}</td></tr>)}</tbody>
          </table></div>
        </section>
      </div>

      <div className="tbl"><table>
        <thead><tr><th>Day</th><th className="num">On</th><th className="num">Off</th><th className="num">Paid</th><th className="num">On jobs</th><th className="num">Indirect</th><th className="num">Waiting</th><th className="num">Idle</th><th className="num">Utilisation</th><th>Status</th></tr></thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/timesheets/${employeeId}/${d.workDate}`}>{fmtDay(d.workDate)}</Link></td>
              <td className="num">{fmtTime(d.firstIn)}</td><td className="num">{d.isOpen ? "on site" : fmtTime(d.lastOut)}</td>
              <td className="num">{hrs(d.paidS)}</td><td className="num">{dur(d.directS)}</td><td className="num">{dur(d.indirectS)}</td><td className="num">{dur(d.waitingS)}</td>
              <td className="num">{dur(d.unallocatedS)}</td><td className="num">{pct(d.availableS ? d.directS / d.availableS : null)}</td>
              <td><span className={`pill ${d.status === "approved" ? "ok" : d.status === "needs_review" ? "warn" : "mute"}`}>{d.isOpen ? "on site" : d.status.replace("_", " ")}</span></td>
            </tr>
          ))}
          {!days.length && <tr><td colSpan={10} className="muted">No time this week</td></tr>}
        </tbody>
      </table></div>

      <div className="grid2">
        <section className="panel">
          <header><h2>Jobs this week</h2></header>
          <div className="tbl"><table>
            <thead><tr><th>Task</th><th>Job</th><th className="num">Time</th>{showCost && <th className="num">Cost</th>}</tr></thead>
            <tbody>{[...byTask.values()].sort((a, b) => b.s - a.s).map((v) => <tr key={v.code}><td><b className="mono">{v.code}</b> {v.name}</td><td className="small">{v.job}</td><td className="num">{dur(v.s)}</td>{showCost && <td className="num">{money(v.cost)}</td>}</tr>)}</tbody>
          </table></div>
        </section>
        <section className="panel">
          <header><h2>Other time</h2></header>
          <div className="tbl"><table>
            <thead><tr><th>Code</th><th className="num">Time</th></tr></thead>
            <tbody>
              <tr><td><i className="dot c-unallocated" /> Idle (not on anything)</td><td className="num">{dur(totals.unallocatedS)}</td></tr>
              {[...byCode.values()].sort((a, b) => b.s - a.s).map((v) => <tr key={v.name}><td>{v.name}</td><td className="num">{dur(v.s)}</td></tr>)}
            </tbody>
          </table></div>
        </section>
      </div>
    </>
  );
}
