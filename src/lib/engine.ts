/**
 * The time engine: turns one worker's punch events for one work date into
 * non-overlapping time segments and the day's totals.
 *
 * Pure function, no database access, so it runs the same on the server and (later) on an offline device.
 * Golden tests: src/lib/engine.test.ts.
 *
 * States (exactly one at any instant while clocked on):
 *   unallocated (idle) | direct (on a task) | indirect | waiting | break
 * Rules:
 *   - Starting anything ends the current state (one tap to switch jobs).
 *   - Finishing or pausing a task without a reason, ending a code, or ending a break -> unallocated.
 *     Time is NEVER carried forward to the last job (the TimeDock behaviour we are replacing).
 *   - Unallocated time before shift start / after shift end is pre_shift / post_shift, not idle.
 *   - Break time beyond the code's allowance (e.g. smoko > 10 min) becomes unallocated, flagged.
 */

export type EventType =
  | "CLOCK_IN" | "CLOCK_OUT" | "AUTO_CLOCK_OUT"
  | "TASK_START" | "TASK_PAUSE" | "TASK_FINISH"
  | "CODE_START" | "CODE_END"
  | "BREAK_START" | "BREAK_END"
  | "VOID";

export interface EngineEvent {
  id: string;
  type: EventType;
  at: number; // UTC ms
  taskId?: string | null;
  /** General activity (e.g. Welding) started without a specific job task. */
  activityTypeId?: string | null;
  timeCodeId?: string | null;
  supersedesEventId?: string | null;
}

export interface CodeInfo {
  category: string; // indirect | waiting | rework | training | travel | personal | break
  isPaid: boolean;
  countsAsIdle: boolean;
  reducesAvailability: boolean;
  maxMinutes?: number | null;
}

export type SegmentKind =
  | "pre_shift" | "post_shift" | "unallocated" | "direct" | "indirect" | "waiting" | "break_paid" | "break_unpaid";

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number | null; // null = running now
  taskId: string | null;
  activityTypeId?: string | null;
  timeCodeId: string | null;
  startEventId: string | null;
  endEventId: string | null;
  flags: string[];
}

export interface EngineInput {
  events: EngineEvent[];
  codes: Record<string, CodeInfo>;
  /** Scheduled shift for this work date (UTC ms), or null on a rostered day off. */
  shiftStart: number | null;
  shiftEnd: number | null;
  ordinaryMin: number;
  graceMin: number;
  /** Standard minutes per task, for efficiency. */
  taskStdMin: Record<string, number>;
  now: number;
  lunchAutoDeductMin?: number | null;
  /** When true, ending a break puts the worker back on the job they were on before it. */
  resumeAfterBreak?: boolean;
}

export interface DayTotals {
  firstIn: number | null;
  lastOut: number | null;
  isOpen: boolean;
  attendanceS: number;
  prePostS: number;
  breakPaidS: number;
  breakUnpaidS: number;
  reducedS: number;
  paidS: number;
  availableS: number;
  directS: number;
  indirectS: number;
  waitingS: number;
  unallocatedS: number;
  overtimeS: number;
  stdEarnedS: number;
  directDoneS: number;
  lateMin: number;
  finishedTaskIds: string[];
  flags: string[];
  /** Breaks started, things finished (tasks or general activities), and jobs/activities started. */
  breakCount: number;
  finishedCount: number;
  startCount: number;
}

export interface EngineResult {
  segments: Segment[];
  totals: DayTotals;
  /** The worker's state right now if the day is still open. */
  current: Segment | null;
  ignoredEventIds: string[];
}

type State = { kind: SegmentKind; taskId: string | null; activityTypeId?: string | null; timeCodeId: string | null; eventId: string };

const secs = (ms: number) => Math.round(ms / 1000);

