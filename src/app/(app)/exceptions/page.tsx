import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, appNow, fmtDay, fmtTime, todayLocal } from "@/lib/time";

export const metadata = { title: "Exceptions" };
export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = {
  idle_threshold: "Idle", auto_clock_off: "Auto clock-off", task_over_standard: "Over standard time", offline_punch: "Offline tap",
  pin_used: "PIN used", late_arrival: "Late", smoko_overrun: "Break overrun",
};

async function ack(formData: FormData) {
  "use server";
  const u = await requireUser("exceptions.view");
  const ids = formData.getAll("id").map(String);
  if (ids.length) await db.update(t.alerts).set({ ackBy: u.id, ackAt: new Date(appNow()) }).where(inArray(t.alerts.id, ids));
  revalidatePath("/exceptions");
}

export default async function Exceptions({ searchParams }: { searchParams: Promise<{ view?: string; type?: string }> }) {
  await requireUser("exceptions.view");
  const sp = await searchParams;
  const view = sp.view ?? "open";
  const since = addDays(todayLocal(), -14);
  const where = and(
    gte(sql`coalesce(${t.alerts.workDate}, (${t.alerts.openedAt} at time zone 'Australia/Brisbane')::date)`, since),
    view === "open" ? and(isNull(t.alerts.ackAt), ne(t.alerts.severity, "info")) : view === "info" ? eq(t.alerts.severity, "info") : undefined,
    sp.type ? eq(t.alerts.type, sp.type) : undefined,
  );
  const rows = await db.select({ a: t.alerts, e: t.employees, tk: t.tasks, u: t.users }).from(t.alerts)
    .leftJoin(t.employees, eq(t.employees.id, t.alerts.employeeId))
    .leftJoin(t.tasks, eq(t.tasks.id, t.alerts.taskId))
    .leftJoin(t.users, eq(t.users.id, t.alerts.ackBy))
    .where(where).orderBy(desc(t.alerts.openedAt)).limit(300);
  const counts = await db.select({ type: t.alerts.type, n: sql<number>`count(*)::int` }).from(t.alerts)
    .where(and(gte(t.alerts.openedAt, new Date(appNow() - 14 * 86400_000)), ne(t.alerts.severity, "info"))).groupBy(t.alerts.type);
  const tab = (v: string, label: string) => <Link href={`/exceptions?view=${v}`} aria-current={view === v ? "page" : undefined}>{label}</Link>;
  return (
    <>
      <div className="pagehead"><div><h1>Exceptions</h1><p className="sub">Things that need a look: idle time over the limit, forgotten clock-offs, jobs over standard time, PIN and offline taps. Last 14 days.</p></div></div>
      <div className="row">{counts.map((c) => <Link key={c.type} className="chip" href={`/exceptions?view=all&type=${c.type}`}>{TYPE[c.type] ?? c.type} · {c.n}</Link>)}</div>
      <nav className="tabs">{tab("open", "Needs action")}{tab("all", "All")}{tab("info", "For information")}</nav>
      <form action={ack} className="stack">
        <div className="tbl"><table>
          <thead><tr><th style={{ width: 30 }} /><th>When</th><th>Type</th><th>Who</th><th>What happened</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map(({ a, e, tk, u }) => (
              <tr key={a.id}>
                <td>{!a.ackAt && <input type="checkbox" name="id" value={a.id} aria-label="Select" />}</td>
                <td className="num">{a.workDate ? fmtDay(a.workDate) : ""} {fmtTime(a.openedAt)}</td>
                <td><span className={`pill ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}`}>{TYPE[a.type] ?? a.type}</span></td>
                <td>{e ? `${e.firstName} ${e.lastName}` : tk ? <span className="mono">{tk.code}</span> : "–"}</td>
                <td>{a.message}</td>
                <td className="small">{a.ackAt ? `Dealt with by ${u?.name ?? "someone"}` : a.resolvedAt ? "Back on task, not reviewed" : "Open"}</td>
                <td>{e && a.workDate ? <Link className="btn sm" href={`/timesheets/${e.id}/${a.workDate}`}>Open day</Link> : tk ? <Link className="btn sm" href={`/jobsheets/${tk.projectId}`}>Open job</Link> : null}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="empty">Nothing here. Good work.</td></tr>}
          </tbody>
        </table></div>
        {rows.some((r) => !r.a.ackAt) && <div><button className="btn primary">Mark selected as dealt with</button></div>}
      </form>
    </>
  );
}
