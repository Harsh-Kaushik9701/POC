import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { appNow, fmtDay, fmtTime, localDate } from "@/lib/time";
import { dur, money, pct } from "@/lib/format";
import { projectDetail } from "@/server/jobsheets";

export const dynamic = "force-dynamic";

const TASK_STATUS: Record<string, string> = { done: "ok", in_progress: "info", paused: "warn", blocked: "bad", ready: "mute", todo: "mute" };

export default async function JobsheetDetail({ params }: { params: Promise<{ projectId: string }> }) {
  const u = await requireUser("jobsheets.view");
  const { projectId } = await params;
  const d = await projectDetail(projectId);
  if (!d) notFound();
  const showCost = can(u.role, "costs.view");
  const now = appNow();
  const sec = (s: { startAt: Date; endAt: Date | null }) => ((s.endAt?.getTime() ?? now) - s.startAt.getTime()) / 1000;

  const perTask = new Map<string, { direct: number; waiting: number; cost: number; workers: Map<string, number> }>();
  const people = new Map<string, string>();
  const matrix = new Map<string, Map<string, number>>(); // employee -> date -> seconds
  for (const { s, e } of d.segs) {
    if (!s.taskId) continue;
    const v = perTask.get(s.taskId) ?? { direct: 0, waiting: 0, cost: 0, workers: new Map() };
    const x = sec(s);
    if (s.kind === "direct") {
      v.direct += x; v.cost += (x / 3600) * (s.costRateCents ?? 0);
      v.workers.set(e.firstName, (v.workers.get(e.firstName) ?? 0) + x);
      people.set(e.id, `${e.firstName} ${e.lastName}`);
      const m = matrix.get(e.id) ?? new Map(); m.set(s.workDate, (m.get(s.workDate) ?? 0) + x); matrix.set(e.id, m);
    } else if (s.kind === "waiting") v.waiting += x;
    perTask.set(s.taskId, v);
  }
  const dates = [...new Set(d.segs.filter((x) => x.s.kind === "direct").map((x) => x.s.workDate))].sort();
  const totals = [...perTask.values()].reduce((a, v) => ({ direct: a.direct + v.direct, waiting: a.waiting + v.waiting, cost: a.cost + v.cost }), { direct: 0, waiting: 0, cost: 0 });
  const stdTotal = d.tasks.reduce((a, x) => a + x.tk.standardMinutes, 0);
  const doneStd = d.tasks.filter((x) => x.tk.status === "done").reduce((a, x) => a + x.tk.standardMinutes, 0);
  const doneActual = d.tasks.filter((x) => x.tk.status === "done").reduce((a, x) => a + (perTask.get(x.tk.id)?.direct ?? 0), 0);
  const recent = [...d.segs].filter((x) => x.s.kind === "direct" || x.s.kind === "waiting").reverse().slice(0, 25);
  const taskCode = (id: string | null) => d.tasks.find((x) => x.tk.id === id)?.tk.code ?? "";

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow"><Link href="/jobsheets">Jobsheets</Link></div>
          <h1><span className="mono">{d.p.code}</span> {d.p.name}</h1>
          <p className="sub">{d.c?.name ?? "Internal job"}{d.c?.suburb ? ` · ${d.c.suburb}` : ""} · {d.p.startDate ? fmtDay(d.p.startDate) : "–"} to {d.p.dueDate ? fmtDay(d.p.dueDate) : "–"} · <span className="pill mute">{d.p.status}</span></p>
          {d.p.description && <p style={{ marginTop: 6, maxWidth: "70ch" }}>{d.p.description}</p>}
        </div>
        <div className="row">
          <a className="btn" href={`/api/v1/exports/jobsheet/${projectId}`}>Download CSV</a>
          {can(u.role, "setup.jobs") && <Link className="btn" href={`/setup/jobs/${projectId}`}>Edit job</Link>}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><small>Tasks done</small><b>{d.tasks.filter((x) => x.tk.status === "done").length}/{d.tasks.length}</b></div>
        <div className="kpi"><small>Actual time</small><b>{dur(totals.direct)}</b></div>
        <div className="kpi"><small>Standard time</small><b>{dur(stdTotal * 60)}</b></div>
        <div className="kpi" title="Time booked ÷ budget"><small>Budget used</small><b>{d.p.budgetMinutes ? pct(totals.direct / 60 / d.p.budgetMinutes) : "–"}</b></div>
        <div className="kpi" title="Standard time of finished tasks ÷ time spent on them"><small>Efficiency (done tasks)</small><b>{doneActual ? pct((doneStd * 60) / doneActual) : "–"}</b></div>
        <div className={`kpi ${totals.waiting > 3600 ? "warn" : ""}`} title="Workers blocked waiting on parts, drawings or machines for this job"><small>Waiting time</small><b>{dur(totals.waiting)}</b></div>
        {showCost && <div className="kpi"><small>Labour cost</small><b>{money(totals.cost)}</b></div>}
        {showCost && <div className="kpi"><small>Quote</small><b>{money(d.p.quoteCents)}</b></div>}
      </div>

      {(d.parent || d.children.length > 0 || d.links.length > 0 || d.activities.length > 0) && (
        <div className="row">
          {d.parent && <span className="chip">Sub-job of <Link href={`/jobsheets/${d.parent.id}`}>{d.parent.code}</Link></span>}
          {d.children.map((c) => <span key={c.id} className="chip">Sub-job <Link href={`/jobsheets/${c.id}`}>{c.code}</Link></span>)}
          {d.links.map((l) => <span key={l.l.id} className="chip">{l.l.linkType.replace("_", " ")} <Link href={`/jobsheets/${l.from.id}`}>{l.from.code}</Link></span>)}
          {d.activities.map((a) => <span key={a.id} className="chip"><i className="dot" style={{ background: a.colour }} />{a.name}</span>)}
        </div>
      )}

      <section className="panel">
        <header><h2>Tasks</h2></header>
        <div className="tbl"><table>
          <thead><tr><th>Task</th><th>Activity</th><th>Status</th><th className="num">Standard</th><th className="num">Actual</th><th>Progress</th><th className="num">Waiting</th><th>Who worked on it</th>{showCost && <th className="num">Cost</th>}</tr></thead>
          <tbody>
            {d.tasks.map(({ tk, a }) => {
              const v = perTask.get(tk.id);
              const ratio = v ? v.direct / 60 / tk.standardMinutes : 0;
              const dep = d.deps.filter((x) => x.taskId === tk.id).map((x) => taskCode(x.dependsOnTaskId));
              return (
                <tr key={tk.id}>
                  <td><b className="mono">{tk.code}</b> {tk.name}{dep.length ? <div className="muted small">After {dep.join(", ")}</div> : null}</td>
                  <td className="small">{a?.name}</td>
                  <td><span className={`pill ${TASK_STATUS[tk.status] ?? "mute"}`}>{tk.status.replace("_", " ")}</span></td>
                  <td className="num">{dur(tk.standardMinutes * 60)}</td>
                  <td className="num">{v ? dur(v.direct) : "–"}</td>
                  <td style={{ minWidth: 110 }}><div className="pbar"><i className={ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div><span className="small mono">{v ? pct(ratio) : ""}</span></td>
                  <td className="num">{v?.waiting ? dur(v.waiting) : "–"}</td>
                  <td>{v ? [...v.workers.entries()].map(([n, s]) => <span key={n} className="chip" style={{ marginRight: 4 }}>{n} {dur(s)}</span>) : <span className="muted small">Nobody yet</span>}</td>
                  {showCost && <td className="num">{v ? money(v.cost) : "–"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>

      {dates.length > 0 && (
        <section className="panel">
          <header><h2>Who worked when</h2><span className="muted small">Hours on this job per worker per day</span></header>
          <div className="tbl"><table>
            <thead><tr><th>Worker</th>{dates.map((dt) => <th key={dt} className="num">{fmtDay(dt)}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {[...matrix.entries()].map(([eid, m]) => (
                <tr key={eid}>
                  <td><Link href={`/timesheets/${eid}`}>{people.get(eid)}</Link></td>
                  {dates.map((dt) => <td key={dt} className="num">{m.get(dt) ? <Link href={`/timesheets/${eid}/${dt}`}>{(m.get(dt)! / 3600).toFixed(1)}</Link> : <span className="muted">–</span>}</td>)}
                  <td className="num"><b>{([...m.values()].reduce((a, x) => a + x, 0) / 3600).toFixed(1)}</b></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      <section className="panel">
        <header><h2>Latest activity</h2></header>
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th className="num">From</th><th className="num">To</th><th>Worker</th><th>Task</th><th>Type</th><th className="num">Time</th></tr></thead>
          <tbody>
            {recent.map(({ s, e, c }) => (
              <tr key={s.id}>
                <td>{fmtDay(localDate(s.startAt.getTime()))}</td><td className="num">{fmtTime(s.startAt)}</td><td className="num">{s.endAt ? fmtTime(s.endAt) : "now"}</td>
                <td>{e.firstName} {e.lastName}</td><td className="mono">{taskCode(s.taskId)}</td>
                <td>{s.kind === "waiting" ? <span className="pill warn nocap">{c?.name ?? "Waiting"}</span> : "On job"}</td>
                <td className="num">{dur(sec(s))}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={7} className="muted">No time booked yet</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
