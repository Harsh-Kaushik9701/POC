import { and, between, eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";

export interface PayLine { employeeId: string; code: string; first: string; last: string; date: string; item: string; hours: number; actual: number; rate: number; award: string; note: string }

const round = (h: number, min: number) => (min > 0 ? Math.round((h * 60) / min) * min / 60 : h);

/**
 * Turns approved days into pay lines: ordinary hours, overtime, and flags.
 * POC rule: overtime = paid hours over ordinary hours per day, paid at "Overtime (time and a half)".
 * Real award interpretation (first 2 h at 1.5×, then 2×, weekends, apprentice rates) is a production item.
 */
export async function payrollLines(from: string, to: string, approvedOnly = true) {
  const [policy] = await db.select().from(t.policies).limit(1);
  const days = await db.select({ d: t.attendanceDays, e: t.employees }).from(t.attendanceDays)
    .innerJoin(t.employees, eq(t.employees.id, t.attendanceDays.employeeId))
    .where(and(between(t.attendanceDays.workDate, from, to), approvedOnly ? inArray(t.attendanceDays.status, ["approved", "locked"]) : undefined, eq(t.attendanceDays.isOpen, false)))
    .orderBy(t.employees.code, t.attendanceDays.workDate);
  const lines: PayLine[] = [];
  for (const { d, e } of days) {
    const paid = d.paidS / 3600, ot = d.overtimeS / 3600, ord = paid - ot;
    const base = { employeeId: e.id, code: e.code, first: e.firstName, last: e.lastName, date: d.workDate, award: e.award ?? "" };
    const note = [d.flags.includes("auto_clock_off") ? "Auto clocked off" : "", d.flags.includes("lunch_auto_deducted") ? "Lunch auto-deducted" : "", d.lateMin ? `Late ${d.lateMin} min` : ""].filter(Boolean).join("; ");
    lines.push({ ...base, item: e.employmentType === "casual" ? "Casual Ordinary Hours" : "Ordinary Hours", hours: round(ord, policy.payrollRoundingMin), actual: ord, rate: e.payRateCents / 100, note });
    if (round(ot, policy.payrollRoundingMin) > 0) lines.push({ ...base, item: "Overtime (time and a half)", hours: round(ot, policy.payrollRoundingMin), actual: ot, rate: (e.payRateCents / 100) * 1.5, note: "" });
  }
  const pending = await db.select({ d: t.attendanceDays }).from(t.attendanceDays)
    .where(and(between(t.attendanceDays.workDate, from, to), inArray(t.attendanceDays.status, ["open", "needs_review"])));
  return { lines, roundingMin: policy.payrollRoundingMin, pendingDays: pending.length };
}