export function runEngine(input: EngineInput): EngineResult {
  const { codes } = input;
  const voided = new Set(input.events.filter((e) => e.type === "VOID" && e.supersedesEventId).map((e) => e.supersedesEventId!));
  const events = input.events
    .filter((e) => e.type !== "VOID" && !voided.has(e.id))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    .map((x) => x.e);

  const raw: Segment[] = [];
  const ignored: string[] = [];
  const finished: string[] = [];
  let st: State | null = null;
  let cursor = 0;
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  let beforeBreak: { taskId: string | null; activityTypeId: string | null } | null = null;
  let breakCount = 0, finishedCount = 0, starts = 0;
  const flags = new Set<string>();

  const close = (at: number, endEventId: string | null) => {
    if (st && at > cursor) {
      raw.push({ kind: st.kind, start: cursor, end: at, taskId: st.taskId, activityTypeId: st.activityTypeId ?? null, timeCodeId: st.timeCodeId, startEventId: st.eventId, endEventId, flags: [] });
    }
  };

  for (const e of events) {
    const clockedOn = st !== null;
    if (!clockedOn && e.type !== "CLOCK_IN") { ignored.push(e.id); continue; }
    if (clockedOn && e.type === "CLOCK_IN") { ignored.push(e.id); continue; } // double tap

    // An end event that doesn't match the current state (e.g. "end code" while on lunch) changes nothing.
    if (e.type === "CODE_END" && st && st.kind !== "indirect" && st.kind !== "waiting") { ignored.push(e.id); continue; }
    if (e.type === "BREAK_END" && st && st.kind !== "break_paid" && st.kind !== "break_unpaid") { ignored.push(e.id); continue; }

    close(e.at, e.id);
    const idle = (): State => ({ kind: "unallocated", taskId: null, timeCodeId: null, eventId: e.id });

    switch (e.type) {
      case "CLOCK_IN":
        if (firstIn === null) firstIn = e.at;
        st = idle();
        break;
      case "CLOCK_OUT":
      case "AUTO_CLOCK_OUT":
        lastOut = e.at;
        if (e.type === "AUTO_CLOCK_OUT") flags.add("auto_clock_off");
        st = null;
        break;
      case "TASK_START":
        starts++;
        st = { kind: "direct", taskId: e.taskId ?? null, activityTypeId: e.activityTypeId ?? null, timeCodeId: null, eventId: e.id };
        break;
      case "TASK_FINISH":
        if (e.taskId) finished.push(e.taskId);
        finishedCount++;
        st = idle();
        break;
      case "TASK_PAUSE": {
        const c = e.timeCodeId ? codes[e.timeCodeId] : undefined;
        st = c
          ? { kind: kindForCode(c), taskId: e.taskId ?? (st as State | null)?.taskId ?? null, timeCodeId: e.timeCodeId!, eventId: e.id }
          : idle();
        break;
      }
      case "CODE_START": {
        const c = e.timeCodeId ? codes[e.timeCodeId] : undefined;
        st = c ? { kind: kindForCode(c), taskId: e.taskId ?? null, timeCodeId: e.timeCodeId!, eventId: e.id } : idle();
        break;
      }
      case "BREAK_START": {
        const c = e.timeCodeId ? codes[e.timeCodeId] : undefined;
        { const prev = st as State | null; beforeBreak = prev?.kind === "direct" ? { taskId: prev.taskId, activityTypeId: prev.activityTypeId ?? null } : null; }
        breakCount++;
        st = { kind: c && !c.isPaid ? "break_unpaid" : "break_paid", taskId: null, timeCodeId: e.timeCodeId ?? null, eventId: e.id };
        break;
      }
      case "BREAK_END":
        st = input.resumeAfterBreak && beforeBreak
          ? { kind: "direct", taskId: beforeBreak.taskId, activityTypeId: beforeBreak.activityTypeId, timeCodeId: null, eventId: e.id }
          : idle();
        beforeBreak = null;
        break;
      case "CODE_END":
        st = idle();
        break;
    }
    cursor = e.at;
  }

  const isOpen = st !== null;
  if (st && input.now > cursor) {
    raw.push({ kind: st.kind, start: cursor, end: null, taskId: st.taskId, activityTypeId: st.activityTypeId ?? null, timeCodeId: st.timeCodeId, startEventId: st.eventId, endEventId: null, flags: ["running"] });
  }

  // Break overrun -> the excess becomes idle.
  const afterBreaks: Segment[] = [];
  for (const g of raw) {
    const c = g.timeCodeId ? codes[g.timeCodeId] : undefined;
    const end = g.end ?? input.now;
    if ((g.kind === "break_paid" || g.kind === "break_unpaid") && c?.maxMinutes && end - g.start > c.maxMinutes * 60_000 + 60_000) {
      const cut = g.start + c.maxMinutes * 60_000;
      afterBreaks.push({ ...g, end: cut, endEventId: null, flags: [...g.flags.filter((f) => f !== "running")] });
      afterBreaks.push({ ...g, kind: "unallocated", start: cut, timeCodeId: null, taskId: null, flags: [...g.flags, "break_overrun"] });
      flags.add("break_overrun");
    } else afterBreaks.push(g);
  }

  // Idle time outside the scheduled shift is pre/post shift, not idle.
  const segments: Segment[] = [];
  for (const g of afterBreaks) {
    if (g.kind !== "unallocated" || input.shiftStart === null || input.shiftEnd === null) {
      if (g.kind === "unallocated" && input.shiftStart === null) segments.push({ ...g, kind: "post_shift" });
      else segments.push(g);
      continue;
    }
    const end = g.end ?? input.now;
    const cuts = [g.start, ...[input.shiftStart, input.shiftEnd].filter((c) => c > g.start && c < end), end];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const kind: SegmentKind = b <= input.shiftStart ? "pre_shift" : a >= input.shiftEnd ? "post_shift" : "unallocated";
      const isLast = i === cuts.length - 2;
      segments.push({
        ...g, kind, start: a, end: isLast ? g.end : b,
        startEventId: i === 0 ? g.startEventId : null,
        endEventId: isLast ? g.endEventId : null,
        flags: isLast ? g.flags : g.flags.filter((f) => f !== "running"),
      });
    }
  }

  // Totals
  const dur = (g: Segment) => secs((g.end ?? input.now) - g.start);
  let prePost = 0, bp = 0, bu = 0, reduced = 0, direct = 0, indirect = 0, waiting = 0, unalloc = 0;
  for (const g of segments) {
    const d = dur(g);
    const c = g.timeCodeId ? codes[g.timeCodeId] : undefined;
    switch (g.kind) {
      case "pre_shift": case "post_shift": prePost += d; break;
      case "break_paid": bp += d; break;
      case "break_unpaid": bu += d; break;
      case "direct": direct += d; break;
      case "waiting": waiting += d; break;
      case "unallocated": unalloc += d; break;
      case "indirect":
        if (c?.reducesAvailability) reduced += d;
        else if (c?.countsAsIdle) unalloc += d;
        else indirect += d;
        break;
    }
  }
  const lastEnd = isOpen ? input.now : lastOut;
  const attendance = firstIn !== null && lastEnd !== null ? secs(lastEnd - firstIn) - gapsBetweenWindows(events) : 0;

  // Lunch auto-deduct: closed day over 5 h with no unpaid break punched.
  if (!isOpen && firstIn !== null && input.lunchAutoDeductMin && bu === 0 && attendance > 5 * 3600) {
    const take = Math.min(input.lunchAutoDeductMin * 60, unalloc);
    unalloc -= take;
    bu += take;
    if (take > 0) flags.add("lunch_auto_deducted");
  }

  const paid = attendance - bu - prePost;
  const available = attendance - prePost - bp - bu - reduced;
  const stdEarned = finished.reduce((a, t) => a + (input.taskStdMin[t] ?? 0) * 60, 0);
  const directDone = segments.filter((g) => g.kind === "direct" && g.taskId && finished.includes(g.taskId)).reduce((a, g) => a + dur(g), 0);
  const late = firstIn !== null && input.shiftStart !== null ? Math.max(0, Math.floor((firstIn - input.shiftStart) / 60_000) - input.graceMin) : 0;
  if (late > 0) flags.add("late");

  const current = isOpen ? segments[segments.length - 1] ?? null : null;

  return {
    segments,
    current,
    ignoredEventIds: ignored,
    totals: {
      firstIn, lastOut, isOpen,
      attendanceS: attendance, prePostS: prePost, breakPaidS: bp, breakUnpaidS: bu, reducedS: reduced,
      paidS: paid, availableS: available,
      directS: direct, indirectS: indirect, waitingS: waiting, unallocatedS: unalloc,
      overtimeS: Math.max(0, paid - input.ordinaryMin * 60),
      stdEarnedS: stdEarned, directDoneS: directDone, lateMin: late,
      finishedTaskIds: finished, flags: [...flags],
      breakCount, finishedCount, startCount: starts,
    },
  };
}

