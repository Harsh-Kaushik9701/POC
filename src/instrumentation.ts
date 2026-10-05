/**
 * Runs once when each server instance starts.
 * Anchors the demo clock to when the demo data was loaded so all instances (and restarts) share one "now".
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DEMO_NOW) return;
  try {
    const { sqlClient } = await import("./db");
    const { setDemoAnchor } = await import("./lib/time");
    const rows = await sqlClient<{ real_start: string | null }[]>`
      select detail->>'realStart' as real_start from audit_log where action = 'seed' order by at desc limit 1`;
    const real = Number(rows[0]?.real_start);
    if (real) setDemoAnchor(real);
  } catch {
    // Database not ready yet: the clock falls back to "DEMO_NOW at server start". /status explains what's missing.
  }
}
