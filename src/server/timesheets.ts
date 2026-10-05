import { and, asc, between, eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";
import { addDays } from "@/lib/time";

export async function weekGrid(monday: string, departmentId?: string | null) {
  const sunday = addDays(monday, 6);
  const emps = await db.select({ e: t.employees, d: t.departments }).from(t.employees)
    .leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId))
    .where(departmentId ? and(eq(t.employees.active, true), eq(t.employees.departmentId, departmentId)) : eq(t.employees.active, true))
    .orderBy(t.departments.name, t.employees.firstName);
  const days = await db.select().from(t.attendanceDays).where(between(t.attendanceDays.workDate, monday, sunday));
  return { emps, days };
}

export async function segmentsFor(employeeId: string, from: string, to: string) {
  return db.select({ s: t.timeSegments, tk: t.tasks, p: t.projects, c: t.timeCodes, a: t.activityTypes })
    .from(t.timeSegments)
    .leftJoin(t.activityTypes, eq(t.activityTypes.id, t.timeSegments.activityTypeId))
    .leftJoin(t.tasks, eq(t.tasks.id, t.timeSegments.taskId))
    .leftJoin(t.projects, eq(t.projects.id, t.timeSegments.projectId))
    .leftJoin(t.timeCodes, eq(t.timeCodes.id, t.timeSegments.timeCodeId))
    .where(and(eq(t.timeSegments.employeeId, employeeId), between(t.timeSegments.workDate, from, to)))
    .orderBy(asc(t.timeSegments.startAt));
}

export async function workerDay(employeeId: string, date: string) {
  const [emp] = await db.select({ e: t.employees, w: t.workPatterns, d: t.departments }).from(t.employees)
    .innerJoin(t.workPatterns, eq(t.workPatterns.id, t.employees.workPatternId))
    .leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId))
    .where(eq(t.employees.id, employeeId));
  if (!emp) return null;
  const [day] = await db.select().from(t.attendanceDays).where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.workDate, date)));
  const segs = await segmentsFor(employeeId, date, date);
  const events = await db.select({ ev: t.punchEvents, tk: t.tasks, c: t.timeCodes, dv: t.devices, u: t.users, a: t.activityTypes })
    .from(t.punchEvents)
    .leftJoin(t.activityTypes, eq(t.activityTypes.id, t.punchEvents.activityTypeId))
    .leftJoin(t.tasks, eq(t.tasks.id, t.punchEvents.taskId))
    .leftJoin(t.timeCodes, eq(t.timeCodes.id, t.punchEvents.timeCodeId))
    .leftJoin(t.devices, eq(t.devices.id, t.punchEvents.deviceId))
    .leftJoin(t.users, eq(t.users.id, t.punchEvents.actorUserId))
    .where(and(eq(t.punchEvents.employeeId, employeeId), eq(t.punchEvents.workDate, date)))
    .orderBy(asc(t.punchEvents.occurredAt), asc(t.punchEvents.receivedAt));
  const alerts = await db.select().from(t.alerts).where(and(eq(t.alerts.employeeId, employeeId), eq(t.alerts.workDate, date))).orderBy(asc(t.alerts.openedAt));
  const corrections = await db.select({ c: t.corrections, u: t.users }).from(t.corrections)
    .leftJoin(t.users, eq(t.users.id, t.corrections.requestedBy))
    .where(and(eq(t.corrections.employeeId, employeeId), eq(t.corrections.workDate, date))).orderBy(asc(t.corrections.createdAt));
  const approver = day?.approvedBy ? (await db.select().from(t.users).where(eq(t.users.id, day.approvedBy)))[0] : null;
  return { emp, day, segs, events, alerts, corrections, approver };
}

/** Tasks and codes a manager can pick when adding a missed punch. */
export async function pickLists() {
  const tasks = await db.select({ id: t.tasks.id, code: t.tasks.code, name: t.tasks.name }).from(t.tasks).orderBy(t.tasks.code);
  const codes = await db.select().from(t.timeCodes).where(eq(t.timeCodes.active, true)).orderBy(t.timeCodes.sort);
  const activities = await db.select().from(t.activityTypes).orderBy(t.activityTypes.name);
  return { tasks, codes, activities };
}

export async function employeesById(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(t.employees).where(inArray(t.employees.id, ids));
}
