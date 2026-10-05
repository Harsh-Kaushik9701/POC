import { and, eq, inArray, isNull, sql, ne, or } from "drizzle-orm";
import { db, t } from "@/db";
import { deviceFromRequest, deviceError } from "@/server/device";
import { appNow } from "@/lib/time";
import { refreshDemoAnchor } from "@/server/clock";

export const dynamic = "force-dynamic";

/**
 * Everything a kiosk caches so it works offline: who the workers are (tag -> name),
 * open tasks, codes and settings. Never includes pay rates or reports.
 */
export async function GET(req: Request) {
  await refreshDemoAnchor();
  const device = await deviceFromRequest(req);
  if (!device) return deviceError();
  const emps = await db.select().from(t.employees).where(and(eq(t.employees.active, true), eq(t.employees.siteId, device.siteId))).orderBy(t.employees.firstName);
  const creds = await db.select().from(t.credentials).where(isNull(t.credentials.revokedAt));
  const tasks = await db.select({ tk: t.tasks, p: t.projects, a: t.activityTypes }).from(t.tasks)
    .innerJoin(t.projects, eq(t.projects.id, t.tasks.projectId))
    .leftJoin(t.activityTypes, eq(t.activityTypes.id, t.tasks.activityTypeId))
    .where(or(
      and(inArray(t.tasks.status, ["ready", "in_progress", "paused", "blocked"]), eq(t.projects.status, "active")),
      // a task someone is still clocked onto, even if a crew-mate marked it finished
      sql`${t.tasks.id} in (select task_id from time_segments where end_at is null and task_id is not null)`,
    ))
    .orderBy(t.tasks.priority, t.projects.code, t.tasks.sequence);
  const assigns = await db.select().from(t.taskAssignments).where(ne(t.taskAssignments.status, "released"));
  const activities = await db.select().from(t.activityTypes).orderBy(t.activityTypes.name);
  const codes = await db.select().from(t.timeCodes).where(eq(t.timeCodes.active, true)).orderBy(t.timeCodes.sort);
  const [policy] = await db.select().from(t.policies).limit(1);
  const [org] = await db.select().from(t.organisation).limit(1);
  const onIt = await db.execute<{ task_id: string; names: string }>(sql`
    select s.task_id, string_agg(e.first_name, ', ') as names from time_segments s join employees e on e.id = s.employee_id
    where s.end_at is null and s.kind = 'direct' group by s.task_id`);

  return Response.json({
    serverNow: appNow(),
    org: { name: org.tradingName ?? org.name },
    device: { id: device.id, name: device.name, kind: device.kind, fixedTaskId: device.fixedTaskId, photoRequired: device.photoRequired && policy.photoRequired, pinFallback: device.pinFallback },
    undoSeconds: policy.undoSeconds,
    employees: emps.map((e) => ({
      id: e.id, code: e.code, first: e.firstName, last: e.lastName, trade: e.trade, colour: e.colour, skills: e.skills,
      tags: creds.filter((c) => c.employeeId === e.id).map((c) => ({ id: c.id, uid: c.value, label: c.label })),
      assigned: assigns.filter((a) => a.employeeId === e.id).map((a) => a.taskId),
    })),
    tasks: tasks.map(({ tk, p, a }) => ({
      id: tk.id, code: tk.code, name: tk.name, std: tk.standardMinutes, status: tk.status, priority: tk.priority, bay: tk.bay,
      activity: a?.name ?? null, activityCode: a?.code ?? null, projectCode: p.code, projectName: p.name, onIt: onIt.find((x) => x.task_id === tk.id)?.names ?? null,
    })),
    activities: activities.map((a) => ({ id: a.id, code: a.code, name: a.name, colour: a.colour })),
    codes: codes.map((c) => ({ id: c.id, code: c.code, name: c.name, category: c.category, isPaid: c.isPaid, requiresTask: c.requiresTask, maxMinutes: c.maxMinutes })),
  });
}
