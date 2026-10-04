import { and, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { deviceFromRequest, deviceError } from "@/server/device";
import { getWorkerState } from "@/server/punch";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/** The worker's current state and today's hours, shown after a tag tap. */
export async function GET(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return deviceError();
  const employeeId = new URL(req.url).searchParams.get("employeeId");
  if (!employeeId) return Response.json({ error: "employeeId required" }, { status: 400 });
  const state = await getWorkerState(employeeId);
  const [day] = await db.select().from(t.attendanceDays).where(and(eq(t.attendanceDays.employeeId, employeeId), eq(t.attendanceDays.workDate, state.workDate ?? todayLocal())));
  return Response.json({ state, today: day ? { paidS: day.paidS, directS: day.directS, firstIn: day.firstIn?.getTime() ?? null } : null });
}
