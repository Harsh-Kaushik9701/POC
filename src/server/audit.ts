import { db, t } from "@/db";

export async function audit(actorUserId: string | null, action: string, entity: string, entityId: string | null, detail?: unknown) {
  await db.insert(t.auditLog).values({ actorUserId, action, entity, entityId, detail: (detail ?? null) as never });
}
