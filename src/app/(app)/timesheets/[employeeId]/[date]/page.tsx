import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { addDays, appNow, fmtDayLong, fmtTime, minToHHMM, mondayOf, todayLocal } from "@/lib/time";
import { dur, EVENT_LABEL, KIND_LABEL, money } from "@/lib/format";
import { Timeline, Legend } from "@/components/Timeline";
import { KpiTiles } from "@/components/KpiTiles";
import { workerDay, pickLists } from "@/server/timesheets";
import { addPunch, voidEvent, setDayStatus } from "../../actions";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, [string, string]> = {
  approved: ["Approved", "ok"], needs_review: ["Needs review", "warn"], open: ["Not approved yet", "mute"], locked: ["Locked (exported)", "info"],
};

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  return { title: `Day ${(await params).date}` };
}

export default async function WorkerDayPage({ params, searchParams }: {
  params: Promise<{ employeeId: string; date: string }>; searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const u = await requireUser("timesheets.view");
  const { employeeId, date } = await params;
  const sp = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const data = await workerDay(employeeId, date);
  if (!data) notFound();
  const { emp, day, segs, events, alerts, corrections, approver } = data;
  const { tasks, codes, activities } = await pickLists();
  const canCorrect = can(u.role, "timesheets.correct") && day?.status !== "locked";
  const canApprove = can(u.role, "timesheets.approve");
  const showCost = can(u.role, "costs.view");
  const now = appNow();
  const name = `${emp.e.firstName} ${emp.e.lastName}`;
  const voided = new Set(events.filter((x) => x.ev.type === "VOID").map((x) => x.ev.supersedesEventId));

  // Time per task and per code
  const byTask = new Map<string, { code: string; name: string; project: string; s: number; cost: number; std: number }>();
  const byCode = new Map<string, { name: string; kind: string; s: number }>();
  for (const { s, tk, p, c, a } of segs) {
    const sec = ((s.endAt?.getTime() ?? now) - s.startAt.getTime()) / 1000;
    if (s.kind === "direct" && tk) {
      const v = byTask.get(tk.id) ?? { code: tk.code, name: tk.name, project: p?.code ?? "", s: 0, cost: 0, std: tk.standardMinutes };
      v.s += sec; v.cost += (sec / 3600) * (s.costRateCents ?? 0); byTask.set(tk.id, v);
    } else if (s.kind === "direct") {
      const key = `act:${a?.id ?? "none"}`;
      const v = byTask.get(key) ?? { code: a?.code ?? "–", name: `${a?.name ?? "General work"} (general activity)`, project: "No job", s: 0, cost: 0, std: 0 };
      v.s += sec; v.cost += (sec / 3600) * (s.costRateCents ?? 0); byTask.set(key, v);
    } else if (c) {
      const v = byCode.get(c.id) ?? { name: c.name, kind: s.kind, s: 0 };
      v.s += sec; byCode.set(c.id, v);
    }
  }
  const pins = alerts.filter((a) => a.type === "idle_threshold").map((a) => a.openedAt.getTime());
  const isToday = date === todayLocal();

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow"><Link href={`/timesheets?week=${mondayOf(date)}`}>Timesheets</Link> / <Link href={`/timesheets/${employeeId}?week=${mondayOf(date)}`}>{name}</Link></div>
          <h1>{name} · {fmtDayLong(date)}</h1>
          <p className="sub">{emp.e.trade} · {emp.d?.name} · rostered {minToHHMM(emp.w.startMin)}–{minToHHMM(emp.w.endMin)}{day ? <> · on site {fmtTime(day.firstIn)}–{day.isOpen ? "now" : fmtTime(day.lastOut)}</> : null}</p>
        </div>
        <div className="row">
          <Link className="btn" href={`/timesheets/${employeeId}/${addDays(date, -1)}`}>← Previous day</Link>
          <Link className="btn" href={`/timesheets/${employeeId}/${addDays(date, 1)}`}>Next day →</Link>
        </div>
      </div>
      {sp.ok && <div className="flash" role="status">{sp.ok}</div>}
      {sp.err && <div className="flash err" role="alert">{sp.err}</div>}

      {!day ? (
        <div className="panel empty">No time recorded for {emp.e.firstName} on this day.</div>
      ) : (
        <>
          <div className="spread">
            <div className="row">
              <span className={`pill ${STATUS_PILL[day.status]?.[1]}`}>{day.isOpen ? "Clocked on now" : STATUS_PILL[day.status]?.[0]}</span>
              {approver && day.status === "approved" && <span className="muted small">by {approver.name}{day.approvedAt ? ` · ${fmtTime(day.approvedAt)}` : ""}</span>}
              {day.flags.map((f) => <span key={f} className="chip">{f.replace(/_/g, " ")}</span>)}
              {day.lateMin > 0 && <span className="pill warn">Late {day.lateMin} min</span>}
              <span className="chip" title="Jobs and activities started">{day.startCount} started</span>
              <span className="chip" title="Jobs and activities marked finished">{day.finishedCount} finished</span>
              <span className="chip" title="Smoko and lunch breaks taken">{day.breakCount} break{day.breakCount === 1 ? "" : "s"} · {Math.round((day.breakPaidS + day.breakUnpaidS) / 60)} min</span>
            </div>
            {!day.isOpen && (
              <div className="row">
                {canApprove && day.status !== "approved" && day.status !== "locked" && (
                  <form action={setDayStatus}><input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="date" value={date} /><input type="hidden" name="status" value="approved" /><button className="btn primary">Approve day</button></form>
                )}
                {canApprove && day.status === "approved" && (
                  <form action={setDayStatus}><input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="date" value={date} /><input type="hidden" name="status" value="open" /><button className="btn">Unapprove</button></form>
                )}
              </div>
            )}
          </div>

          <KpiTiles t={day} />

          <section className="panel">
            <header><h2>Timeline</h2><span className="muted small">Hover a block for times. Red pins are idle alerts.</span></header>
            <Timeline
              segs={segs.map(({ s, tk, c, a }) => ({ kind: s.kind, start: s.startAt.getTime(), end: s.endAt?.getTime() ?? null, label: tk?.code ?? c?.code ?? (s.kind === "direct" ? a?.code : null) ?? (s.kind === "unallocated" ? "idle" : null), title: tk ? `${tk.code} ${tk.name}` : c?.name ?? (s.kind === "direct" ? `${a?.name ?? "General work"} (no job)` : null) }))}
              shiftStart={day.schedStart?.getTime()} shiftEnd={day.schedEnd?.getTime()} now={isToday ? now : null} pins={pins} />
            <Legend />
          </section>

          <div className="grid2">
            <section className="panel">
              <header><h2>Jobs &amp; activities worked</h2></header>
              <div className="tbl"><table>
                <thead><tr><th>Task</th><th>Job</th><th className="num">Time</th><th className="num">Standard</th>{showCost && <th className="num">Labour cost</th>}</tr></thead>
                <tbody>
                  {[...byTask.entries()].map(([id, v]) => (
                    <tr key={id}><td><b className="mono">{v.code}</b> {v.name}</td><td className="mono">{v.project}</td><td className="num">{dur(v.s)}</td><td className="num">{dur(v.std * 60)}</td>{showCost && <td className="num">{money(v.cost)}</td>}</tr>
                  ))}
                  {!byTask.size && <tr><td colSpan={5} className="muted">No job time</td></tr>}
                </tbody>
              </table></div>
              {byCode.size > 0 && (
                <div className="tbl"><table>
                  <thead><tr><th>Other time</th><th>Type</th><th className="num">Time</th></tr></thead>
                  <tbody>{[...byCode.values()].map((v) => <tr key={v.name}><td>{v.name}</td><td>{KIND_LABEL[v.kind] ?? v.kind}</td><td className="num">{dur(v.s)}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>

            <section className="panel">
              <header><h2>Alerts</h2></header>
              {alerts.length === 0 && <p className="muted">No alerts.</p>}
              {alerts.map((a) => (
                <div key={a.id} className="row small" style={{ alignItems: "baseline" }}>
                  <span className={`pill ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}`}>{a.type.replace(/_/g, " ")}</span>
                  <span className="mono">{fmtTime(a.openedAt)}</span><span>{a.message}</span>
                </div>
              ))}
              {corrections.length > 0 && (<>
                <h3>Corrections</h3>
                {corrections.map(({ c, u: by }) => <p key={c.id} className="small">{c.action === "add_event" ? "Added a punch" : "Removed a punch"} · {by?.name ?? "system"} · {c.reason}</p>)}
              </>)}
            </section>
          </div>
        </>
      )}

      <section className="panel">
        <header><h2>Every tap</h2><span className="muted small">The punch log is never edited. Corrections add new entries.</span></header>
        <div className="tbl"><table>
          <thead><tr><th>Time</th><th>What</th><th>Detail</th><th>Where</th><th>How</th><th>Photo</th>{canCorrect && <th />}</tr></thead>
          <tbody>
            {events.map(({ ev, tk, c, dv, u: actor, a }) => {
              const gone = voided.has(ev.id);
              return (
                <tr key={ev.id} style={gone ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                  <td className="num">{fmtTime(ev.occurredAt)}</td>
                  <td>{EVENT_LABEL[ev.type] ?? ev.type}</td>
                  <td>{c ? <>{c.name}{tk ? " · " : ""}</> : null}{tk ? <><b className="mono">{tk.code}</b> {tk.name}</> : a ? <>{a.name} <span className="muted small">(general activity)</span></> : null}{ev.note ? <div className="muted small">{ev.note}</div> : null}</td>
                  <td className="small">{dv?.name ?? (ev.source === "system" ? "System" : ev.source === "web" ? `Web · ${actor?.name ?? ""}` : ev.source)}</td>
                  <td className="small">{ev.method === "nfc" ? "Fob" : ev.method === "pin" ? <span className="pill warn">PIN</span> : ev.method === "manager" ? "Manager" : ev.method}{ev.wasOffline ? <span className="pill info">offline</span> : null}</td>
                  <td>{ev.photoKey ? <a href={`/api/v1/photos/${ev.photoKey}`} target="_blank"><img src={`/api/v1/photos/${ev.photoKey}`} alt={`Photo at ${fmtTime(ev.occurredAt)}`} width={48} height={36} style={{ objectFit: "cover", borderRadius: 4 }} /></a> : <span className="muted small">–</span>}</td>
                  {canCorrect && <td>{!gone && ev.type !== "VOID" && (
                    <form action={voidEvent} className="row">
                      <input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="date" value={date} /><input type="hidden" name="eventId" value={ev.id} />
                      <input name="reason" placeholder="Reason" aria-label="Reason for removing" style={{ width: 120 }} />
                      <button className="btn sm danger">Remove</button>
                    </form>
                  )}</td>}
                </tr>
              );
            })}
            {!events.length && <tr><td colSpan={7} className="muted">No taps</td></tr>}
          </tbody>
        </table></div>
      </section>

      {canCorrect && (
        <section className="panel">
          <header><h2>Add a missed punch</h2><span className="muted small">For a forgotten clock-off, job start or break. The day is recalculated and needs approving again.</span></header>
          <form action={addPunch} className="form">
            <input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="date" value={date} />
            <label className="field">What happened
              <select name="type" defaultValue="CLOCK_OUT">
                <option value="CLOCK_IN">Clocked on</option><option value="CLOCK_OUT">Clocked off</option>
                <option value="TASK_START">Started a task or activity</option><option value="TASK_FINISH">Finished a task or activity</option><option value="TASK_PAUSE">Paused a task</option>
                <option value="CODE_START">Started a code</option><option value="CODE_END">Ended a code</option>
                <option value="BREAK_START">Started a break</option><option value="BREAK_END">Back from break</option>
              </select>
            </label>
            <label className="field">Time (24 h)<input name="time" placeholder="15:30" required pattern="\d{1,2}:\d{2}" /></label>
            <label className="field">Task (if a task)
              <select name="taskId" defaultValue=""><option value="">–</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select>
            </label>
            <label className="field">General activity (if no task)
              <select name="activityTypeId" defaultValue=""><option value="">–</option>{activities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </label>
            <label className="field">Code or break (if a code)
              <select name="timeCodeId" defaultValue=""><option value="">–</option>{codes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </label>
            <label className="field wide">Reason (required)<input name="reason" required placeholder="e.g. Forgot to tap off, confirmed with leading hand" /></label>
            <div><button className="btn primary">Add punch</button></div>
          </form>
        </section>
      )}
    </>
  );
}
