"use client";
/**
 * Wall kiosk / station terminal (runs in the browser for this POC; the production app is an
 * Expo build reading NFC chip IDs natively). A USB NFC reader in "keyboard" mode works here too:
 * it types the fob's UID followed by Enter, which this page listens for.
 *
 * Offline: the roster is cached, punches go to a local outbox with a client-made UUIDv7 and the
 * device time, and are sent when the connection returns. The server de-duplicates by id.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Emp = { id: string; code: string; first: string; last: string; trade: string; colour: string; skills: string[]; tags: { id: string; uid: string; label: string | null }[]; assigned: string[] };
type Task = { id: string; code: string; name: string; std: number; status: string; priority: number; bay: string | null; activity: string | null; activityCode: string | null; projectCode: string; projectName: string; onIt: string | null };
type Code = { id: string; code: string; name: string; category: string; isPaid: boolean; requiresTask: boolean; maxMinutes: number | null };
type Activity = { id: string; code: string; name: string; colour: string };
type Roster = { serverNow: number; org: { name: string }; device: { id: string; name: string; kind: string; fixedTaskId: string | null; photoRequired: boolean; pinFallback: boolean }; undoSeconds: number; employees: Emp[]; tasks: Task[]; codes: Code[]; activities?: Activity[] };
type WState = { kind: string; since: number | null; taskId: string | null; activityTypeId?: string | null; timeCodeId: string | null };
type Today = { firstIn: number | null; paidS: number; directS: number; indirectS: number; waitingS: number; unallocatedS: number; breakS: number; breakCount: number; finishedCount: number; startCount: number };
type TLItem = { kind: string; start: number; end: number | null; label: string | null; finished: boolean };
type Ev = { id: string; employeeId: string; type: string; taskId?: string | null; activityTypeId?: string | null; timeCodeId?: string | null; supersedesEventId?: string | null; credentialId?: string | null; method: "nfc" | "pin"; deviceTime: number; offline: boolean; photoKey?: string | null };
type RLine = { kind: "in" | "out" | "start" | "end" | "break"; title: string; detail: string; dur?: string };
type Screen = { s: "attract" } | { s: "pin" } | { s: "menu" } | { s: "day" } | { s: "tasks"; mode: "start" | "wait"; codeId?: string; clockOn?: boolean; banner?: RLine[] } | { s: "codes" } | { s: "finishOff" } | { s: "confirm"; tone: string; title: string; text: string; undo?: { evId: string; until: number }; receipt?: RLine[] };

const LS = { device: "sf-device", roster: "sf-roster", outbox: "sf-outbox" };
const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
function uuidv7(ms = Date.now()) {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const tf = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const df = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "long", day: "numeric", month: "long" });
const fm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`);
const STATE_TXT: Record<string, [string, string]> = {
  off: ["Not clocked on", "#6f7a8c"], unallocated: ["Clocked on · not on a job", "#d54141"], pre_shift: ["Clocked on early", "#6f7a8c"], post_shift: ["Clocked on after hours", "#6f7a8c"],
  direct: ["On a job", "#2e9e5e"], indirect: ["Indirect work", "#3f78cc"], waiting: ["Waiting", "#d08e1c"], break_paid: ["On smoko", "#6f7a8c"], break_unpaid: ["On lunch", "#6f7a8c"],
};

export function Kiosk({ initialToken }: { initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [skew, setSkew] = useState(0);
  const [online, setOnline] = useState(true);
  const [outbox, setOutbox] = useState<Ev[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>({ s: "attract" });
  const [emp, setEmp] = useState<Emp | null>(null);
  const [cred, setCred] = useState<{ id: string | null; method: "nfc" | "pin" } | null>(null);
  const [wstate, setWstate] = useState<WState | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [timeline, setTimeline] = useState<TLItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [pin, setPin] = useState({ code: "", pin: "", field: "code" as "code" | "pin" });
  const [showDemo, setShowDemo] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [camOk, setCamOk] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wedge = useRef("");

  const headers = useMemo(() => ({ "content-type": "application/json", "x-device-token": token ?? "", "x-app-version": "kiosk-web-0.1" }), [token]);
  const appNow = now + skew;

  // Token from URL or storage
  useEffect(() => {
    if (initialToken) ls.set(LS.device, initialToken);
    else setToken(ls.get<string | null>(LS.device, null));
    setOutbox(ls.get<Ev[]>(LS.outbox, []));
    const cached = ls.get<Roster | null>(LS.roster, null);
    if (cached) setRoster(cached);
  }, [initialToken]);

  const loadRoster = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/v1/device/roster", { headers, cache: "no-store" });
      if (r.status === 401) { setErr("This tablet isn't paired. Ask an admin to pair it."); return; }
      const j: Roster = await r.json();
      setRoster(j); setSkew(j.serverNow - Date.now()); setOnline(true); ls.set(LS.roster, j);
    } catch { setOnline(false); }
  }, [token, headers]);
  useEffect(() => { loadRoster(); const i = setInterval(loadRoster, 60_000); return () => clearInterval(i); }, [loadRoster]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  // Camera for photo-on-punch (optional: skipped if the browser refuses)
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia?.({ video: { facingMode: "user", width: 320, height: 240 }, audio: false })
      .then((s) => { stream = s; if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); } setCamOk(true); })
      .catch(() => setCamOk(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // Send queued punches when back online
  const flush = useCallback(async () => {
    const box = ls.get<Ev[]>(LS.outbox, []);
    if (!box.length || !token) return;
    try {
      const r = await fetch("/api/v1/device/punches", { method: "POST", headers, body: JSON.stringify({ sentAt: Date.now(), events: box }) });
      if (!r.ok) return;
      const j = await r.json();
      const done = new Set<string>(j.results.map((x: { id: string }) => x.id));
      const left = box.filter((e) => !done.has(e.id));
      ls.set(LS.outbox, left); setOutbox(left); setOnline(true);
    } catch { setOnline(false); }
  }, [token, headers]);
  useEffect(() => { const i = setInterval(flush, 5000); return () => clearInterval(i); }, [flush]);

  const resetIdle = useCallback((ms = 20_000) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { setScreen({ s: "attract" }); setEmp(null); setErr(null); setSearch(""); }, ms);
  }, []);

  const loadState = useCallback(async (employeeId: string) => {
    try {
      const r = await fetch(`/api/v1/device/state?employeeId=${employeeId}`, { headers, cache: "no-store" });
      const j = await r.json();
      setWstate(j.state); setToday(j.today); setTimeline(j.timeline ?? []); setOnline(true);
    } catch { setOnline(false); setWstate({ kind: "unknown", since: null, taskId: null, timeCodeId: null }); }
  }, [headers]);

  const identify = useCallback(async (e: Emp, credentialId: string | null, method: "nfc" | "pin") => {
    setEmp(e); setCred({ id: credentialId, method }); setErr(null); setWstate(null); setToday(null); setTimeline([]);
    setScreen({ s: "menu" }); resetIdle();
    await loadState(e.id);
  }, [loadState, resetIdle]);

  // Builds the "receipt" shown after a tap: what ended (with from → to and duration) and what started.
  const receiptRef = useRef<(list: { type: string; taskId?: string | null; activityTypeId?: string | null; timeCodeId?: string | null }[]) => RLine[]>(() => []);
  const lastReceipt = useRef<RLine[]>([]);

  const tap = useCallback((uidRaw: string) => {
    const uid = uidRaw.replace(/[^0-9a-f]/gi, "").toUpperCase();
    if (!roster || !uid) return;
    for (const e of roster.employees) {
      const t = e.tags.find((x) => x.uid === uid);
      if (t) { identify(e, t.id, "nfc"); return; }
    }
    setErr(`Fob ${uid} isn't registered. See the office.`); setScreen({ s: "attract" }); resetIdle(6000);
  }, [roster, identify, resetIdle]);

  // Keyboard-wedge NFC reader: hex characters then Enter
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tgt = ev.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (ev.key === "Enter") { if (wedge.current.length >= 8) tap(wedge.current); wedge.current = ""; return; }
      if (/^[0-9a-fA-F:]$/.test(ev.key)) wedge.current += ev.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  async function snap(): Promise<string | null> {
    const v = videoRef.current;
    if (!camOk || !v || !v.videoWidth) return null;
    const c = document.createElement("canvas"); c.width = 320; c.height = 240;
    c.getContext("2d")!.drawImage(v, 0, 0, 320, 240);
    const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.7));
    if (!blob) return null;
    try {
      const r = await fetch("/api/v1/device/photo", { method: "POST", headers: { "x-device-token": token ?? "", "content-type": "image/jpeg" }, body: blob });
      return r.ok ? (await r.json()).key : null;
    } catch { return null; }
  }

  async function send(list: Omit<Ev, "id" | "employeeId" | "method" | "deviceTime" | "offline" | "credentialId">[], confirm: Omit<Extract<Screen, { s: "confirm" }>, "s" | "undo">): Promise<boolean> {
    if (!emp || !cred || busy) return false;
    setBusy(true); setErr(null);
    const receipt = list[0].type === "VOID" ? [] : receiptRef.current(list);
    lastReceipt.current = receipt;
    const photoKey = list[0].type === "VOID" ? null : await snap();
    const evs: Ev[] = list.map((x, i) => ({ ...x, id: uuidv7(Date.now() + i), employeeId: emp.id, method: cred.method, credentialId: cred.id, deviceTime: Date.now() + i, offline: false, photoKey: i === 0 ? photoKey : null }));
    try {
      const r = await fetch("/api/v1/device/punches", { method: "POST", headers, body: JSON.stringify({ sentAt: Date.now(), events: evs }) });
      if (r.status === 401) throw new Error("unpaired");
      const j = await r.json();
      const bad = j.results.find((x: { ok: boolean }) => !x.ok);
      if (bad) { setErr(bad.error); setBusy(false); resetIdle(); return false; }
      setOnline(true);
      const last = evs[evs.length - 1];
      setScreen({ s: "confirm", ...confirm, receipt, undo: list[0].type === "VOID" ? undefined : { evId: last.id, until: Date.now() + (roster?.undoSeconds ?? 60) * 1000 } });
      resetIdle(12_000);
      // Drop finished tasks from the cached list straight away (the full roster refresh follows).
      const finished = new Set(list.filter((x) => x.type === "TASK_FINISH" && x.taskId).map((x) => x.taskId as string));
      if (finished.size) setRoster((r) => (r ? { ...r, tasks: r.tasks.filter((t) => !finished.has(t.id)) } : r));
      loadRoster();
      loadState(emp.id);
    } catch {
      // Offline: queue with device time; the server corrects the clock and flags it.
      const queued = evs.map((e) => ({ ...e, offline: true }));
      const box = [...ls.get<Ev[]>(LS.outbox, []), ...queued];
      ls.set(LS.outbox, box); setOutbox(box); setOnline(false);
      setScreen({ s: "confirm", ...confirm, receipt, text: `${confirm.text} Saved on this tablet; it will send when the connection is back.` });
      resetIdle(7000);
    }
    setBusy(false);
    return true;
  }

  const taskById = (id: string | null | undefined) => roster?.tasks.find((t) => t.id === id) ?? null;
  const codeById = (id: string | null | undefined) => roster?.codes.find((c) => c.id === id) ?? null;
  const actById = (id: string | null | undefined) => roster?.activities?.find((a) => a.id === id) ?? null;
  const breakCode = (paid: boolean) => roster?.codes.find((c) => c.category === "break" && c.isPaid === paid);
  const at = tf.format(new Date(appNow));

  if (!token) return <Pair onPair={(t) => { ls.set(LS.device, t); setToken(t); }} />;

  const st = wstate?.kind ?? "loading";
  const curTask = taskById(wstate?.taskId);
  const curCode = codeById(wstate?.timeCodeId);
  const curAct = !curTask ? actById(wstate?.activityTypeId) : null;
  const curLabel = curTask ? `${curTask.code} ${curTask.name}` : curAct ? curAct.name : "your job";

  receiptRef.current = (list) => {
    const lines: RLine[] = [];
    const nowMs = appNow;
    const hmm = (ms: number) => tf.format(new Date(ms));
    const durMin = (ms: number) => fm(Math.max(0, Math.round(ms / 60000)));
    const types = list.map((x) => x.type);
    const k = wstate?.kind ?? "";
    const running = ["direct", "indirect", "waiting", "break_paid", "break_unpaid"].includes(k) && wstate?.since;
    const ends = running && types.some((x) => x !== "CLOCK_IN" && x !== "VOID");
    if (ends && wstate?.since) {
      const isBreak = k === "break_paid" || k === "break_unpaid";
      const what = isBreak ? (k === "break_paid" ? "Smoko" : "Lunch") : curTask ? `${curTask.code} ${curTask.name}` : curCode ? curCode.name : curAct ? curAct.name : "Work";
      const pausedNoReason = list.some((x) => x.type === "TASK_PAUSE" && !x.timeCodeId);
      const verb = types.includes("TASK_FINISH") ? "Finished" : isBreak ? "Back from" : pausedNoReason ? "Paused" : "Stopped";
      let detail = `${hmm(wstate.since)} → ${hmm(nowMs)}`;
      if (k === "direct") {
        const label = curTask ? `${curTask.code} ${curTask.name}` : curAct?.name;
        const earlier = timeline.filter((x) => x.kind === "direct" && x.label === label && x.end !== null).reduce((a, x) => a + (x.end! - x.start), 0);
        if (earlier > 60_000) detail += ` · ${durMin(earlier + nowMs - wstate.since)} on it today`;
      }
      lines.push({ kind: isBreak ? "break" : "end", title: `${verb}: ${what}`, detail, dur: durMin(nowMs - wstate.since) });
    }
    for (const x of list) {
      if (x.type === "CLOCK_IN") lines.push({ kind: "in", title: "Clocked on", detail: `${df.format(new Date(nowMs))}`, dur: hmm(nowMs) });
      else if (x.type === "TASK_START") {
        const tk = taskById(x.taskId); const ac = actById(x.activityTypeId);
        lines.push({ kind: "start", title: `Started: ${tk ? `${tk.code} ${tk.name}` : ac ? `${ac.name} (no job)` : "work"}`, detail: tk ? `${tk.projectName} · ${fm(tk.std)} standard` : "Timer running", dur: hmm(nowMs) });
      } else if ((x.type === "CODE_START" || (x.type === "TASK_PAUSE" && x.timeCodeId))) {
        const c = codeById(x.timeCodeId);
        lines.push({ kind: "start", title: `Started: ${c?.name ?? "other work"}`, detail: "Timer running", dur: hmm(nowMs) });
      } else if (x.type === "BREAK_START") {
        const c = codeById(x.timeCodeId);
        lines.push({ kind: "break", title: `${c?.name ?? "Break"} started`, detail: c?.maxMinutes ? `Back by ${hmm(nowMs + c.maxMinutes * 60000)}` : "Tap when you're back", dur: hmm(nowMs) });
      } else if (x.type === "CLOCK_OUT") {
        const firstIn = today?.firstIn ?? null;
        const onWork = (today?.directS ?? 0) * 1000; // includes the running stint up to when the fob was tapped
        lines.push({ kind: "out", title: "Clocked off", detail: firstIn ? `On ${hmm(firstIn)} → off ${hmm(nowMs)}` : `Off at ${hmm(nowMs)}`, dur: firstIn ? durMin(nowMs - firstIn) : hmm(nowMs) });
        if (today) lines.push({ kind: "end", title: "Your day", detail: `${today.finishedCount} finished · ${today.breakCount} break${today.breakCount === 1 ? "" : "s"} (${fm(Math.round(today.breakS / 60))})`, dur: `${fm(Math.round(onWork / 60000))} on work` });
      }
    }
    return lines;
  };
  const fixed = roster?.device.fixedTaskId ? taskById(roster.device.fixedTaskId) : null;
  const inState = wstate?.since ? Math.max(0, Math.floor((appNow - wstate.since) / 60000)) : 0;
  const first = emp?.first ?? "";

  const clockOnFirst = (clockOn?: boolean) => (clockOn ? [{ type: "CLOCK_IN" }] : []);
  const startTask = (t: Task, clockOn?: boolean) => send([...clockOnFirst(clockOn), { type: "TASK_START", taskId: t.id }],
    { tone: "go", title: `${clockOn ? `G'day ${first} · ` : ""}Started ${t.code}`, text: `${clockOn ? `Clocked on and s` : "S"}tarted ${t.name} · ${t.projectName} at ${at}. Tracking from now.` });
  const startActivity = (a: Activity, clockOn?: boolean) => send([...clockOnFirst(clockOn), { type: "TASK_START", activityTypeId: a.id }],
    { tone: "go", title: `${clockOn ? `G'day ${first} · ` : ""}On ${a.name}`, text: `${clockOn ? "Clocked on and s" : "S"}tarted ${a.name.toLowerCase()} (no job) at ${at}. Tap when you finish or switch.` });
  const openStart = (clockOn = false) => { setSearch(""); setScreen({ s: "tasks", mode: "start", clockOn }); };
  const menu = (): React.ReactNode => {
    if (!emp) return null;
    const btn = (label: string, sub: string, cls: string, on: () => void, big = false, dis = false) => (
      <button key={label} className={`k-btn ${cls}${big ? " big" : ""}`} onClick={() => { resetIdle(); on(); }} disabled={busy || dis}>{label}{sub ? <small>{sub}</small> : null}</button>
    );
    const brk = [
      btn("Smoko", "Paid · 10 min", "brk", () => { const c = breakCode(true); if (c) send([{ type: "BREAK_START", timeCodeId: c.id }], { tone: "brk", title: "Enjoy your smoko", text: `Started ${at}. Tap your fob when you're back.` }); }),
      btn("Lunch", "Unpaid · 30 min", "brk", () => { const c = breakCode(false); if (c) send([{ type: "BREAK_START", timeCodeId: c.id }], { tone: "brk", title: "Enjoy your lunch", text: `Started ${at}. Tap your fob when you're back.` }); }),
    ];
    const clockOff = btn("Clock off", "End of shift", "stop", () => {
      if (st === "direct") setScreen({ s: "finishOff" });
      else send([{ type: "CLOCK_OUT" }], { tone: "stop", title: `See you, ${first}`, text: `Clocked off at ${at}.` });
    });
    const fixedBtn = fixed && !(st === "direct" && curTask?.id === fixed.id)
      ? btn(`Start ${fixed.code}`, `${fixed.name} · this station`, "go", () => startTask(fixed), true) : null;
    switch (st) {
      case "off":
        return [
          btn("Clock on & start work", `Pick a job or activity · tracking starts ${at}`, "go", () => openStart(true), true),
          fixed ? btn(`Clock on & start ${fixed.code}`, `${fixed.name} · this station`, "go", () => startTask(fixed, true)) : null,
          btn("Clock on only", "Pick your work later", "", () => send([{ type: "CLOCK_IN" }], { tone: "go", title: `G'day ${first}`, text: `Clocked on at ${at}. Tap again to start a job or activity.` })),
        ];
      case "unallocated": case "pre_shift": case "post_shift":
        return [fixedBtn, btn("Start work", "Any job or activity", "go", () => openStart(), !fixedBtn),
          btn("Other work", "Clean-up, maintenance, toolbox, waiting…", "ind", () => setScreen({ s: "codes" })), ...brk, clockOff];
      case "direct":
        return [
          curTask && btn(`Finish ${curTask.code}`, curTask.name, "go", () => send([{ type: "TASK_FINISH", taskId: curTask.id }], { tone: "go", title: `Nice one, ${first}`, text: `${curTask.code} marked finished at ${at}. Start your next job or activity.` }), true),
          !curTask && btn(`Finish ${curAct?.name ?? "activity"}`, "Done with this activity", "go", () => send([{ type: "TASK_FINISH", activityTypeId: wstate?.activityTypeId ?? null }], { tone: "go", title: `Nice one, ${first}`, text: `${curAct?.name ?? "Activity"} finished at ${at}. Start your next one.` }), true),
          fixedBtn,
          btn("Finish & start next", "Mark this done and pick the next", "go", () => { send([curTask ? { type: "TASK_FINISH", taskId: curTask.id } : { type: "TASK_FINISH", activityTypeId: wstate?.activityTypeId ?? null }], { tone: "go", title: "Finished", text: `${curLabel} finished at ${at}.` }).then((ok) => { if (ok) { setSearch(""); setScreen({ s: "tasks", mode: "start", banner: lastReceipt.current }); } }); }),
          btn("Switch", "Stop this one, start another", "", () => openStart()),
          btn("Waiting on something", "Parts, drawings, machine…", "wait", () => setScreen({ s: "codes" })),
          btn("Pause", "No reason · shows as idle", "", () => send([{ type: "TASK_PAUSE", taskId: curTask?.id ?? null }], { tone: "stop", title: "Paused", text: `${curTask?.code ?? curAct?.name ?? "Work"} paused at ${at}. You're now not on anything.` })),
          ...brk, clockOff];
      case "indirect": case "waiting":
        return [
          curTask && btn(`Back on ${curTask.code}`, curTask.name, "go", () => startTask(curTask), true),
          fixedBtn,
          btn("Start work", "Any job or activity", "go", () => openStart(), !curTask && !fixedBtn),
          btn(`Stop ${curCode?.name.toLowerCase() ?? "this"}`, "You'll show as not on a job", "", () => send([{ type: "CODE_END" }], { tone: "stop", title: "Stopped", text: `Ended at ${at}.` })),
          ...brk, clockOff];
      case "break_paid": case "break_unpaid":
        return [btn(`Back from ${st === "break_paid" ? "smoko" : "lunch"}`, `${fm(inState)} so far`, "go", () => send([{ type: "BREAK_END" }], { tone: "go", title: "Welcome back", text: `Break ended ${at}. Pick up your job.` }), true), clockOff];
      case "loading": return [<p key="l" className="k-sub">Checking your status…</p>];
      default:
        // Offline and we don't know their state: offer everything; the server checks each tap when it syncs.
        return [
          <p key="o" className="k-sub" style={{ gridColumn: "1 / -1" }}>Offline: pick what you&apos;re doing. Your tap is saved and checked when the connection is back.</p>,
          btn("Clock on & start work", "", "go", () => openStart(true)),
          btn("Clock on only", "", "", () => send([{ type: "CLOCK_IN" }], { tone: "go", title: `G'day ${first}`, text: `Clocked on at ${at}.` })),
          btn("Start work", "", "go", () => openStart()),
          btn("Other work", "", "ind", () => setScreen({ s: "codes" })),
          ...brk,
          btn("Back from break", "", "", () => send([{ type: "BREAK_END" }], { tone: "go", title: "Welcome back", text: `Break ended ${at}.` })),
          btn("Clock off", "", "stop", () => send([{ type: "CLOCK_OUT" }], { tone: "stop", title: `See you, ${first}`, text: `Clocked off at ${at}.` })),
        ];
    }
  };

  const body = (() => {
    switch (screen.s) {
      case "attract":
        return (
          <div className="k-attract">
            <div className="k-clock">{at}</div>
            <div className="k-date">{df.format(new Date(appNow))}</div>
            <div className="k-tap">Tap your fob</div>
            <div className="k-sub">{roster?.device.name ?? "Loading…"}{fixed ? ` · ${fixed.code} ${fixed.name}` : ""}</div>
            {err && <div className="k-msg">{err}</div>}
            {roster?.device.pinFallback && <button className="k-ghost" onClick={() => { setPin({ code: "", pin: "", field: "code" }); setScreen({ s: "pin" }); resetIdle(30_000); }}>Forgot your fob? Use your PIN</button>}
          </div>
        );
      case "pin":
        return <PinPad pin={pin} setPin={setPin} err={err} onCancel={() => setScreen({ s: "attract" })} onSubmit={async () => {
          try {
            const r = await fetch("/api/v1/device/pin", { method: "POST", headers, body: JSON.stringify({ code: pin.code, pin: pin.pin }) });
            const j = await r.json();
            if (!r.ok) { setErr(j.error); return; }
            const e = roster?.employees.find((x) => x.id === j.employeeId);
            if (e) identify(e, null, "pin");
          } catch { setErr("No connection. PIN sign-in needs the network; use your fob."); }
        }} />;
      case "confirm":
        return (
          <div className={`k-confirm ${screen.tone}`} role="status">
            <h2>{screen.title}</h2>
            {screen.receipt && screen.receipt.length > 0 ? <Receipt lines={screen.receipt} /> : <p>{screen.text}</p>}
            {err && <div className="k-msg">{err}</div>}
            {screen.undo && now < screen.undo.until && (
              <button className="k-ghost" onClick={() => send([{ type: "VOID", supersedesEventId: screen.undo!.evId }], { tone: "brk", title: "Undone", text: "That tap has been cancelled." })}>
                Wrong button? Undo ({Math.ceil((screen.undo.until - now) / 1000)}s)
              </button>
            )}
            <button className="k-ghost" onClick={() => { setScreen({ s: "attract" }); setEmp(null); }}>Done</button>
          </div>
        );
      case "finishOff":
        return (
          <div className="stack">
            <h2 className="k-name">Did you finish {curLabel}?</h2>
            <div className="k-grid">
              <button className="k-btn go big" onClick={() => send([curTask ? { type: "TASK_FINISH", taskId: curTask.id } : { type: "TASK_FINISH", activityTypeId: wstate?.activityTypeId ?? null }, { type: "CLOCK_OUT" }], { tone: "stop", title: `See you, ${first}`, text: `${curTask?.code ?? curAct?.name ?? "Job"} finished. Clocked off at ${at}.` })}>Yes, finished · clock off<small>{curTask?.name ?? curAct?.name}</small></button>
              <button className="k-btn" onClick={() => send([{ type: "CLOCK_OUT" }], { tone: "stop", title: `See you, ${first}`, text: `Clocked off at ${at}. ${curTask?.code ?? curAct?.name ?? "The job"} stays open for tomorrow.` })}>Not yet · clock off<small>It stays open</small></button>
              <button className="k-btn" onClick={() => setScreen({ s: "menu" })}>Go back</button>
            </div>
          </div>
        );
      case "codes": {
        const list = (roster?.codes ?? []).filter((c) => c.category !== "break");
        const pickCode = (c: Code) => {
          resetIdle();
          const taskForCode = st === "direct" ? curTask : (st === "waiting" || st === "indirect") ? curTask : null;
          if (c.requiresTask && !taskForCode) { setSearch(""); setScreen({ s: "tasks", mode: "wait", codeId: c.id }); return; }
          const type = st === "direct" && c.category === "waiting" ? "TASK_PAUSE" : "CODE_START";
          send([{ type, timeCodeId: c.id, taskId: c.requiresTask || c.category === "waiting" ? taskForCode?.id ?? null : null }],
            { tone: c.category === "waiting" ? "wait" : "ind", title: c.name, text: `Started ${at}${taskForCode && (c.requiresTask || c.category === "waiting") ? ` · on ${taskForCode.code}` : ""}. Tap your fob when it's done.` });
        };
        return (
          <div className="stack">
            <div className="k-sec">Waiting</div>
            <div className="k-grid">{list.filter((c) => c.category === "waiting").map((c) => <button key={c.id} className="k-btn wait" onClick={() => pickCode(c)}>{c.name}<small>{c.requiresTask ? "Linked to a job" : ""}</small></button>)}</div>
            <div className="k-sec">Other work</div>
            <div className="k-grid">{list.filter((c) => c.category !== "waiting").map((c) => <button key={c.id} className="k-btn ind" onClick={() => pickCode(c)}>{c.name}<small>{c.isPaid ? "" : "Unpaid"}{c.requiresTask ? "Linked to a job" : ""}</small></button>)}</div>
            <div className="k-row"><button className="k-ghost" onClick={() => setScreen({ s: "menu" })}>Back</button></div>
          </div>
        );
      }
      case "tasks": {
        // Finished jobs stay in the roster while crew-mates are still clocked onto them; don't offer them to start.
        const all = (roster?.tasks ?? []).filter((t) => t.status !== "done");
        const mine = all.filter((t) => emp?.assigned.includes(t.id));
        const q = search.trim().toLowerCase();
        const match = (t: Task) => !q || `${t.code} ${t.name} ${t.projectCode} ${t.projectName}`.toLowerCase().includes(q);
        const suits = all.filter((t) => !mine.includes(t) && t.activityCode && emp?.skills.includes(t.activityCode) && match(t));
        const rest = all.filter((t) => !mine.includes(t) && !suits.includes(t) && match(t));
        const choose = (t: Task) => {
          resetIdle();
          if (screen.mode === "wait") {
            const c = codeById(screen.codeId);
            send([{ type: "CODE_START", timeCodeId: screen.codeId, taskId: t.id }], { tone: "wait", title: c?.name ?? "Waiting", text: `On ${t.code} from ${at}. Tap your fob when it's sorted.` });
          } else startTask(t, screen.clockOn);
        };
        const acts = [...(roster?.activities ?? [])].sort((x, y) => Number(!emp?.skills.includes(x.code)) - Number(!emp?.skills.includes(y.code)) || x.name.localeCompare(y.name));
        const tile = (t: Task) => (
          <button key={t.id} className="k-task" onClick={() => choose(t)} disabled={busy || (t.id === curTask?.id && st === "direct")}>
            <b>{t.code}{t.priority === 1 ? " · URGENT" : ""}</b>
            <span>{t.name}</span>
            <small>{t.projectName} · {fm(t.std)} standard{t.bay ? ` · ${t.bay}` : ""}{t.onIt ? ` · ${t.onIt} on it` : ""}</small>
          </button>
        );
        return (
          <div className="stack">
            {screen.mode === "wait" && <div className="k-sec">Which job are you waiting on?</div>}
            {screen.banner && screen.banner.length > 0 && <Receipt lines={screen.banner} compact />}
            {screen.mode === "start" && <h2 className="k-name">{screen.clockOn ? `G'day ${first}. What are you starting?` : "What are you starting?"}</h2>}
            {mine.length > 0 && (<><div className="k-sec">Assigned to you</div><div className="k-grid">{mine.map(tile)}</div></>)}
            {screen.mode === "start" && acts.length > 0 && (<>
              <div className="k-sec">General activity · no job needed</div>
              <div className="k-grid">{acts.map((a) => (
                <button key={a.id} className="k-task k-act" style={{ borderLeftColor: a.colour }} disabled={busy || (curAct?.id === a.id && st === "direct")}
                  onClick={() => { resetIdle(); startActivity(a, screen.clockOn); }}>
                  <b>{a.code}</b><span>{a.name}</span><small>Track time without picking a job</small>
                </button>))}
              </div>
            </>)}
            <div className="k-row"><input className="k-search" placeholder="Search job number or task" value={search} onChange={(e) => { setSearch(e.target.value); resetIdle(); }} aria-label="Search jobs" /></div>
            {suits.length > 0 && (<><div className="k-sec">Suits your trade</div><div className="k-grid">{suits.map(tile)}</div></>)}
            <div className="k-sec">{suits.length ? "Other open jobs" : "All open jobs"}</div>
            <div className="k-grid">{rest.slice(0, 40).map(tile)}</div>
            <div className="k-row">
              {screen.mode === "start" && <button className="k-ghost" onClick={() => setScreen({ s: "codes" })}>Other work (clean-up, toolbox, waiting…)</button>}
              <button className="k-ghost" onClick={() => setScreen({ s: "menu" })}>Back</button>
            </div>
          </div>
        );
      }
      case "day":
        return (
          <div className="stack">
            <h2 className="k-name">{first}&apos;s day</h2>
            <DayPanel today={today} timeline={timeline} now={appNow} full />
            <div className="k-row"><button className="k-ghost" onClick={() => setScreen({ s: "menu" })}>Back</button></div>
          </div>
        );
      case "menu":
      default:
        return (
          <div className="stack">
            <div className="k-who">
              <span className="k-ava" style={{ background: emp?.colour }}>{emp?.first[0]}{emp?.last[0]}</span>
              <div>
                <div className="k-name">{emp?.first} {emp?.last}</div>
                <div className="k-state"><i className="dot" style={{ background: STATE_TXT[st]?.[1] ?? "#6f7a8c" }} />{curAct && st === "direct" ? "On an activity" : STATE_TXT[st]?.[0] ?? "…"}
                  {curTask ? <> · <b>{curTask.code}</b> {curTask.name}</> : curCode ? <> · {curCode.name}</> : curAct ? <> · <b>{curAct.name}</b> (no job)</> : null}
                  {wstate?.since ? <span className="k-meta"> · {fm(inState)}</span> : null}</div>
              
              </div>
              {camOk && <span className="k-meta" style={{ marginLeft: "auto" }}>Photo taken with each tap</span>}
            </div>
            {err && <div className="k-msg">{err}</div>}
            {emp && emp.assigned.length > 0 && st !== "direct" && (
              <div className="k-sub">Your next job: <b>{taskById(emp.assigned.find((id) => taskById(id)))?.code}</b> {taskById(emp.assigned.find((id) => taskById(id)))?.name}</div>
            )}
            <div className="k-grid">{menu()}</div>
            {today && <DayPanel today={today} timeline={timeline} now={appNow} onMore={() => { resetIdle(30_000); setScreen({ s: "day" }); }} />}
            <div className="k-row"><button className="k-ghost" onClick={() => { setScreen({ s: "attract" }); setEmp(null); }}>Not you? Cancel</button></div>
          </div>
        );
    }
  })();

  return (
    <div className="kiosk">
      <header className="k-bar">
        <b><i>AK</i>{roster?.org.name ?? "Akaal Management"}</b>
        <div className="k-row">
          <video ref={videoRef} className="k-cam" muted playsInline hidden={!camOk} aria-label="Camera preview" />
          {outbox.length > 0 && <span className="k-net off">{outbox.length} tap{outbox.length > 1 ? "s" : ""} waiting to send</span>}
          <span className={`k-net${online ? "" : " off"}`}>{online ? "Online" : "Offline · taps are saved"}</span>
        </div>
      </header>
      <section className="k-body">{body}</section>
      <footer className="k-foot">
        <span>{roster?.device.name} · {roster?.device.kind === "station" ? "Station terminal" : "Kiosk"}</span>
        <button className="k-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setShowDemo(!showDemo)}>{showDemo ? "Hide" : "Show"} demo fobs</button>
      </footer>
      {showDemo && screen.s === "attract" && roster && (
        <div className="k-body" style={{ paddingTop: 0 }}>
          <div className="k-demo">
            <span className="k-sec">Demo only · simulates tapping a fob on the reader</span>
            <div className="k-fobs">
              {roster.employees.map((e) => e.tags[0] && (
                <button key={e.id} className="k-fob" onClick={() => tap(e.tags[0].uid)}>{e.first} {e.last}<small>{e.tags[0].label} · {e.tags[0].uid}</small></button>
              ))}
            </div>
            <span className="k-sub" style={{ fontSize: 13 }}>A USB NFC reader in keyboard mode also works: it types the fob UID and Enter. PINs for the demo are 1001–1012 (staff numbers E001–E012).</span>
          </div>
        </div>
      )}
    </div>
  );
}

const R_ICON: Record<RLine["kind"], [string, string]> = {
  in: ["▶", "#2e9e5e"], start: ["▶", "#2e9e5e"], end: ["■", "#d4af37"], out: ["■", "#d54141"], break: ["☕", "#9aa0ad"],
};
/** The tap receipt: what ended (from → to, how long) and what started (at what time). */
function Receipt({ lines, compact = false }: { lines: RLine[]; compact?: boolean }) {
  return (
    <ul className={`k-receipt${compact ? " compact" : ""}`}>
      {lines.map((l, i) => (
        <li key={i}>
          <span className="ic" style={{ color: R_ICON[l.kind][1] }} aria-hidden="true">{R_ICON[l.kind][0]}</span>
          <span className="tx"><b>{l.title}</b><small>{l.detail}</small></span>
          {l.dur && <span className="du">{l.dur}</span>}
        </li>
      ))}
    </ul>
  );
}

