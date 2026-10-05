import { and, eq, inArray, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { runEngine, type CodeInfo, type EngineEvent, type EventType, type Segment } from "@/lib/engine";
import { appNow, isoWeekday, localToUtc, fmtTime } from "@/lib/time";
import { uuidv7 } from "@/lib/uuid";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export async function loadCodes(x: Exec = db): Promise<Record<string, CodeInfo & { code: string; name: string }>> {
  const rows = await x.select().from(t.timeCodes);
  return Object.fromEntries(rows.map((r) => [r.id, {
    code: r.code, name: r.name, category: r.category, isPaid: r.isPaid, countsAsIdle: r.countsAsIdle,
    reducesAvailability: r.reducesAvailability, maxMinutes: r.maxMinutes,
  }]));
}

export async function loadPolicy(x: Exec = db) {
  const [p] = await x.select().from(t.policies).limit(1);
  return p;
}

export function shiftFor(pattern: { startMin: number; endMin: number; days: number[] }, workDate: string) {
  if (!pattern.days.includes(isoWeekday(workDate))) return { start: null, end: null };
  return { start: localToUtc(workDate, pattern.startMin), end: localToUtc(workDate, pattern.endMin) };
}

/**
 * Rebuild one worker's segments and daily totals for one work date from the punch log.
 * Runs under a per-worker advisory lock so a kiosk and a phone can't race.
 */
export async function recomputeDay(employeeId: string, workDate: string, opts: { now?: number; tx?: Tx } = {}) {
  const now = opts.now ?? appNow();
  const work = async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employeeId}))`);
    const [emp] = await tx.select().from(t.employees).where(eq(t.employees.id, employeeId));
    if (!emp) throw new Error("Unknown employee");
    const [pattern] = await tx.select().from(t.workPatterns).where(eq(t.workPatterns.id, emp.workPatternId));
    const [existing] = await tx.select().from(t.attendanceDays)
      .where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.workDate, workDate)));
    if (existing?.status === "locked") return existing;

    const evRows = await tx.select().from(t.punchEvents)
      .where(and(eq(t.punchEvents.employeeId, employeeId), eq(t.punchEvents.workDate, workDate)))
      .orderBy(t.punchEvents.occurredAt, t.punchEvents.receivedAt);
    const codes = await loadCodes(tx);
    const policy = await loadPolicy(tx);
    const taskIds = [...new Set(evRows.map((e) => e.taskId).filter(Boolean))] as string[];
    const taskRows = taskIds.length ? await tx.select().from(t.tasks).where(inArray(t.tasks.id, taskIds)) : [];
    const projRows = taskRows.length ? await tx.select().from(t.projects).where(inArray(t.projects.id, taskRows.map((x) => x.projectId))) : [];
    const taskMap = new Map(taskRows.map((x) => [x.id, x]));
    const lunch = Object.values(codes).find((c) => c.category === "break" && !c.isPaid);

    const shift = shiftFor(pattern, workDate);
    const events: EngineEvent[] = evRows.map((e) => ({
      id: e.id, type: e.type as EventType, at: e.occurredAt.getTime(),
      taskId: e.taskId, activityTypeId: e.activityTypeId, timeCodeId: e.timeCodeId, supersedesEventId: e.supersedesEventId,
    }));
    const r = runEngine({
      events, codes, shiftStart: shift.start, shiftEnd: shift.end,
      ordinaryMin: pattern.ordinaryMin, graceMin: pattern.graceMin,
      taskStdMin: Object.fromEntries(taskRows.map((x) => [x.id, x.standardMinutes])),
      now, lunchAutoDeductMin: policy.lunchAutoDeduct ? lunch?.maxMinutes ?? 30 : null, resumeAfterBreak: policy.resumeAfterBreak,
    });

    await tx.delete(t.timeSegments).where(and(eq(t.timeSegments.employeeId, employeeId), eq(t.timeSegments.workDate, workDate)));
    if (r.segments.length) {
      await tx.insert(t.timeSegments).values(r.segments.map((g) => {
        const task = g.taskId ? taskMap.get(g.taskId) : undefined;
        return {
          id: uuidv7(g.start), employeeId, workDate, kind: g.kind,
          startAt: new Date(g.start), endAt: g.end === null ? null : new Date(g.end),
          taskId: g.taskId, projectId: task?.projectId ?? null, activityTypeId: task?.activityTypeId ?? g.activityTypeId ?? null,
          timeCodeId: g.timeCodeId, startEventId: g.startEventId, endEventId: g.endEventId,
          costRateCents: g.kind === "direct" || g.kind === "waiting" ? emp.costRateCents : null, flags: g.flags,
        };
      }));
    }

    // Alerts that come straight from the day's segments.
    const alerts = buildAlerts(employeeId, `${emp.firstName} ${emp.lastName}`, workDate, r.segments, r.totals, policy.idleAlertMin, codes, now, taskMap, new Map(projRows.map((p) => [p.id, p])));
    for (const a of alerts) {
      await tx.insert(t.alerts).values(a).onConflictDoUpdate({
        target: t.alerts.dedupeKey,
        set: { message: a.message, resolvedAt: a.resolvedAt ?? null },
      });
    }
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(t.alerts)
      .where(and(eq(t.alerts.employeeId, employeeId), eq(t.alerts.workDate, workDate), sql`${t.alerts.severity} <> 'info'`));

    const tot = r.totals;
    let status = existing?.status ?? "open";
    if (tot.flags.includes("auto_clock_off") && status === "open") status = "needs_review";
    const values = {
      employeeId, workDate,
      firstIn: tot.firstIn ? new Date(tot.firstIn) : null,
      lastOut: tot.lastOut && !tot.isOpen ? new Date(tot.lastOut) : null,
      isOpen: tot.isOpen,
      schedStart: shift.start ? new Date(shift.start) : null,
      schedEnd: shift.end ? new Date(shift.end) : null,
      attendanceS: tot.attendanceS, prePostS: tot.prePostS, breakPaidS: tot.breakPaidS, breakUnpaidS: tot.breakUnpaidS,
      reducedS: tot.reducedS, paidS: tot.paidS, availableS: tot.availableS, directS: tot.directS, indirectS: tot.indirectS,
      waitingS: tot.waitingS, unallocatedS: tot.unallocatedS, overtimeS: tot.overtimeS, stdEarnedS: tot.stdEarnedS,
      directDoneS: tot.directDoneS, lateMin: tot.lateMin, breakCount: tot.breakCount, finishedCount: tot.finishedCount, startCount: tot.startCount, exceptionCount: count, flags: tot.flags, status, updatedAt: new Date(),
    };
    if (tot.firstIn === null) {
      if (existing) await tx.delete(t.attendanceDays).where(eq(t.attendanceDays.id, existing.id));
      return null;
    }
    const [row] = await tx.insert(t.attendanceDays).values(values)
      .onConflictDoUpdate({ target: [t.attendanceDays.employeeId, t.attendanceDays.workDate], set: values })
      .returning();
    return row;
  };
  return opts.tx ? work(opts.tx) : db.transaction(work);
}

function buildAlerts(
  employeeId: string, name: string, workDate: string, segs: Segment[], tot: ReturnType<typeof runEngine>["totals"],
  idleMin: number, codes: Record<string, CodeInfo & { name: string }>, now: number,
  tasks: Map<string, { code: string; name: string }>, _projects: Map<string, unknown>,
) {
  const out: (typeof t.alerts.$inferInsert)[] = [];
  for (const g of segs) {
    const end = g.end ?? now;
    if (g.kind === "unallocated" && !g.flags.includes("break_overrun") && end - g.start > idleMin * 60_000) {
      const mins = Math.round((end - g.start) / 60_000);
      out.push({
        type: "idle_threshold", severity: "warning", employeeId, workDate,
        dedupeKey: `idle:${employeeId}:${g.start}`,
        openedAt: new Date(g.start + idleMin * 60_000),
        resolvedAt: g.end === null ? null : new Date(g.end),
        message: g.end === null
          ? `${name} has been idle since ${fmtTime(g.start)} (${mins} min)`
          : `${name} was idle ${fmtTime(g.start)}–${fmtTime(g.end)} (${mins} min)`,
      });
    }
    if (g.flags.includes("break_overrun")) {
      const c = segs.find((x) => x.end === g.start && x.timeCodeId)?.timeCodeId;
      out.push({
        type: "smoko_overrun", severity: "info", employeeId, workDate, dedupeKey: `overrun:${employeeId}:${g.start}`,
        openedAt: new Date(g.start), resolvedAt: g.end === null ? null : new Date(g.end),
        message: `${name}'s ${c ? codes[c]?.name.toLowerCase() : "break"} ran ${Math.round((end - g.start) / 60_000)} min over`,
      });
    }
  }
  if (tot.lateMin > 0 && tot.firstIn) {
    out.push({ type: "late_arrival", severity: "info", employeeId, workDate, dedupeKey: `late:${employeeId}:${workDate}`,
      openedAt: new Date(tot.firstIn), resolvedAt: new Date(tot.firstIn), message: `${name} clocked on ${tot.lateMin} min late at ${fmtTime(tot.firstIn)}` });
  }
  void tasks;
  return out;
}
