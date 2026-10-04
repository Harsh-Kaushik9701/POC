import { and, desc, eq, isNull, lte, gte, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { appNow, localDate } from "@/lib/time";
import { uuidv7 } from "@/lib/uuid";
import type { EventType } from "@/lib/engine";
import { recomputeDay } from "./recompute";
import { autoClockOffStale } from "./sweep";

export interface PunchInput {
  id?: string;
  employeeId: string;
  type: EventType;
  at?: number; // UTC ms; defaults to now
  deviceTime?: number;
  taskId?: string | null;
  timeCodeId?: string | null;
  deviceId?: string | null;
  credentialId?: string | null;
  method: "nfc" | "qr" | "pin" | "manager" | "system";
  source: "kiosk" | "station" | "supervisor" | "web" | "system";
  actorUserId?: string | null;
  note?: string | null;
  wasOffline?: boolean;
  photoKey?: string | null;
  supersedesEventId?: string | null;
  flags?: string[];
  /** Skip recompute (bulk seeding). */
  deferRecompute?: boolean;
  /** Manager corrections back-date events onto a given day; state checks don't apply. */
  correction?: { workDate: string };
}

export class PunchError extends Error {}

/** Which work date an event belongs to: the date of the clock-on it follows. */
async function workDateFor(employeeId: string, type: EventType, at: number): Promise<string> {
  if (type === "CLOCK_IN") return localDate(at);
  const [last] = await db.select({ workDate: t.punchEvents.workDate }).from(t.punchEvents)
    .where(and(
      eq(t.punchEvents.employeeId, employeeId), eq(t.punchEvents.type, "CLOCK_IN"),
      lte(t.punchEvents.occurredAt, new Date(at)), gte(t.punchEvents.occurredAt, new Date(at - 20 * 3600_000)),
    ))
    .orderBy(desc(t.punchEvents.occurredAt)).limit(1);
  return last?.workDate ?? localDate(at);
}

export interface WorkerState {
  kind: "off" | "pre_shift" | "post_shift" | "unallocated" | "direct" | "indirect" | "waiting" | "break_paid" | "break_unpaid";
  since: number | null;
  taskId: string | null;
  timeCodeId: string | null;
  workDate: string | null;
}

export async function getWorkerState(employeeId: string): Promise<WorkerState> {
  const [seg] = await db.select().from(t.timeSegments)
    .where(and(eq(t.timeSegments.employeeId, employeeId), isNull(t.timeSegments.endAt))).limit(1);
  if (!seg) return { kind: "off", since: null, taskId: null, timeCodeId: null, workDate: null };
  return { kind: seg.kind as WorkerState["kind"], since: seg.startAt.getTime(), taskId: seg.taskId, timeCodeId: seg.timeCodeId, workDate: seg.workDate };
}

/**
 * Record one punch. Idempotent on `id` (offline kiosks retry with the same id).
 * Validates against the worker's current state, writes the append-only event,
 * applies task status side-effects and rebuilds the day.
 */
export async function recordPunch(p: PunchInput) {
  const id = p.id ?? uuidv7();
  const dup = await db.select({ id: t.punchEvents.id }).from(t.punchEvents).where(eq(t.punchEvents.id, id)).limit(1);
  if (dup.length) return { id, duplicate: true, state: await getWorkerState(p.employeeId) };

  const at = p.at ?? appNow();
  if (p.type === "CLOCK_IN" && !p.correction) await autoClockOffStale(p.employeeId, at);

  const state = p.correction ? { kind: "direct" as const, since: null, taskId: p.taskId ?? null, timeCodeId: null, workDate: p.correction.workDate } : await getWorkerState(p.employeeId);
  const on = p.correction ? p.type !== "CLOCK_IN" : state.kind !== "off";
  if (p.type === "CLOCK_IN" && on) throw new PunchError("Already clocked on");
  if (p.type !== "CLOCK_IN" && p.type !== "VOID" && !on) throw new PunchError("Not clocked on yet. Clock on first.");
  if ((p.type === "TASK_START") && !p.taskId) throw new PunchError("Choose a job task");
  if (p.type === "TASK_START" && p.taskId) {
    const [task] = await db.select().from(t.tasks).where(eq(t.tasks.id, p.taskId));
    if (!task) throw new PunchError("Unknown task");
    if (task.status === "done") throw new PunchError(`${task.code} is already finished`);
    const [proj] = await db.select().from(t.projects).where(eq(t.projects.id, task.projectId));
    if (proj?.status === "closed") throw new PunchError(`Job ${proj.code} is closed`);
  }
  if (p.type === "TASK_FINISH" || p.type === "TASK_PAUSE") {
    if (state.kind !== "direct" && !(p.type === "TASK_FINISH" && p.taskId)) throw new PunchError("Not on a task");
  }
  if ((p.type === "CODE_START" || p.type === "BREAK_START" || (p.type === "TASK_PAUSE" && p.timeCodeId)) && p.timeCodeId) {
    const [code] = await db.select().from(t.timeCodes).where(eq(t.timeCodes.id, p.timeCodeId));
    if (!code) throw new PunchError("Unknown code");
    if (code.requiresTask && !(p.taskId ?? state.taskId)) throw new PunchError(`${code.name} must be linked to a job`);
  }

  let voided: typeof t.punchEvents.$inferSelect | undefined;
  if (p.type === "VOID") {
    if (!p.supersedesEventId) throw new PunchError("Nothing to undo");
    [voided] = await db.select().from(t.punchEvents).where(eq(t.punchEvents.id, p.supersedesEventId));
    if (!voided || voided.employeeId !== p.employeeId) throw new PunchError("Nothing to undo");
    const policy = (await db.select().from(t.policies).limit(1))[0];
    if (p.method !== "manager" && at - voided.receivedAt.getTime() > (policy.undoSeconds + 30) * 1000) throw new PunchError("Too late to undo. Ask your leading hand to fix it.");
  }

  const workDate = p.correction ? p.correction.workDate : p.type === "VOID" && p.supersedesEventId
    ? (await db.select({ w: t.punchEvents.workDate }).from(t.punchEvents).where(eq(t.punchEvents.id, p.supersedesEventId)))[0]?.w ?? localDate(at)
    : on && state.workDate ? state.workDate : await workDateFor(p.employeeId, p.type, at);
  const taskId = p.type === "TASK_FINISH" || p.type === "TASK_PAUSE" ? (p.taskId ?? state.taskId) : p.taskId ?? null;

  await db.insert(t.punchEvents).values({
    id, employeeId: p.employeeId, type: p.type, occurredAt: new Date(at), receivedAt: new Date(appNow()), deviceTime: p.deviceTime ? new Date(p.deviceTime) : null,
    workDate, taskId, timeCodeId: p.timeCodeId ?? null, deviceId: p.deviceId ?? null, credentialId: p.credentialId ?? null,
    method: p.method, source: p.source, actorUserId: p.actorUserId ?? null, supersedesEventId: p.supersedesEventId ?? null,
    wasOffline: p.wasOffline ?? false, photoKey: p.photoKey ?? null, note: p.note ?? null, flags: p.flags ?? [],
  }).onConflictDoNothing();

  // Task status side-effects
  if (p.type === "TASK_START" && taskId && !p.correction) {
    await db.update(t.tasks).set({ status: "in_progress" }).where(and(eq(t.tasks.id, taskId), sql`${t.tasks.status} <> 'done'`));
    await db.update(t.taskAssignments).set({ status: "accepted" })
      .where(and(eq(t.taskAssignments.taskId, taskId), eq(t.taskAssignments.employeeId, p.employeeId), eq(t.taskAssignments.status, "assigned")));
    const exists = await db.select({ id: t.taskAssignments.id }).from(t.taskAssignments)
      .where(and(eq(t.taskAssignments.taskId, taskId), eq(t.taskAssignments.employeeId, p.employeeId))).limit(1);
    if (!exists.length) await db.insert(t.taskAssignments).values({ taskId, employeeId: p.employeeId, status: "accepted", note: "Self-selected at kiosk" });
  }
  if (p.type === "TASK_FINISH" && taskId) {
    await db.update(t.tasks).set({ status: "done", completedAt: new Date(at), completedBy: p.employeeId }).where(eq(t.tasks.id, taskId));
  }
  if (p.type === "TASK_PAUSE" && taskId) {
    await db.update(t.tasks).set({ status: p.timeCodeId ? "blocked" : "paused" }).where(and(eq(t.tasks.id, taskId), sql`${t.tasks.status} <> 'done'`));
  }
  if (p.type === "CODE_END" && state.kind === "waiting" && state.taskId) {
    await db.update(t.tasks).set({ status: "paused" }).where(and(eq(t.tasks.id, state.taskId), eq(t.tasks.status, "blocked")));
  }

  if (voided?.type === "TASK_FINISH" && voided.taskId) {
    await db.update(t.tasks).set({ status: "in_progress", completedAt: null, completedBy: null }).where(eq(t.tasks.id, voided.taskId));
  }

  // Exceptions worth a look
  const [emp] = await db.select().from(t.employees).where(eq(t.employees.id, p.employeeId));
  const name = `${emp.firstName} ${emp.lastName}`;
  if (p.method === "pin") {
    await db.insert(t.alerts).values({ type: "pin_used", severity: "info", employeeId: p.employeeId, deviceId: p.deviceId ?? null, workDate,
      dedupeKey: `pin:${id}`, openedAt: new Date(at), message: `${name} used a PIN instead of a tag` }).onConflictDoNothing();
  }
  if (p.wasOffline) {
    await db.insert(t.alerts).values({ type: "offline_punch", severity: "info", employeeId: p.employeeId, deviceId: p.deviceId ?? null, workDate,
      dedupeKey: `offline:${id}`, openedAt: new Date(at), message: `${name}'s tap was recorded while the device was offline` }).onConflictDoNothing();
  }

  if (!p.deferRecompute) await recomputeDay(p.employeeId, workDate);
  return { id, duplicate: false, workDate, state: await getWorkerState(p.employeeId) };
}
