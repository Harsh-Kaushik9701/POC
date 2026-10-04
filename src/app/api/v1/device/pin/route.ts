import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { deviceFromRequest, deviceError } from "@/server/device";

/** PIN fallback when a worker forgets their fob. Flagged on the timesheet. */
export async function POST(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return deviceError();
  const parsed = z.object({ code: z.string().min(1).max(10), pin: z.string().regex(/^\d{4,6}$/) }).safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Enter your staff number and 4-digit PIN" }, { status: 400 });
  const [e] = await db.select().from(t.employees).where(eq(t.employees.code, parsed.data.code.toUpperCase()));
  const hash = createHash("sha256").update(`ironbark:${parsed.data.pin}`).digest("hex");
  if (!e || e.pinHash !== hash) return Response.json({ error: "Staff number or PIN doesn't match" }, { status: 401 });
  return Response.json({ employeeId: e.id });
}