function kindForCode(c: CodeInfo): SegmentKind {
  if (c.category === "break") return c.isPaid ? "break_paid" : "break_unpaid";
  if (c.category === "waiting") return "waiting";
  return "indirect";
}

/** Time between a clock-off and a later clock-on on the same day is not attendance. */
function gapsBetweenWindows(events: EngineEvent[]): number {
  let gap = 0, out: number | null = null, on = false;
  for (const e of events) {
    if (e.type === "CLOCK_IN" && !on) { if (out !== null) gap += secs(e.at - out); on = true; out = null; }
    else if ((e.type === "CLOCK_OUT" || e.type === "AUTO_CLOCK_OUT") && on) { out = e.at; on = false; }
  }
  return gap;
}

/* ---------------- KPI helpers (shared by every screen) ---------------- */

export interface Kpis { utilisation: number | null; idlePct: number | null; accounted: number | null; efficiency: number | null; productivity: number | null }

export function kpis(t: { availableS: number; directS: number; indirectS: number; waitingS: number; unallocatedS: number; stdEarnedS: number; directDoneS: number }): Kpis {
  const av = t.availableS;
  const r = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    utilisation: r(t.directS, av),
    idlePct: r(t.unallocatedS, av),
    accounted: r(t.directS + t.indirectS + t.waitingS, av),
    efficiency: r(t.stdEarnedS, t.directDoneS),
    productivity: r(t.stdEarnedS, av),
  };
}

export const KPI_FORMULAS: Record<string, string> = {
  attendance: "Clock-off − clock-on",
  paid: "Attendance − unpaid breaks − time outside shift",
  available: "Attendance − time outside shift − all breaks − training",
  direct: "Sum of time on job tasks",
  indirect: "Sum of indirect codes (clean-up, maintenance, toolbox talks)",
  waiting: "Sum of waiting codes (parts, drawings, machine down)",
  idle: "Available − on task − indirect − waiting",
  utilisation: "On task ÷ available",
  idlePct: "Idle ÷ available",
  accounted: "(On task + indirect + waiting) ÷ available",
  efficiency: "Standard time of finished tasks ÷ time spent on them",
  productivity: "Standard time earned ÷ available",
  overtime: "Paid − ordinary hours",
};
