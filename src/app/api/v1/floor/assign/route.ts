import { z } from "zod";
import { db, t } from "@/db";
import { apiUser } from "@/lib/session";
import { recordPunch, PunchError } from "@/server/punch";
import { audit } from "@/server/audit";

const Body = z.object({ taskId: z.string().uuid(), employeeId: z.string().uuid(), startNow: z.boolean().optional(), reason: z.string().max(300).optional() });

/** Assign a task to a worker. With startNow, also start it on their behalf (recorded as a manager punch). */
export async function POST(req: Request) {
  const u = await apiUser("floor.assign");
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { taskId, employeeId, startNow, reason } = parsed.data;
  await db.insert(t.taskAssignments).values({ taskId, employeeId, assignedByUserId: u.id, status: startNow ? "accepted" : "assigned", note: reason ?? null });
  await audit(u.id, startNow ? "task.start_on_behalf" : "task.assign", "task", taskId, { employeeId, reason });
  if (startNow) {
    try {
      await recordPunch({ employeeId, type: "TASK_START", taskId, method: "manager", source: "web", actorUserId: u.id, note: reason || `Started by ${u.name}` });
    } catch (e) {
      if (e instanceof PunchError) return Response.json({ error: e.message }, { status: 409 });
      throw e;
    }
  }
  return Response.json({ ok: true });
}
