import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { apiUser } from "@/lib/session";
import { appNow } from "@/lib/time";

export async function POST(req: Request) {
  const u = await apiUser("exceptions.view");
  if (u instanceof Response) return u;
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  await db.update(t.alerts).set({ ackBy: u.id, ackAt: new Date(appNow()) }).where(inArray(t.alerts.id, parsed.data.ids));
  return Response.json({ ok: true });
}
