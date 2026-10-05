import { and, eq, inArray, isNull, sql, desc, gte } from "drizzle-orm";
import { db, t } from "@/db";
import { appNow, todayLocal, isoWeekday, localToUtc } from "@/lib/time";
import { sweep } from "./sweep";

export type FloorState = "unallocated" | "waiting" | "indirect" | "direct" | "break_paid" | "break_unpaid" | "pre_shift" | "post_shift" | "not_in" | "gone" | "day_off";

export interface FloorWorker {
  id: string; name: string; first: string; last: string; trade: string; colour: string; dept: string | null;
  state: FloorState; since: number | null;
  task: { id: string; code: string; name: string; projectCode: string; std: number; spentS: number } | null;
  code: { code: string; name: string } | null;
  /** General activity (no job), e.g. "Welding". */
  activity: string | null;
  today: { directS: number; availableS: number; unallocatedS: number; paidS: number } | null;
  firstIn: number | null; lastOut: number | null; late: boolean;
  next: { id: string; code: string; name: string }[];
}

export interface QueueTask {
  id: string; code: string; name: string; projectCode: string; projectName: string; std: number; spentS: number;
  priority: number; bay: string | null; activity: string | null; status: string; due: string | null; assignedTo: string[];
}

export async function getFloor() {
  await sweep();
  const now = appNow();
  const today = todayLocal();
  const emps = await db.select({ e: t.employees, p: t.workPatterns, d: t.departments })
    .from(t.employees)
    .innerJoin(t.workPatterns, eq(t.workPatterns.id, t.employees.workPatternId))
    .leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId))
    .where(eq(t.employees.active, true))
    .orderBy(t.employees.firstName);
  const days = await db.select().from(t.attendanceDays).where(eq(t.attendanceDays.workDate, today));
  const open = await db.select().from(t.timeSegments).where(isNull(t.timeSegments.endAt));
  const codes = await db.select().from(t.timeCodes);
  const acts = await db.select().from(t.activityTypes);
  const taskIds = open.map((s) => s.taskId).filter(Boolean) as string[];
  const curTasks = taskIds.length
    ? await db.select({ tk: t.tasks, p: t.projects }).from(t.tasks).innerJoin(t.projects, eq(t.projects.id, t.tasks.projectId)).where(inArray(t.tasks.id, taskIds))
    : [];
  const spent = await taskSpent(now);
  const assigned = await db.select({ a: t.taskAssignments, tk: t.tasks }).from(t.taskAssignments)
    .innerJoin(t.tasks, eq(t.tasks.id, t.taskAssignments.taskId))
    .where(and(eq(t.taskAssignments.status, "assigned"), sql`${t.tasks.status} <> 'done'`))
    .orderBy(t.taskAssignments.assignedAt);

  const workers: FloorWorker[] = emps.map(({ e, p, d }) => {
    const day = days.find((x) => x.employeeId === e.id);
    const seg = open.find((s) => s.employeeId === e.id);
    const ct = seg?.taskId ? curTasks.find((x) => x.tk.id === seg.taskId) : undefined;
    const code = seg?.timeCodeId ? codes.find((c) => c.id === seg.timeCodeId) : undefined;
    const rostered = p.days.includes(isoWeekday(today));
    let state: FloorState;
    if (seg) state = seg.kind as FloorState;
    else if (day) state = "gone";
    else state = rostered ? "not_in" : "day_off";
    const late = !day && rostered && now > localToUtc(today, p.startMin + p.graceMin);
    return {
      id: e.id, name: `${e.firstName} ${e.lastName}`, first: e.firstName, last: e.lastName, trade: e.trade, colour: e.colour, dept: d?.name ?? null,
      state, since: seg ? seg.startAt.getTime() : null,
      task: ct ? { id: ct.tk.id, code: ct.tk.code, name: ct.tk.name, projectCode: ct.p.code, std: ct.tk.standardMinutes, spentS: spent.get(ct.tk.id) ?? 0 } : null,
      code: code ? { code: code.code, name: code.name } : null,
      activity: seg && seg.kind === "direct" && !seg.taskId ? acts.find((a) => a.id === seg.activityTypeId)?.name ?? "General work" : null,
      today: day ? { directS: day.directS, availableS: day.availableS, unallocatedS: day.unallocatedS, paidS: day.paidS } : null,
      firstIn: day?.firstIn?.getTime() ?? null, lastOut: day?.lastOut?.getTime() ?? null, late,
      next: assigned.filter((x) => x.a.employeeId === e.id).map((x) => ({ id: x.tk.id, code: x.tk.code, name: x.tk.name })),
    };
  });

  // Ready work nobody is on right now
  const busy = new Set(open.filter((s) => s.kind === "direct" && s.taskId).map((s) => s.taskId!));
  const candidates = await db.select({ tk: t.tasks, p: t.projects, a: t.activityTypes }).from(t.tasks)
    .innerJoin(t.projects, eq(t.projects.id, t.tasks.projectId))
    .leftJoin(t.activityTypes, eq(t.activityTypes.id, t.tasks.activityTypeId))
    .where(and(inArray(t.tasks.status, ["ready", "paused", "in_progress"]), eq(t.projects.status, "active")))
    .orderBy(t.tasks.priority, t.projects.dueDate, t.tasks.sequence);
  const deps = await db.select({ d: t.taskDependencies, s: t.tasks.status }).from(t.taskDependencies).innerJoin(t.tasks, eq(t.tasks.id, t.taskDependencies.dependsOnTaskId));
  const queue: QueueTask[] = candidates
    .filter((c) => !busy.has(c.tk.id))
    .filter((c) => deps.filter((x) => x.d.taskId === c.tk.id).every((x) => x.s !== "ready" && x.s !== "todo"))
    .map((c) => ({
      id: c.tk.id, code: c.tk.code, name: c.tk.name, projectCode: c.p.code, projectName: c.p.name, std: c.tk.standardMinutes,
      spentS: spent.get(c.tk.id) ?? 0, priority: c.tk.priority, bay: c.tk.bay, activity: c.a?.name ?? null, status: c.tk.status,
      due: c.p.dueDate, assignedTo: assigned.filter((x) => x.a.taskId === c.tk.id).map((x) => emps.find((e) => e.e.id === x.a.employeeId)?.e.firstName ?? "?"),
    }));

  const alerts = await db.select().from(t.alerts)
    .where(and(eq(t.alerts.workDate, today), isNull(t.alerts.ackAt), sql`${t.alerts.severity} <> 'info'`))
    .orderBy(sql`${t.alerts.resolvedAt} is not null`, desc(t.alerts.openedAt)).limit(6);
  const [policy] = await db.select().from(t.policies).limit(1);
  const overDue = await db.select({ n: sql<number>`count(*)::int` }).from(t.alerts)
    .where(and(eq(t.alerts.type, "task_over_standard"), isNull(t.alerts.ackAt), gte(t.alerts.openedAt, new Date(now - 7 * 86400_000))));

  const onSite = workers.filter((w) => !["not_in", "gone", "day_off"].includes(w.state));
  const sum = (k: "directS" | "availableS" | "unallocatedS") => workers.reduce((a, w) => a + (w.today?.[k] ?? 0), 0);
  return {
    now, today, idleAlertMin: policy.idleAlertMin, workers, queue,
    alerts: alerts.map((a) => ({ id: a.id, type: a.type, message: a.message, openedAt: a.openedAt.getTime(), resolved: !!a.resolvedAt })),
    tiles: {
      onSite: onSite.length,
      expected: workers.filter((w) => w.state !== "day_off").length,
      idle: workers.filter((w) => w.state === "unallocated").length,
      idleOver: workers.filter((w) => w.state === "unallocated" && w.since && now - w.since > policy.idleAlertMin * 60_000).length,
      waiting: workers.filter((w) => w.state === "waiting").length,
      onJobs: workers.filter((w) => w.state === "direct").length,
      notIn: workers.filter((w) => w.state === "not_in").length,
      overStandard: overDue[0].n,
      queue: queue.filter((q) => q.assignedTo.length === 0).length,
      utilisation: sum("availableS") ? sum("directS") / sum("availableS") : null,
      idleS: sum("unallocatedS"),
    },
  };
}

/** Total direct time ever booked to each task (running segments up to now). */
export async function taskSpent(now = appNow()) {
  const rows = await db.execute<{ task_id: string; secs: number }>(sql`
    select task_id, sum(extract(epoch from (coalesce(end_at, ${new Date(now).toISOString()}::timestamptz) - start_at)))::int as secs
    from time_segments where kind = 'direct' and task_id is not null group by task_id`);
  return new Map(rows.map((r) => [r.task_id, Number(r.secs)]));
}
