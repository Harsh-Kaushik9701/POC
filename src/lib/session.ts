import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { can, type Action } from "./permissions";

/**
 * Demo login: a signed cookie holding the user id. Swap for Better Auth (email/phone OTP) in production.
 */
const COOKIE = "sf_session";
const secret = () => process.env.SESSION_SECRET || "dev-secret";
const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

export async function setSession(userId: string) {
  (await cookies()).set(COOKIE, `${userId}.${sign(userId)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getUser() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  const good = sign(id);
  if (!sig || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const [u] = await db.select().from(t.users).where(eq(t.users.id, id));
  return u ?? null;
}
export type SessionUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;

/** For pages: redirect to login, or show "no access". */
export async function requireUser(action?: Action) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (action && !can(u.role, action)) redirect("/no-access");
  return u;
}

/** For API routes: returns a user or a Response to send back. */
export async function apiUser(action?: Action): Promise<SessionUser | Response> {
  const u = await getUser();
  if (!u) return Response.json({ error: "Please log in" }, { status: 401 });
  if (action && !can(u.role, action)) return Response.json({ error: "You don't have access to do that" }, { status: 403 });
  return u;
}
