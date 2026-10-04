import { and, eq, isNull } from "drizzle-orm";
import { db, t } from "@/db";
import { appNow } from "@/lib/time";

/** Devices authenticate with a revocable token sent in the x-device-token header. */
export async function deviceFromRequest(req: Request) {
  const token = req.headers.get("x-device-token") ?? new URL(req.url).searchParams.get("device");
  if (!token) return null;
  const [d] = await db.select().from(t.devices).where(and(eq(t.devices.token, token), isNull(t.devices.revokedAt)));
  if (!d) return null;
  await db.update(t.devices).set({ lastSeenAt: new Date(appNow()), appVersion: req.headers.get("x-app-version") ?? d.appVersion }).where(eq(t.devices.id, d.id));
  return d;
}

export const deviceError = () => Response.json({ error: "This device isn't paired or has been revoked. Ask an admin to pair it again." }, { status: 401 });
