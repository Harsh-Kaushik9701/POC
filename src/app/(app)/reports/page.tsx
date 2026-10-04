import Link from "next/link";
import { and, between, eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { addDays, appNow, fmtDay, isoWeekday, localDate, localMinutes, todayLocal } from "@/lib/time";
import { dur, money, pct } from "@/lib/format";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const REPORTS: [string, string, string][] = [
  ["utilisation", "Utilisation & idle", "Who spends how much of their available time on jobs, and how much is idle"],
  ["heatmap", "Idle heatmap", "When in the day idle time happens, so you can fix the pattern"],
  ["nonproductive", "Non-productive time", "Indirect codes, waiting, idle and break overruns, with cost"],
  ["waiting", "Waiting & bottlenecks", "Which jobs lose time to parts, drawings and machines"],
  ["estimates", "Estimate vs actual", "Finished tasks against their standard time"],
];

export default async function Reports({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string }> }) {
  const u = await requireUser("reports.view");
  const sp = await searchParams;
  const r = REPORTS.some((x) => x[0] === sp.r) ? sp.r! : "utilisation";
  const today = todayLocal();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(today, -14);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const showCost = can(u.role, "costs.view");
  const now = appNow();
  const q = (x: string) => `/reports?r=${x}&from=${from}&to=${to}`;

  const days = await db.select({ d: t.attendanceDays, e: t.employees, dep: t.departments }).from(t.attendanceDays)
    .innerJoin(t.employees, eq(t.employees.id, t.attendanceDays.employeeId))
    .leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId))
    .where(between(t.attendanceDays.workDate, from, to));
  const segs = await db.select({ s: t.timeSegments, c: t.timeCodes, tk: t.tasks, p: t.projects, e: t.employees }).from(t.timeSegments)
    .leftJoin(t.timeCodes, eq(t.timeCodes.id, t.timeSegments.timeCodeId))
    .leftJoin(t.tasks, eq(t.tasks.id, t.timeSegments.taskId))
    .leftJoin(t.projects, eq(t.projects.id, t.timeSegments.projectId))
    .innerJoin(t.employees, eq(t.employees.id, t.timeSegments.employeeId))
    .where(between(t.timeSegments.workDate, from, to));
  const sec = (s: { startAt: Date; endAt: Date | null }) => ((s.endAt?.getTime() ?? now) - s.startAt.getTime()) / 1000;
  const avgCost = days.length ? days.reduce((a, x) => a + x.e.costRateCents, 0) / days.length : 0;

  let body: React.ReactNode = null;
  if (r === "utilisation") {
    const per = new Map<string, { name: string; dept: string; av: number; d: number; i: number; w: number; u: number; cost: number }>();
    for (const { d, e, dep } of days) {
      const v = per.get(e.id) ?? { name: `${e.firstName} ${e.lastName}`, dept: dep?.name ?? "", av: 0, d: 0, i: 0, w: 0, u: 0, cost: e.costRateCents };
      v.av += d.availableS; v.d += d.directS; v.i += d.indirectS; v.w += d.waitingS; v.u += d.unallocatedS; per.set(e.id, v);
    }
    const list = [...per.entries()].sort((a, b) => a[1].d / (a[1].av || 1) - b[1].d / (b[1].av || 1));
    const tot = list.reduce((a, [, v]) => ({ av: a.av + v.av, d: a.d + v.d, u: a.u + v.u, idleCost: a.idleCost + (v.u / 3600) * v.cost }), { av: 0, d: 0, u: 0, idleCost: 0 });
    const deps = new Map<string, { av: number; d: number; u: number }>();
    for (const [, v] of list) { const x = deps.get(v.dept) ?? { av: 0, d: 0, u: 0 }; x.av += v.av; x.d += v.d; x.u += v.u; deps.set(v.dept, x); }
    body = (<>
      <div className="kpis">
        <div className="kpi good" title="On jobs ÷ available"><small>Utilisation</small><b>{pct(tot.d / (tot.av || 1))}</b></div>
        <div className="kpi bad" title="Idle ÷ available"><small>Idle</small><b>{pct(tot.u / (tot.av || 1))}</b></div>
        <div className="kpi bad"><small>Idle hours</small><b>{(tot.u / 3600).toFixed(1)}</b></div>
        {showCost && <div className="kpi bad" title="Idle hours × each worker's cost rate"><small>Cost of idle time</small><b>{money(tot.idleCost)}</b></div>}
        {[...deps.entries()].map(([n, x]) => <div key={n} className="kpi"><small>{n}</small><b>{pct(x.d / (x.av || 1))}</b></div>)}
      </div>
      <section className="panel">
        <header><h2>By worker</h2><span className="muted small">Bar = available time split by state. Lowest utilisation first.</span></header>
        <div className="stack">
          {list.map(([id, v]) => (
            <div key={id} className="hbar">
              <Link href={`/timesheets/${id}`}>{v.name}<div className="muted small">{v.dept}</div></Link>
              <div className="track" title={`On jobs ${dur(v.d)} · indirect ${dur(v.i)} · waiting ${dur(v.w)} · idle ${dur(v.u)}`}>
                <i className="c-direct" style={{ width: `${(v.d / (v.av || 1)) * 100}%` }} /><i className="c-indirect" style={{ width: `${(v.i / (v.av || 1)) * 100}%` }} />
                <i className="c-waiting" style={{ width: `${(v.w / (v.av || 1)) * 100}%` }} /><i className="c-unallocated" style={{ width: `${(v.u / (v.av || 1)) * 100}%` }} />
              </div>
              <span className="mono small">{pct(v.d / (v.av || 1))} · <span style={{ color: "var(--s-unalloc)" }}>{pct(v.u / (v.av || 1))}</span></span>
            </div>
          ))}
        </div>
        <div className="legend"><span><i className="dot c-direct" />On jobs</span><span><i className="dot c-indirect" />Indirect</span><span><i className="dot c-waiting" />Waiting</span><span><i className="dot c-unallocated" />Idle</span><span>Numbers: utilisation · idle</span></div>
      </section>
    </>);
  } else if (r === "heatmap") {
    const hours = Array.from({ length: 9 }, (_, i) => 7 + i); // 7am to 3pm
    const grid = new Map<string, number>(); let max = 1;
    for (const { s } of segs) {
      if (s.kind !== "unallocated") continue;
      const wd = isoWeekday(s.workDate);
      for (let m = s.startAt.getTime(); m < (s.endAt?.getTime() ?? now); m += 60_000) {
        const h = Math.floor(localMinutes(m) / 60);
        const k = `${wd}:${h}`; const v = (grid.get(k) ?? 0) + 1; grid.set(k, v); if (v > max) max = v;
      }
    }
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    body = (
      <section className="panel">
        <header><h2>Idle minutes by hour and weekday</h2><span className="muted small">Darker = more idle time across all staff</span></header>
        <div className="heat" style={{ ["--cols" as string]: hours.length }}>
          <div className="hrow"><span />{hours.map((h) => <span key={h} className="mono small muted" style={{ textAlign: "center" }}>{h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}</span>)}</div>
          {names.map((n, i) => (
            <div key={n} className="hrow"><span className="small">{n}</span>
              {hours.map((h) => { const v = grid.get(`${i + 1}:${h}`) ?? 0; const a = v / max;
                return <span key={h} className="hc" title={`${n} ${h}:00 · ${v} idle minutes`} style={{ background: `color-mix(in srgb, var(--s-unalloc) ${Math.round(a * 90)}%, var(--surface-2))`, color: a > 0.5 ? "#fff" : "var(--muted)" }}>{v || ""}</span>; })}
            </div>
          ))}
        </div>
        <p className="small muted">Typical patterns: slow starts after clock-on, after smoko and after lunch, and the last half-hour of the shift.</p>
      </section>
    );
  } else if (r === "nonproductive") {
    const by = new Map<string, { label: string; kind: string; s: number; cost: number }>();
    for (const { s, c, e } of segs) {
      if (!["indirect", "waiting", "unallocated"].includes(s.kind) && !s.flags.includes("break_overrun")) continue;
      const key = s.kind === "unallocated" ? (s.flags.includes("break_overrun") ? "_overrun" : "_idle") : c?.id ?? s.kind;
      const label = key === "_idle" ? "Idle (not on anything)" : key === "_overrun" ? "Break overrun" : c?.name ?? s.kind;
      const v = by.get(key) ?? { label, kind: s.kind, s: 0, cost: 0 }; const x = sec(s); v.s += x; v.cost += (x / 3600) * e.costRateCents; by.set(key, v);
    }
    const avail = days.reduce((a, x) => a + x.d.availableS, 0);
    const list = [...by.values()].sort((a, b) => b.s - a.s);
    const max = Math.max(1, ...list.map((x) => x.s));
    body = (
      <section className="panel">
        <header><h2>Where non-job time goes</h2><span className="muted small">Share of all available time</span></header>
        <div className="stack">
          {list.map((v) => (
            <div key={v.label} className="hbar">
              <span>{v.label}</span>
              <div className="track"><i className={`c-${v.kind === "waiting" ? "waiting" : v.kind === "indirect" ? "indirect" : "unallocated"}`} style={{ width: `${(v.s / max) * 100}%` }} /></div>
              <span className="mono small">{(v.s / 3600).toFixed(1)}h · {pct(v.s / (avail || 1), 1)}{showCost ? ` · ${money(v.cost)}` : ""}</span>
            </div>
          ))}
        </div>
      </section>
    );
  } else if (r === "waiting") {
    const by = new Map<string, { job: string; task: string; code: string; s: number; cost: number; n: number }>();
    for (const { s, c, tk, p, e } of segs) {
      if (s.kind !== "waiting") continue;
      const key = `${tk?.id}:${c?.id}`;
      const v = by.get(key) ?? { job: p ? `${p.code} ${p.name}` : "No job linked", task: tk ? `${tk.code} ${tk.name}` : "–", code: c?.name ?? "Waiting", s: 0, cost: 0, n: 0 };
      const x = sec(s); v.s += x; v.cost += (x / 3600) * e.costRateCents; v.n++; by.set(key, v);
    }
    const list = [...by.values()].sort((a, b) => b.s - a.s);
    body = (
      <div className="tbl"><table>
        <thead><tr><th>Job</th><th>Task</th><th>Reason</th><th className="num">Times</th><th className="num">Time lost</th>{showCost && <th className="num">Labour cost</th>}</tr></thead>
        <tbody>{list.map((v, i) => <tr key={i}><td>{v.job}</td><td className="small">{v.task}</td><td><span className="pill warn nocap">{v.code}</span></td><td className="num">{v.n}</td><td className="num">{dur(v.s)}</td>{showCost && <td className="num">{money(v.cost)}</td>}</tr>)}
          {!list.length && <tr><td colSpan={6} className="muted">No waiting time in this period</td></tr>}</tbody>
      </table></div>
    );
  } else if (r === "estimates") {
    const done = await db.select({ tk: t.tasks, p: t.projects }).from(t.tasks).innerJoin(t.projects, eq(t.projects.id, t.tasks.projectId)).where(eq(t.tasks.status, "done"));
    const ids = done.filter((x) => x.tk.completedAt && localDate(x.tk.completedAt.getTime()) >= from && localDate(x.tk.completedAt.getTime()) <= to).map((x) => x.tk.id);
    const all = ids.length ? await db.select().from(t.timeSegments).where(and(inArray(t.timeSegments.taskId, ids), eq(t.timeSegments.kind, "direct"))) : [];
    const rows = done.filter((x) => ids.includes(x.tk.id)).map((x) => {
      const act = all.filter((s) => s.taskId === x.tk.id).reduce((a, s) => a + sec(s), 0);
      return { ...x, act, ratio: act / (x.tk.standardMinutes * 60) };
    }).sort((a, b) => b.ratio - a.ratio);
    body = (
      <div className="tbl"><table>
        <thead><tr><th>Task</th><th>Job</th><th className="num">Finished</th><th className="num">Standard</th><th className="num">Actual</th><th className="num">Difference</th><th className="num" title="Standard ÷ actual">Efficiency</th></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.tk.id}><td><b className="mono">{x.tk.code}</b> {x.tk.name}</td><td className="small">{x.p.code}</td><td className="num">{x.tk.completedAt ? fmtDay(localDate(x.tk.completedAt.getTime())) : ""}</td>
            <td className="num">{dur(x.tk.standardMinutes * 60)}</td><td className="num">{dur(x.act)}</td>
            <td className="num" style={{ color: x.ratio > 1 ? "var(--s-unalloc)" : "var(--s-direct)" }}>{x.ratio > 1 ? "+" : "−"}{dur(Math.abs(x.act - x.tk.standardMinutes * 60))}</td>
            <td className="num">{x.ratio > 1.5 ? <span className="pill bad">{pct(1 / x.ratio)}</span> : pct(1 / x.ratio)}</td></tr>
        ))}{!rows.length && <tr><td colSpan={7} className="muted">No tasks finished in this period</td></tr>}</tbody>
      </table></div>
    );
  }

  return (
    <>
      <div className="pagehead">
        <div><h1>Reports</h1><p className="sub">{REPORTS.find((x) => x[0] === r)?.[2]}. {fmtDay(from)} – {fmtDay(to)}.</p></div>
        <form className="row" action="/reports">
          <input type="hidden" name="r" value={r} />
          <label className="field">From<input type="date" name="from" defaultValue={from} /></label>
          <label className="field">To<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn" style={{ alignSelf: "end" }}>Update</button>
        </form>
      </div>
      <nav className="tabs">{REPORTS.map(([k, label]) => <Link key={k} href={q(k)} aria-current={r === k ? "page" : undefined}>{label}</Link>)}</nav>
      {body}
      <p className="small muted">Average labour cost rate in this period: {money(avgCost)}/h. Every figure comes from the same time blocks as timesheets and jobsheets.</p>
    </>
  );
}
