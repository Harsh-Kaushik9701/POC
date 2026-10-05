import { sqlClient } from "@/db";
import { setDemoAnchor } from "@/lib/time";

/** Re-reads when the demo data was loaded, so the demo clock follows a fresh `npm run db:reset` without a restart. */
const g = globalThis as unknown as { __anchorCheckedAt?: number };

export async function refreshDemoAnchor() {
  if (!process.env.DEMO_NOW) return;
  if (g.__anchorCheckedAt && Date.now() - g.__anchorCheckedAt < 30_000) return; // at most every 30 s
  g.__anchorCheckedAt = Date.now();
  try {
    const rows = await sqlClient<{ real_start: string | null }[]>`
      select detail->>'realStart' as real_start from audit_log where action = 'seed' order by at desc limit 1`;
    const real = Number(rows[0]?.real_start);
    if (real) setDemoAnchor(real);
  } catch { /* database not ready */ }
}