const KIND_TXT: Record<string, [string, string]> = {
  direct: ["", "#2e9e5e"], indirect: ["", "#3f78cc"], waiting: ["Waiting", "#d08e1c"], break_paid: ["Smoko", "#6c6f7c"], break_unpaid: ["Lunch", "#6c6f7c"],
  unallocated: ["Not on anything", "#d54141"], pre_shift: ["Before shift", "#4a4a52"], post_shift: ["After shift", "#4a4a52"],
};

/** "My day": totals, counts and the running sequence of what the worker has done today. */
function DayPanel({ today, timeline, now, full = false, onMore }: { today: Today | null; timeline: TLItem[]; now: number; full?: boolean; onMore?: () => void }) {
  if (!today) return <p className="k-sub">Nothing recorded yet today.</p>;
  const m = (s: number) => fm(Math.round(s / 60));
  const items = [...timeline].reverse();
  const shown = full ? items : items.slice(0, 6);
  const first = timeline[0]?.start ?? 0;
  const last = timeline.length ? (timeline[timeline.length - 1].end ?? now) : 0;
  const span = Math.max(1, last - first);
  return (
    <div className="k-day">
      <div className="k-sec">My day {today.firstIn ? `· on since ${tf.format(new Date(today.firstIn))}` : ""}</div>
      <div className="k-stats">
        <div><b>{m(today.directS)}</b><span>On jobs &amp; activities</span></div>
        <div><b>{today.finishedCount}</b><span>Finished</span></div>
        <div><b>{today.startCount}</b><span>Started</span></div>
        <div><b>{today.breakCount}</b><span>Breaks · {m(today.breakS)}</span></div>
        <div><b>{m(today.unallocatedS)}</b><span>Not on anything</span></div>
        <div><b>{m(today.paidS)}</b><span>Paid so far</span></div>
      </div>
      <div className="k-bar-day" aria-hidden="true">
        {timeline.map((t, i) => <i key={i} style={{ width: `${(((t.end ?? now) - t.start) / span) * 100}%`, background: KIND_TXT[t.kind]?.[1] ?? "#4a4a52" }} />)}
      </div>
      <ol className="k-seq">
        {shown.map((t, i) => (
          <li key={i}>
            <span className="k-meta">{tf.format(new Date(t.start))}–{t.end ? tf.format(new Date(t.end)) : "now"}</span>
            <i className="dot" style={{ background: KIND_TXT[t.kind]?.[1] ?? "#4a4a52" }} />
            <span>{t.label ?? KIND_TXT[t.kind]?.[0] ?? t.kind}{t.kind === "waiting" && t.label ? "" : ""}{t.finished ? " ✓" : ""}{t.end === null ? " · now" : ""}</span>
            <span className="k-meta">{fm(Math.round(((t.end ?? now) - t.start) / 60000))}</span>
          </li>
        ))}
      </ol>
      {!full && items.length > 6 && onMore && <button className="k-ghost" onClick={onMore}>Show my whole day ({items.length} entries)</button>}
    </div>
  );
}

