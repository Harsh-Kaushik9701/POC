import { describe, it, expect } from "vitest";
import { runEngine, kpis, type EngineEvent, type CodeInfo } from "./engine";

// Times are minutes after midnight on a fixed UTC day for readability.
const D = Date.UTC(2026, 9, 6); // the date itself doesn't matter to the engine
const at = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return D + (h * 60 + m) * 60_000; };
let n = 0;
const ev = (time: string, type: EngineEvent["type"], extra: Partial<EngineEvent> = {}): EngineEvent => ({ id: `e${++n}`, type, at: at(time), ...extra });

const codes: Record<string, CodeInfo> = {
  SMOKO: { category: "break", isPaid: true, countsAsIdle: false, reducesAvailability: false, maxMinutes: 10 },
  LUNCH: { category: "break", isPaid: false, countsAsIdle: false, reducesAvailability: false, maxMinutes: 30 },
  CLEAN: { category: "indirect", isPaid: true, countsAsIdle: false, reducesAvailability: false },
  WAIT_PARTS: { category: "waiting", isPaid: true, countsAsIdle: false, reducesAvailability: false },
  TRAIN: { category: "training", isPaid: true, countsAsIdle: false, reducesAvailability: true },
  PERSONAL: { category: "personal", isPaid: false, countsAsIdle: true, reducesAvailability: false },
};
const base = {
  codes, shiftStart: at("07:00"), shiftEnd: at("15:30"), ordinaryMin: 480, graceMin: 5,
  taskStdMin: { "J-101": 180, "J-102": 120 }, now: at("23:00"),
};
const min = (s: number) => s / 60;

describe("golden day: Jack Thompson, boilermaker", () => {
  // The worked example from the requirements report, on a 07:00–15:30 shift.
  const events = [
    ev("06:52", "CLOCK_IN"),
    ev("07:05", "TASK_START", { taskId: "J-101" }),
    ev("09:00", "BREAK_START", { timeCodeId: "SMOKO" }),
    ev("09:10", "BREAK_END"),
    ev("09:25", "TASK_START", { taskId: "J-101" }),
    ev("10:40", "TASK_FINISH", { taskId: "J-101" }),
    ev("11:00", "BREAK_START", { timeCodeId: "LUNCH" }),
    ev("11:30", "BREAK_END"),
    ev("11:40", "CODE_START", { timeCodeId: "WAIT_PARTS", taskId: "J-102" }),
    ev("12:10", "TASK_START", { taskId: "J-102" }),
    ev("14:20", "TASK_FINISH", { taskId: "J-102" }),
    ev("14:20", "CODE_START", { timeCodeId: "CLEAN" }),
    ev("14:50", "CODE_END"),
    ev("15:38", "CLOCK_OUT"),
  ];
  const r = runEngine({ ...base, events });
  const t = r.totals;

  it("produces the report's totals", () => {
    expect(min(t.attendanceS)).toBe(526);
    expect(min(t.prePostS)).toBe(16);
    expect(min(t.breakPaidS)).toBe(10);
    expect(min(t.breakUnpaidS)).toBe(30);
    expect(min(t.paidS)).toBe(480);
    expect(min(t.availableS)).toBe(470);
    expect(min(t.directS)).toBe(320);
    expect(min(t.indirectS)).toBe(30);
    expect(min(t.waitingS)).toBe(30);
    expect(min(t.unallocatedS)).toBe(90);
    expect(min(t.overtimeS)).toBe(0);
  });

  it("balances: on task + indirect + waiting + idle = available", () => {
    expect(t.directS + t.indirectS + t.waitingS + t.unallocatedS).toBe(t.availableS);
  });

  it("computes KPIs", () => {
    const k = kpis(t);
    expect(k.utilisation!.toFixed(3)).toBe("0.681");
    expect(k.idlePct!.toFixed(3)).toBe("0.191");
    expect(k.efficiency!.toFixed(3)).toBe("0.938");
  });

  it("never lets segments overlap and covers the whole attendance", () => {
    const segs = r.segments;
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end!);
    const covered = segs.reduce((a, g) => a + (g.end! - g.start), 0) / 60_000;
    expect(covered).toBe(526);
  });

  it("splits idle at shift boundaries", () => {
    expect(r.segments[0].kind).toBe("pre_shift");
    expect(r.segments.at(-1)!.kind).toBe("post_shift");
  });
});

