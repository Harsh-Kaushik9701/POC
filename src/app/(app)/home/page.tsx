import Link from "next/link";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { can, type Action } from "@/lib/permissions";
import { addDays, appNow, fmtDayLong, localMinutes, mondayOf, todayLocal } from "@/lib/time";
import { dur, pct } from "@/lib/format";
import { getFloor } from "@/server/floor";
import { Icon } from "@/components/Icon";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

type Todo = { tone: "bad" | "warn" | "info"; icon: string; title: string; sub: string; href: string; cta: string };
type Tile = { href: string; label: string; sub: string; icon: string; need: Action | null };

const TILES: Tile[] = [
  { href: "/floor", label: "Floor board", sub: "Who is on what, right now", icon: "board", need: "floor.view" },
  { href: "/idle", label: "Idle workers", sub: "Longest idle at the top", icon: "idle", need: "floor.view" },
  { href: "/timesheets", label: "Timesheets", sub: "Check and approve hours", icon: "timesheet", need: "timesheets.view" },
  { href: "/jobsheets", label: "Jobsheets", sub: "Hours and cost by job", icon: "jobsheet", need: "jobsheets.view" },
  { href: "/reports", label: "Reports", sub: "Utilisation and idle trends", icon: "reports", need: "reports.view" },
  { href: "/payroll", label: "Payroll export", sub: "Approved hours to payroll", icon: "payroll", need: "payroll.export" },
  { href: "/exceptions", label: "Exceptions", sub: "Alerts to check or clear", icon: "alert", need: "exceptions.view" },
  { href: "/setup/jobs", label: "Jobs & tasks", sub: "Add work and standard times", icon: "jobs", need: "setup.jobs" },
  { href: "/setup/staff", label: "Staff & fobs", sub: "People, PINs and NFC tags", icon: "staff", need: "setup.people" },
];

/**
 * Role-based home: the "launchpad" pattern used by SAP Fiori, Dynamics 365 and NetSuite.
 * Answers three questions in order: what needs me now, how is today going, where do I go next.
 */
