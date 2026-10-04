"use server";
import { and, between, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, appNow, localToUtc } from "@/lib/time";
import { recordPunch, PunchError } from "@/server/punch";
import { recomputeDay } from "@/server/recompute";
import { audit } from "@/server/audit";

export async function approveWeek(formData: FormData) {
  const u = await requireUser("timesheets.approve");
  const monday = String(formData.get("monday"));
  const ids = formData.getAll("employeeId").map(String);
  const where = and(
    between(t.attendanceDays.workDate, monday, addDays(monday, 6)),
    eq(t.attendanceDays.isOpen, false), ne(t.attendanceDays.status, "locked"),
    ids.length ? inArray(t.attendanceDays.employeeId, ids) : undefined,
  );
  const rows = await db.update(t.attendanceDays).set({ status: "approved", approvedBy: u.id, approvedAt: new Date(appNow()) }).where(where).returning({ id: t.attendanceDays.id });
  await audit(u.id, "timesheet.approve_week", "attendance_days", null, { monday, employees: ids.length || "all", days: rows.length });
  revalidatePath("/timesheets");
}

export async function setDayStatus(formData: FormData) {
  const status = String(formData.get("status"));
  const u = await requireUser(status === "approved" ? "timesheets.approve" : "timesheets.correct");
  const employeeId = String(formData.get("employeeId")), date = String(formData.get("date"));
  await db.update(t.attendanceDays).set({ status, approvedBy: status === "approved" ? u.id : null, approvedAt: status === "approved" ? new Date(appNow()) : null })
    .where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.workDate, date), ne(t.attendanceDays.status, "locked")));
  await audit(u.id, `timesheet.${status}`, "attendance_day", `${employeeId}:${date}`);
  revalidatePath(`/timesheets/${employeeId}/${date}`);
}

/** Add a missed punch. Writes a new event (never edits old ones) and a correction record. */
export async function addPunch(formData: FormData) {
  const u = await requireUser("timesheets.correct");
  const employeeId = String(formData.get("employeeId")), date = String(formData.get("date"));
  const type = String(formData.get("type")) as Parameters<typeof recordPunch>[0]["type"];
  const time = String(formData.get("time"));
  const reason = String(formData.get("reason") ?? "").trim();
  const taskId = String(formData.get("taskId") || "") || null;
  const timeCodeId = String(formData.get("timeCodeId") || "") || null;
  const back = `/timesheets/${employeeId}/${date}`;
  if (!reason) redirect(`${back}?err=${encodeURIComponent("Add a reason for the change")}`);
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) redirect(`${back}?err=${encodeURIComponent("Time must look like 15:30")}`);
  let mins = +m![1] * 60 + +m![2];
  if (mins < 4 * 60 && (type === "CLOCK_OUT" || type === "TASK_FINISH")) mins += 24 * 60; // after midnight
  const at = localToUtc(date, mins);
  if (at > appNow()) redirect(`${back}?err=${encodeURIComponent("That time is in the future")}`);
  if ((type === "TASK_START" || type === "TASK_FINISH") && !taskId) redirect(`${back}?err=${encodeURIComponent("Pick the task")}`);
  if ((type === "CODE_START" || type === "BREAK_START") && !timeCodeId) redirect(`${back}?err=${encodeURIComponent("Pick the code")}`);
  try {
    const r = await recordPunch({ employeeId, type, at, taskId, timeCodeId, method: "manager", source: "web", actorUserId: u.id, note: reason, correction: { workDate: date } });
    await db.insert(t.corrections).values({ employeeId, workDate: date, action: "add_event", eventId: r.id, reason, requestedBy: u.id, approvedBy: u.id });
    await reopenIfApproved(employeeId, date);
    await audit(u.id, "timesheet.add_punch", "punch_event", r.id, { type, time, reason });
  } catch (e) {
    if (e instanceof PunchError) redirect(`${back}?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Punch added and the day recalculated")}`);
}

export async function voidEvent(formData: FormData) {
  const u = await requireUser("timesheets.correct");
  const employeeId = String(formData.get("employeeId")), date = String(formData.get("date")), eventId = String(formData.get("eventId"));
  const reason = String(formData.get("reason") ?? "").trim() || "Removed by manager";
  const back = `/timesheets/${employeeId}/${date}`;
  try {
    const r = await recordPunch({ employeeId, type: "VOID", supersedesEventId: eventId, method: "manager", source: "web", actorUserId: u.id, note: reason, correction: { workDate: date } });
    await db.insert(t.corrections).values({ employeeId, workDate: date, action: "void_event", eventId: r.id, reason, requestedBy: u.id, approvedBy: u.id });
    await reopenIfApproved(employeeId, date);
    await audit(u.id, "timesheet.void_punch", "punch_event", eventId, { reason });
  } catch (e) {
    if (e instanceof PunchError) redirect(`${back}?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Punch removed and the day recalculated")}`);
}

async function reopenIfApproved(employeeId: string, date: string) {
  await db.update(t.attendanceDays).set({ status: "open", approvedBy: null, approvedAt: null })
    .where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.workDate, date), eq(t.attendanceDays.status, "approved")));
  await recomputeDay(employeeId, date);
}