describe("rules", () => {
  it("switching tasks needs one tap and ends the previous task", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { taskId: "J-101" }),
      ev("08:00", "TASK_START", { taskId: "J-102" }), ev("09:00", "CLOCK_OUT"),
    ] });
    expect(r.segments.map((s) => [s.kind, s.taskId])).toEqual([["direct", "J-101"], ["direct", "J-102"]]);
    expect(min(r.totals.unallocatedS)).toBe(0);
  });

  it("does not carry idle time forward to the last job", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { taskId: "J-101" }),
      ev("08:00", "TASK_FINISH", { taskId: "J-101" }), ev("08:20", "TASK_START", { taskId: "J-102" }), ev("09:00", "CLOCK_OUT"),
    ] });
    expect(min(r.totals.unallocatedS)).toBe(20);
    expect(min(r.totals.directS)).toBe(100);
  });

  it("ignores a double clock-on and events before clocking on", () => {
    const r = runEngine({ ...base, events: [
      ev("06:50", "TASK_START", { taskId: "J-101" }),
      ev("07:00", "CLOCK_IN"), ev("07:01", "CLOCK_IN"), ev("08:00", "CLOCK_OUT"),
    ] });
    expect(r.ignoredEventIds.length).toBe(2);
    expect(min(r.totals.attendanceS)).toBe(60);
  });

  it("removes voided events", () => {
    const wrong = ev("07:30", "TASK_START", { taskId: "J-102" });
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { taskId: "J-101" }), wrong,
      ev("07:31", "VOID", { supersedesEventId: wrong.id }), ev("08:00", "CLOCK_OUT"),
    ] });
    expect(r.segments.map((s) => s.taskId)).toEqual(["J-101"]);
  });

  it("turns smoko overrun into idle time", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("09:00", "BREAK_START", { timeCodeId: "SMOKO" }), ev("09:25", "BREAK_END"), ev("09:30", "CLOCK_OUT"),
    ] });
    expect(min(r.totals.breakPaidS)).toBe(10);
    expect(r.totals.flags).toContain("break_overrun");
    expect(min(r.totals.unallocatedS)).toBe(120 + 15 + 5); // 07:00–09:00 idle + 15 min overrun + 09:25–09:30
  });

  it("keeps the day open while clocked on and runs to now", () => {
    const r = runEngine({ ...base, now: at("10:00"), events: [ev("07:00", "CLOCK_IN"), ev("09:00", "TASK_START", { taskId: "J-101" })] });
    expect(r.totals.isOpen).toBe(true);
    expect(r.current?.kind).toBe("direct");
    expect(r.current?.end).toBeNull();
    expect(min(r.totals.directS)).toBe(60);
    expect(min(r.totals.unallocatedS)).toBe(120);
  });

  it("an open idle segment mid-shift stays idle (not split into the future)", () => {
    const r = runEngine({ ...base, now: at("10:00"), events: [ev("07:00", "CLOCK_IN")] });
    expect(r.segments.map((s) => s.kind)).toEqual(["unallocated"]);
  });

  it("auto-deducts lunch when none was punched", () => {
    const r = runEngine({ ...base, lunchAutoDeductMin: 30, events: [ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { taskId: "J-101" }), ev("12:00", "TASK_FINISH", { taskId: "J-101" }), ev("15:30", "CLOCK_OUT")] });
    expect(min(r.totals.breakUnpaidS)).toBe(30);
    expect(r.totals.flags).toContain("lunch_auto_deducted");
    expect(min(r.totals.paidS)).toBe(480);
  });

  it("training reduces available time; personal time counts as idle", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("07:00", "CODE_START", { timeCodeId: "TRAIN" }), ev("08:00", "CODE_START", { timeCodeId: "PERSONAL" }), ev("08:30", "CLOCK_OUT"),
    ] });
    expect(min(r.totals.availableS)).toBe(30);
    expect(min(r.totals.unallocatedS)).toBe(30);
    expect(r.totals.indirectS).toBe(0);
  });

  it("pausing a task for parts is waiting time linked to that task", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { taskId: "J-101" }), ev("08:00", "TASK_PAUSE", { taskId: "J-101", timeCodeId: "WAIT_PARTS" }), ev("08:40", "CLOCK_OUT"),
    ] });
    const w = r.segments.find((s) => s.kind === "waiting")!;
    expect(w.taskId).toBe("J-101");
    expect(min(r.totals.waitingS)).toBe(40);
  });

  it("does not count the gap between two clock-on windows", () => {
    const r = runEngine({ ...base, events: [ev("07:00", "CLOCK_IN"), ev("09:00", "CLOCK_OUT"), ev("10:00", "CLOCK_IN"), ev("12:00", "CLOCK_OUT")] });
    expect(min(r.totals.attendanceS)).toBe(240);
  });

  it("records late arrival beyond the grace period", () => {
    const r = runEngine({ ...base, events: [ev("07:12", "CLOCK_IN"), ev("15:30", "CLOCK_OUT")] });
    expect(r.totals.lateMin).toBe(7);
  });

  it("can put the worker back on their job after a break (policy switch)", () => {
    const evs = [ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { taskId: "J-101" }), ev("09:00", "BREAK_START", { timeCodeId: "SMOKO" }), ev("09:10", "BREAK_END"), ev("10:00", "CLOCK_OUT")];
    expect(min(runEngine({ ...base, events: evs }).totals.unallocatedS)).toBe(50);
    expect(min(runEngine({ ...base, events: evs, resumeAfterBreak: true }).totals.directS)).toBe(170);
  });

  it("ignores an end event that doesn't match the current state", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("11:40", "CODE_START", { timeCodeId: "CLEAN" }), ev("12:00", "BREAK_START", { timeCodeId: "LUNCH" }),
      ev("12:00", "CODE_END"), ev("12:30", "BREAK_END"), ev("13:00", "CLOCK_OUT"),
    ] });
    expect(min(r.totals.breakUnpaidS)).toBe(30);
    expect(r.ignoredEventIds.length).toBe(1);
  });

  it("tracks a general activity with no job, and counts starts, finishes and breaks", () => {
    const r = runEngine({ ...base, events: [
      ev("07:00", "CLOCK_IN"), ev("07:00", "TASK_START", { activityTypeId: "WELDING" }),
      ev("08:00", "TASK_FINISH", { activityTypeId: "WELDING" }), ev("08:00", "TASK_START", { taskId: "J-101" }),
      ev("09:00", "BREAK_START", { timeCodeId: "SMOKO" }), ev("09:10", "BREAK_END"),
      ev("09:10", "TASK_START", { activityTypeId: "PAINT" }), ev("10:00", "BREAK_START", { timeCodeId: "SMOKO" }), ev("10:10", "BREAK_END"), ev("10:30", "CLOCK_OUT"),
    ] });
    const direct = r.segments.filter((g) => g.kind === "direct");
    expect(direct.map((g) => g.activityTypeId ?? g.taskId)).toEqual(["WELDING", "J-101", "PAINT"]);
    expect(min(r.totals.directS)).toBe(170);
    expect(r.totals.startCount).toBe(3);
    expect(r.totals.finishedCount).toBe(1);
    expect(r.totals.breakCount).toBe(2);
    expect(min(r.totals.unallocatedS)).toBe(20);
  });
});