function PinPad({ pin, setPin, err, onCancel, onSubmit }: {
  pin: { code: string; pin: string; field: "code" | "pin" }; setPin: (p: { code: string; pin: string; field: "code" | "pin" }) => void;
  err: string | null; onCancel: () => void; onSubmit: () => void;
}) {
  const press = (k: string) => {
    const f = pin.field;
    const v = k === "⌫" ? pin[f].slice(0, -1) : (pin[f] + k).slice(0, f === "pin" ? 6 : 6);
    setPin({ ...pin, [f]: v });
  };
  return (
    <div className="k-pin">
      <h2 className="k-name">Sign in with your PIN</h2>
      <label className="k-sub">Staff number<input value={pin.code} onFocus={() => setPin({ ...pin, field: "code" })} onChange={(e) => setPin({ ...pin, code: e.target.value.toUpperCase() })} placeholder="E001" /></label>
      <label className="k-sub">PIN<input type="password" inputMode="numeric" value={pin.pin} onFocus={() => setPin({ ...pin, field: "pin" })} onChange={(e) => setPin({ ...pin, pin: e.target.value.replace(/\D/g, "") })} /></label>
      <div className="k-keys">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "E", "0", "⌫"].map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}</div>
      {err && <div className="k-msg">{err}</div>}
      <div className="k-row"><button className="k-btn go" onClick={onSubmit}>Sign in</button><button className="k-ghost" onClick={onCancel}>Cancel</button></div>
      <p className="k-sub" style={{ fontSize: 14 }}>Using a PIN is flagged on your timesheet. Get a replacement fob from the office.</p>
    </div>
  );
}

function Pair({ onPair }: { onPair: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="kiosk"><header className="k-bar"><b><i>AK</i>Pair this tablet</b></header>
      <section className="k-body">
        <div className="k-pin">
          <p className="k-sub">Enter the device code shown in Setup → Devices.</p>
          <input value={v} onChange={(e) => setV(e.target.value.trim())} aria-label="Device code" />
          <button className="k-btn go" onClick={() => v && onPair(v)}>Pair</button>
          <p className="k-sub" style={{ fontSize: 14 }}>Demo codes: kiosk-front-gate-demo, station-bay3-demo, station-paint-booth-demo</p>
        </div>
      </section>
    </div>
  );
}
