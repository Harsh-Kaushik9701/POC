"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { getFloor, FloorWorker, QueueTask } from "@/server/floor";

type Floor = Awaited<ReturnType<typeof getFloor>>;

const LANES: { key: string; title: string; states: string[]; dot: string }[] = [
  { key: "idle", title: "Idle", states: ["unallocated"], dot: "c-unallocated" },
  { key: "waiting", title: "Waiting", states: ["waiting"], dot: "c-waiting" },
  { key: "indirect", title: "Indirect work", states: ["indirect"], dot: "c-indirect" },
  { key: "direct", title: "On a job", states: ["direct"], dot: "c-direct" },
  { key: "break", title: "On a break", states: ["break_paid", "break_unpaid"], dot: "c-break_paid" },
  { key: "early", title: "Clocked on outside shift", states: ["pre_shift", "post_shift"], dot: "c-off" },
  { key: "notin", title: "Not in yet", states: ["not_in"], dot: "c-off" },
  { key: "gone", title: "Gone home", states: ["gone"], dot: "c-off" },
];

const tf = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hm = (ms: number | null) => (ms ? tf.format(new Date(ms)) : "–");
const mins = (ms: number) => Math.max(0, Math.floor(ms / 60_000));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export function FloorBoard({ initial, canAssign }: { initial: Floor; canAssign: boolean }) {
  const [data, setData] = useState<Floor>(initial);
  const [offset] = useState(() => initial.now - Date.now());
  const [now, setNow] = useState(initial.now);
  const [sel, setSel] = useState<string | null>(null);
  const [startNow, setStartNow] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [tv, setTv] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/floor", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* keep last data; next poll retries */ }
  }, []);
  useEffect(() => {
    const p = setInterval(refresh, 5000);
    const c = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => { clearInterval(p); clearInterval(c); };
  }, [refresh, offset]);
  useEffect(() => { document.documentElement.classList.toggle("tv", tv); return () => document.documentElement.classList.remove("tv"); }, [tv]);

  const selTask = useMemo(() => data.queue.find((q) => q.id === sel) ?? null, [data.queue, sel]);

  async function assign(taskId: string, w: FloorWorker) {
    const task = data.queue.find((q) => q.id === taskId);
    setMsg(null);
    const r = await fetch("/api/v1/floor/assign", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, employeeId: w.id, startNow: startNow && w.state !== "not_in" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ text: j.error ?? "Couldn't assign the task", err: true }); return; }
    setMsg({ text: startNow ? `${w.first} is now on ${task?.code}. The timer has started.` : `${task?.code} assigned to ${w.first}. It shows first on the kiosk at his next tap.` });
    setSel(null);
    refresh();
  }
  async function ack(id: string) {
    await fetch("/api/v1/alerts/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    refresh();
  }

  const t = data.tiles;
  const tile = (label: string, value: string | number, cls = "", title?: string) => (
    <div className={`kpi ${cls}`} title={title}><small>{label}</small><b>{value}</b></div>
  );

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Floor board</h1>
          <p className="sub">Who is doing what right now. Idle workers are at the top. Updates every 5 seconds.</p>
        </div>
        <div className="row">
          <span className="clockchip">{hm(now)}</span>
          <Link className="btn" href="/idle">Idle ranking</Link>
          <button className="btn" onClick={() => setTv(!tv)}>{tv ? "Exit TV mode" : "TV mode"}</button>
        </div>
      </div>

      <div className="kpis">
        {tile("On site / rostered", `${t.onSite} / ${t.expected}`)}
        {tile("Idle now", t.idle, t.idle ? "bad" : "")}
        {tile(`Idle over ${data.idleAlertMin} min`, t.idleOver, t.idleOver ? "bad" : "")}
        {tile("Waiting now", t.waiting, t.waiting ? "warn" : "")}
        {tile("On jobs", t.onJobs, "good")}
        {tile("Not in yet", t.notIn)}
        {tile("Tasks over standard", t.overStandard, t.overStandard ? "warn" : "")}
        {tile("Unassigned tasks", t.queue)}
        {tile("Utilisation today", t.utilisation == null ? "–" : `${Math.round(t.utilisation * 100)}%`, "", "Time on jobs ÷ available time, all staff, today so far")}
      </div>

      {msg && <div className={`flash${msg.err ? " err" : ""}`} role="status">{msg.text}</div>}

      <div className="board">
        <div className="stack">
          {LANES.map((lane) => {
            const ws = data.workers.filter((w) => lane.states.includes(w.state))
              .sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
            if (!ws.length) return null;
            return (
              <section key={lane.key} className="lane">
                <h3><i className={`dot ${lane.dot}`} />{lane.title} <span className="muted mono small">{ws.length}</span></h3>
                <div className="cards">
                  {ws.map((w) => (
                    <Card key={w.id} w={w} now={now} idleAlertMin={data.idleAlertMin} selTask={selTask} canAssign={canAssign}
                      onAssign={(tid) => assign(tid, w)} dragOver={dragOver === w.id} setDragOver={setDragOver} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="stack">
          <section className="panel">
            <header><h3>Ready to start</h3><span className="muted small">{data.queue.length} tasks</span></header>
            {canAssign ? (
              <>
                <p className="small muted">Pick a task (or drag it) onto a worker. Idle workers show an Assign button.</p>
                <label className="row small"><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Start the task for them now</label>
              </>
            ) : <p className="small muted">Your role can view but not assign work.</p>}
            <div className="stack" style={{ maxHeight: 520, overflow: "auto" }}>
              {data.queue.map((q) => <QueueItem key={q.id} q={q} selected={sel === q.id} onSelect={() => setSel(sel === q.id ? null : q.id)} canAssign={canAssign} />)}
              {!data.queue.length && <p className="empty">No ready tasks. Add some under Jobs &amp; tasks.</p>}
            </div>
          </section>
          <section className="panel">
            <header><h3>Alerts today</h3><Link href="/exceptions" className="small">All exceptions</Link></header>
            {data.alerts.length === 0 && <p className="muted small">Nothing needs attention.</p>}
            {data.alerts.map((a) => (
              <div key={a.id} className="spread small" style={{ alignItems: "flex-start" }}>
                <span><span className={`pill ${a.type === "idle_threshold" ? "bad" : "warn"}`}>{a.type === "idle_threshold" ? "Idle" : a.type.replace(/_/g, " ")}</span> <span className="mono">{hm(a.openedAt)}</span><br />{a.message}{a.resolved ? " · back on task" : ""}</span>
                <button className="btn sm" onClick={() => ack(a.id)}>Dismiss</button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}

function QueueItem({ q, selected, onSelect, canAssign }: { q: QueueTask; selected: boolean; onSelect: () => void; canAssign: boolean }) {
  const p = Math.min(100, (q.spentS / 60 / q.std) * 100);
  return (
    <button className="qitem" aria-pressed={selected} onClick={onSelect} disabled={!canAssign} draggable={canAssign}
      onDragStart={(e) => { e.dataTransfer.setData("text/task", q.id); e.dataTransfer.effectAllowed = "move"; }}>
      <span className="spread"><b>{q.code}</b>{q.priority === 1 ? <span className="pill bad">Urgent</span> : q.status === "paused" ? <span className="pill warn">Paused</span> : null}</span>
      <span>{q.name}</span>
      <span className="muted small">{q.projectCode} · {q.projectName}</span>
      <span className="mono small muted">{fmtMin(Math.round(q.spentS / 60))} of {fmtMin(q.std)} · {q.bay ?? ""}{q.activity ? ` · ${q.activity}` : ""}</span>
      <span className="pbar"><i style={{ width: `${p}%` }} /></span>
      {q.assignedTo.length ? <span className="small">Assigned: {q.assignedTo.join(", ")}</span> : null}
    </button>
  );
}

function Card({ w, now, idleAlertMin, selTask, canAssign, onAssign, dragOver, setDragOver }: {
  w: FloorWorker; now: number; idleAlertMin: number; selTask: QueueTask | null; canAssign: boolean;
  onAssign: (taskId: string) => void; dragOver: boolean; setDragOver: (id: string | null) => void;
}) {
  const inState = w.since ? mins(now - w.since) : 0;
  const idle = w.state === "unallocated";
  const alarm = idle && inState > idleAlertMin;
  const assignable = canAssign && !["gone", "day_off"].includes(w.state);
  let detail: React.ReactNode = null;
  if (w.state === "direct" && w.task) {
    const spentMin = Math.round(w.task.spentS / 60) + 0;
    const over = spentMin > w.task.std;
    detail = (<>
      <span><b className="mono">{w.task.code}</b> {w.task.name}</span>
      <span className="pbar"><i className={over ? "over" : ""} style={{ width: `${Math.min(100, (spentMin / w.task.std) * 100)}%` }} /></span>
      <span className="tm">{fmtMin(inState)} this stint · job total {fmtMin(spentMin)} of {fmtMin(w.task.std)}</span>
    </>);
  } else if (w.state === "direct" && w.activity) {
    detail = (<><span><b>{w.activity}</b> · general activity, no job</span><span className="tm">{fmtMin(inState)} this stint</span></>);
  } else if (w.state === "waiting" || w.state === "indirect") {
    detail = (<><span>{w.code?.name ?? "Code"}{w.task ? <> · <b className="mono">{w.task.code}</b></> : null}</span><span className="tm">for {fmtMin(inState)}</span></>);
  } else if (w.state === "break_paid" || w.state === "break_unpaid") {
    detail = <span className="tm">{w.state === "break_paid" ? "Smoko" : "Lunch"} · {fmtMin(inState)}</span>;
  } else if (idle || w.state === "pre_shift" || w.state === "post_shift") {
    detail = <span className="tm">{idle ? "Idle" : "Clocked on"} for {fmtMin(inState)}{alarm ? " · supervisor alerted" : ""}</span>;
  } else if (w.state === "not_in") {
    detail = <span className="tm">{w.late ? "Late: not clocked on" : "Not clocked on"}</span>;
  } else if (w.state === "gone") {
    detail = <span className="tm">{hm(w.firstIn)}–{hm(w.lastOut)}</span>;
  }
  return (
    <div className={`wcard k-${w.state}${alarm ? " alarm" : ""}${dragOver ? " drop" : ""}`}
      onDragOver={(e) => { if (assignable) { e.preventDefault(); setDragOver(w.id); } }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/task"); if (id) onAssign(id); }}>
      <div className="who">
        <span className="avatar" style={{ background: w.colour }}>{w.first[0]}{w.last[0]}</span>
        <span style={{ minWidth: 0 }}><Link href={`/timesheets/${w.id}`}><b>{w.name}</b></Link><br /><span className="muted small">{w.trade}</span></span>
      </div>
      {detail}
      {w.today ? <span className="small muted">Today: {pct(w.today.directS, w.today.availableS)} on jobs · idle {fmtMin(Math.round(w.today.unallocatedS / 60))}</span> : null}
      {w.next.length ? <span className="small">Next: <b className="mono">{w.next[0].code}</b> {w.next[0].name}</span> : null}
      {assignable && (idle || w.state === "pre_shift" || selTask) ? (
        <button className={`btn sm ${selTask ? "tape" : ""}`} disabled={!selTask} onClick={() => selTask && onAssign(selTask.id)}>
          {selTask ? `Assign ${selTask.code}` : "Select a task to assign"}
        </button>
      ) : null}
    </div>
  );
}
