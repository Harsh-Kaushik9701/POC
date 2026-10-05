import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { appNow, fmtTime, localDate } from "@/lib/time";
import { uuidv7 } from "@/lib/uuid";
import { loadPolicy, recomputeDay } from "./recompute";
import { refreshDemoAnchor } from "./clock";

/**
 * Background rules. In production these run on a queue (BullMQ) every minute.
 * In this POC the floor board calls sweep() at most every 20 seconds, and /api/v1/cron/sweep runs it on demand.
 *  - auto clock-off for forgotten clock-offs
 *  - refresh open days so running totals and idle alerts stay current
 *  - task over standard time
 */
const g = globalThis as unknown as { __lastSweep?: number };

export async function sweep(force = false) {
  await refreshDemoAnchor();
  const now = appNow();
  if (!force && g.__lastSweep && now >= g.__lastSweep && now - g.__lastSweep < 20_000) return { skipped: true };
  g.__lastSweep = now;
  const policy = await loadPolicy();
  const open = await db.select().from(t.attendanceDays).where(eq(t.attendanceDays.isOpen, true));
  let autoClosed = 0;
  for (const day of open) {
    if (await maybeAutoClockOff(day, policy, now)) autoClosed++;
    else await recomputeDay(day.employeeId, day.workDate, { now });
  }
  const over = await taskOverStandard(policy.taskOverStandardPct, now);
  return { skipped: false, openDays: open.length, autoClosed, overStandard: over };
}

async function maybeAutoClockOff(
  day: typeof t.attendanceDays.$inferSelect,
  policy: NonNullable<Awaited<ReturnType<typeof loadPolicy>>>,
  now: number,
  force = false,
) {
  const firstIn = day.firstIn?.getTime();
  if (!firstIn) return false;
  const schedEnd = day.schedEnd?.getTime() ?? null;
  const limitByShift = schedEnd !== null ? schedEnd + policy.autoClockOffAfterEndMin * 60_000 : null;
  const limitByLength = firstIn + policy.maxShiftMin * 60_000;
  const deadline = Math.min(limitByShift ?? Infinity, limitByLength);
  if (!force && now < deadline) return false;

  // End the day at scheduled finish (or the max shift length) — never in the future.
  const at = Math.min(schedEnd ?? limitByLength, limitByLength, now);
  const [cur] = await db.select().from(t.timeSegments)
    .where(and(eq(t.timeSegments.employeeId, day.employeeId), isNull(t.timeSegments.endAt))).limit(1);
  const endAt = cur ? Math.max(at, cur.startAt.getTime() + 1000) : at;

  const id = uuidv7(endAt);
  await db.insert(t.punchEvents).values({
    id, employeeId: day.employeeId, type: "AUTO_CLOCK_OUT", occurredAt: new Date(endAt), workDate: day.workDate,
    method: "system", source: "system", note: "No clock-off recorded", flags: ["auto"],
  });
  await recomputeDay(day.employeeId, day.workDate, { now });
  const [emp] = await db.select().from(t.employees).where(eq(t.employees.id, day.employeeId));
  await db.insert(t.alerts).values({
    type: "auto_clock_off", severity: "critical", employeeId: day.employeeId, workDate: day.workDate,
    dedupeKey: `auto:${day.employeeId}:${day.workDate}`, openedAt: new Date(now),
    message: `${emp.firstName} ${emp.lastName} didn't clock off. Auto clocked off at ${fmtTime(endAt)}; check the timesheet.`,
  }).onConflictDoNothing();
  return true;
}

/** Called before a clock-on so yesterday's forgotten clock-off can't overlap today. */
export async function autoClockOffStale(employeeId: string, now: number) {
  const policy = await loadPolicy();
  const open = await db.select().from(t.attendanceDays)
    .where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.isOpen, true)));
  for (const day of open) {
    // A clock-on on a later day always closes the old one.
    await maybeAutoClockOff(day, policy, now, day.workDate !== localDate(now));
  }
}

async function taskOverStandard(pct: number, now: number) {
  const active = await db.select().from(t.tasks).where(inArray(t.tasks.status, ["in_progress", "paused", "blocked"]));
  if (!active.length) return 0;
  const rows = await db.execute<{ task_id: string; secs: number }>(sql`
    select task_id, sum(extract(epoch from (coalesce(end_at, ${new Date(now).toISOString()}::timestamptz) - start_at)))::int as secs
    from time_segments where kind = 'direct' and task_id in ${sql.raw(`(${active.map((x) => `'${x.id}'`).join(",")})`)}
    group by task_id`);
  let n = 0;
  for (const r of rows) {
    const task = active.find((x) => x.id === r.task_id)!;
    if (r.secs > task.standardMinutes * 60 * (pct / 100)) {
      n++;
      await db.insert(t.alerts).values({
        type: "task_over_standard", severity: "warning", taskId: task.id, dedupeKey: `over:${task.id}`, openedAt: new Date(now),
        message: `${task.code} ${task.name} is at ${Math.round(r.secs / 60)} min against ${task.standardMinutes} min standard`,
      }).onConflictDoNothing();
    }
  }
  return n;
}
