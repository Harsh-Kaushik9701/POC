import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { deviceFromRequest, deviceError } from "@/server/device";
import { getWorkerState } from "@/server/punch";
import { appNow, todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * After a fob tap: the worker's current state plus "My day" — today's totals,
 * break and completion counts, and the sequence of everything they've done.
 * Only the worker's own day is returned; no rates or costs.
 */
export async function GET(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return deviceError();
  const employeeId = new URL(req.url).searchParams.get("employeeId");
  if (!employeeId) return Response.json({ error: "employeeId required" }, { status: 400 });
  const state = await getWorkerState(employeeId);
  const workDate = state.workDate ?? todayLocal();
  const [day] = await db.select().from(t.attendanceDays).where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.workDate, workDate)));
  const segs = day ? await db.select({ s: t.timeSegments, tk: t.tasks, a: t.activityTypes, c: t.timeCodes })
    .from(t.timeSegments)
    .leftJoin(t.tasks, eq(t.tasks.id, t.timeSegments.taskId))
    .leftJoin(t.activityTypes, eq(t.activityTypes.id, t.timeSegments.activityTypeId))
    .leftJoin(t.timeCodes, eq(t.timeCodes.id, t.timeSegments.timeCodeId))
    .where(and(eq(t.timeSegments.employeeId, employeeId), eq(t.timeSegments.workDate, workDate)))
    .orderBy(asc(t.timeSegments.startAt)) : [];
  const finishes = day ? await db.select({ id: t.punchEvents.id, taskId: t.punchEvents.taskId, activityTypeId: t.punchEvents.activityTypeId })
    .from(t.punchEvents).where(and(eq(t.punchEvents.employeeId, employeeId), eq(t.punchEvents.workDate, workDate), eq(t.punchEvents.type, "TASK_FINISH"))) : [];
  const now = appNow();
  const raw = segs.map(({ s, tk, a, c }) => ({
    kind: s.kind, start: s.startAt.getTime(), end: s.endAt?.getTime() ?? null,
    label: tk ? `${tk.code} ${tk.name}` : c ? c.name : a ? a.name : null,
    finished: s.kind === "direct" && s.endEventId ? finishes.some((f) => f.id === s.endEventId) : false,
  }));
  // Merge back-to-back entries for the same thing (e.g. re-tapping the same job) so the list reads cleanly.
  const timeline: typeof raw = [];
  for (const x of raw) {
    const prev = timeline[timeline.length - 1];
    if (prev && prev.kind === x.kind && prev.label === x.label && prev.end === x.start) { prev.end = x.end; prev.finished = x.finished; }
    else timeline.push({ ...x });
  }
  return Response.json({
    state, now,
    today: day ? {
      firstIn: day.firstIn?.getTime() ?? null, paidS: day.paidS, directS: day.directS, indirectS: day.indirectS, waitingS: day.waitingS,
      unallocatedS: day.unallocatedS, breakS: day.breakPaidS + day.breakUnpaidS, breakCount: day.breakCount,
      finishedCount: day.finishedCount, startCount: day.startCount,
    } : null,
    timeline,
  });
}
