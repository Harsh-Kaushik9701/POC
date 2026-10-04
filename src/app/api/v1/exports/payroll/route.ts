import { and, between, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { apiUser } from "@/lib/session";
import { toCsv, csvResponse } from "@/lib/csv";
import { audit } from "@/server/audit";
import { payrollLines } from "@/server/payroll";

/**
 * Payroll export (CSV). Layout follows the common import shape used by Xero Payroll AU and
 * Employment Hero (KeyPay): one row per employee per day per pay item. Rounding is applied here only.
 * ?lock=1 also locks the exported days so they can't change after payroll runs.
 */
export async function GET(req: Request) {
  const u = await apiUser("payroll.export");
  if (u instanceof Response) return u;
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "", to = sp.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return Response.json({ error: "from and to dates are required" }, { status: 400 });
  const { lines, roundingMin } = await payrollLines(from, to, sp.get("approvedOnly") !== "0");
  const rows: (string | number)[][] = [["Employee ID", "First name", "Surname", "Date", "Pay item", "Units (hours)", "Actual hours", "Rate (AUD)", "Award", "Notes"]];
  for (const l of lines) rows.push([l.code, l.first, l.last, l.date, l.item, l.hours.toFixed(2), l.actual.toFixed(2), l.rate.toFixed(2), l.award, l.note]);
  if (sp.get("lock") === "1") {
    await db.update(t.attendanceDays).set({ status: "locked" }).where(and(between(t.attendanceDays.workDate, from, to), eq(t.attendanceDays.status, "approved")));
  }
  await audit(u.id, "export.payroll", "payroll", null, { from, to, lines: lines.length, roundingMin, locked: sp.get("lock") === "1" });
  return csvResponse(`payroll-${from}-to-${to}.csv`, toCsv(rows));
}