export default async function HomePage() {
  const u = await requireUser();
  const r = u.role;
  const now = appNow();
  const today = todayLocal();
  const f = await getFloor();
  const tl = f.tiles;

  const [{ toApprove }] = await db.select({ toApprove: sql<number>`count(*)::int` }).from(t.attendanceDays)
    .where(and(eq(t.attendanceDays.isOpen, false), inArray(t.attendanceDays.status, ["open", "needs_review"]),
      gte(t.attendanceDays.workDate, addDays(mondayOf(today), -7)), lt(t.attendanceDays.workDate, addDays(today, 1))));
  const [{ autoOff }] = await db.select({ autoOff: sql<number>`count(*)::int` }).from(t.alerts)
    .where(and(eq(t.alerts.type, "auto_clock_off"), isNull(t.alerts.ackAt), gte(t.alerts.workDate, addDays(today, -7))));
  const [{ openAlerts }] = await db.select({ openAlerts: sql<number>`count(*)::int` }).from(t.alerts)
    .where(and(isNull(t.alerts.ackAt), sql`${t.alerts.severity} <> 'info'`, gte(t.alerts.workDate, addDays(today, -7))));

  const longIdle = f.workers.filter((w) => w.state === "unallocated" && w.since && now - w.since > f.idleAlertMin * 60_000)
    .sort((a, b) => (a.since ?? 0) - (b.since ?? 0));

  const todos: Todo[] = [];
  if (can(r, "floor.view") && longIdle.length) {
    const w = longIdle[0];
    todos.push({ tone: "bad", icon: "idle", href: "/idle",  cta: "See idle list",
      title: `${longIdle.length} ${longIdle.length === 1 ? "worker has" : "workers have"} been idle over ${f.idleAlertMin} min`,
      sub: `Longest: ${w.name}, ${dur(Math.round((now - (w.since ?? now)) / 1000))}` });
  }
  if (can(r, "floor.view") && tl.waiting) todos.push({ tone: "warn", icon: "wait", href: "/floor", cta: "Open floor board",
    title: `${tl.waiting} waiting on something`, sub: "Materials, drawings or a crane — clear the hold-up" });
  if (can(r, "timesheets.view") && autoOff) todos.push({ tone: "bad", icon: "alert", href: can(r, "exceptions.view") ? "/exceptions" : "/timesheets", cta: "Review",
    title: `${autoOff} forgotten clock-${autoOff === 1 ? "off" : "offs"}`, sub: "Auto clocked off by the system — confirm the finish time" });
  if (can(r, "timesheets.approve") && toApprove) todos.push({ tone: "info", icon: "approve", href: "/timesheets", cta: "Approve",
    title: `${toApprove} ${toApprove === 1 ? "day" : "days"} to approve`, sub: "This week and last week, ready for sign-off" });
  if (can(r, "payroll.export") && !can(r, "timesheets.approve")) todos.push({ tone: "info", icon: "payroll", href: "/payroll", cta: "Open export",
    title: "Payroll export", sub: toApprove ? "Some days still need approval — they will be left out" : "All closed days are approved and ready" });
  if (can(r, "floor.view") && tl.overStandard) todos.push({ tone: "warn", icon: "jobsheet", href: "/exceptions", cta: "Review",
    title: `${tl.overStandard} ${tl.overStandard === 1 ? "task is" : "tasks are"} over standard time`, sub: "Check the quote or the method" });
  if (can(r, "floor.assign") && tl.queue) todos.push({ tone: "info", icon: "jobs", href: "/floor", cta: "Assign",
    title: `${tl.queue} ready ${tl.queue === 1 ? "task has" : "tasks have"} nobody assigned`, sub: "Drag onto a worker on the floor board" });
  if (can(r, "floor.view") && tl.notIn && localMinutes(now) > 7 * 60) todos.push({ tone: "warn", icon: "user", href: "/floor", cta: "Check",
    title: `${tl.notIn} rostered but not clocked on`, sub: "Late, sick or forgot to tap in" });

  const h = localMinutes(now) / 60;
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const util = tl.utilisation;
  const live = can(r, "floor.view");
  const tiles = TILES.filter((x) => !x.need || can(r, x.need));

  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="pagehead">
        <div>
          <h1>{hello}, {u.name.split(" ")[0]}</h1>
          <p className="sub">{fmtDayLong(today)} · {todos.length ? `${todos.length} ${todos.length === 1 ? "thing needs" : "things need"} your attention` : "Nothing needs you right now"}</p>
        </div>
      </div>

      <section className="kpis home-kpis" aria-label="Today at a glance">
        {live && <Link className="kpi" href="/floor"><small>On site</small><b>{tl.onSite}<span className="muted small"> / {tl.expected}</span></b></Link>}
        {live && <Link className={`kpi ${tl.idle ? "bad" : ""}`} href="/idle"><small>Idle now</small><b>{tl.idle}</b></Link>}
        {live && <Link className={`kpi ${tl.waiting ? "warn" : ""}`} href="/floor"><small>Waiting</small><b>{tl.waiting}</b></Link>}
        <div className={`kpi ${util === null ? "" : util >= 0.8 ? "good" : util < 0.65 ? "bad" : "warn"}`} title="Time on jobs ÷ time available today"><small>Utilisation today</small><b>{pct(util)}</b></div>
        {can(r, "exceptions.view") && <Link className={`kpi ${openAlerts ? "warn" : ""}`} href="/exceptions"><small>Open alerts</small><b>{openAlerts}</b></Link>}
        {can(r, "timesheets.view") && <Link className="kpi" href="/timesheets"><small>Days to approve</small><b>{toApprove}</b></Link>}
      </section>

      <div className="home-grid">
        <section className="panel">
          <header><h2>Needs your attention</h2><span className="muted small">Most urgent first</span></header>
          {todos.length === 0 ? (
            <div className="empty"><Icon name="check" size={28} /><p>All clear. Idle, waiting and approvals are on top of things.</p></div>
          ) : (
            <ul className="todo">
              {todos.map((x) => (
                <li key={x.title} className={`t-${x.tone}`}>
                  <span className="ti"><Icon name={x.icon} /></span>
                  <span className="tx"><b>{x.title}</b><small>{x.sub}</small></span>
                  <Link className="btn" href={x.href}>{x.cta}<Icon name="chevron" size={14} /></Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {live && <section className="panel">
          <header><h2>Today so far</h2><Link href="/reports" className="small">Reports</Link></header>
          <dl className="facts">
            <div><dt>On jobs</dt><dd>{tl.onJobs}</dd></div>
            <div><dt>Idle time today</dt><dd>{dur(tl.idleS)}</dd></div>
            <div><dt>Not clocked on</dt><dd>{tl.notIn}</dd></div>
            <div><dt>Ready tasks unassigned</dt><dd>{tl.queue}</dd></div>
          </dl>
          {f.alerts.length > 0 && (
            <>
              <h3 className="eyebrow">Latest alerts</h3>
              <ul className="mini">
                {f.alerts.slice(0, 4).map((a) => <li key={a.id}>{a.message}</li>)}
              </ul>
            </>
          )}
        </section>}
      </div>

      <section className="stack" aria-label="Go to">
        <h2>Go to</h2>
        <div className="apps">
          {tiles.map((x) => (
            <Link key={x.href} href={x.href} className="app">
              <span className="ai"><Icon name={x.icon} size={22} /></span>
              <span><b>{x.label}</b><small>{x.sub}</small></span>
            </Link>
          ))}
          <a href="/kiosk?device=kiosk-front-gate-demo" target="_blank" className="app">
            <span className="ai"><Icon name="kiosk" size={22} /></span>
            <span><b>Kiosk</b><small>The clock-on screen at the gate</small></span>
          </a>
        </div>
      </section>
    </>
  );
}
