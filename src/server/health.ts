import { DATABASE_URL_SET, sqlClient } from "@/db";

export interface Health {
  ok: boolean;
  databaseUrlSet: boolean;
  databaseReachable: boolean;
  tablesReady: boolean;
  demoDataLoaded: boolean;
  problem: string | null;
  fix: string | null;
}

/** Checks the database step by step and says in plain words what to fix. Never returns secrets. */
export async function checkHealth(): Promise<Health> {
  const h: Health = { ok: false, databaseUrlSet: DATABASE_URL_SET, databaseReachable: false, tablesReady: false, demoDataLoaded: false, problem: null, fix: null };
  if (!DATABASE_URL_SET && process.env.NODE_ENV === "production") {
    h.problem = "DATABASE_URL is not set on the server.";
    h.fix = "In Vercel: Project → Settings → Environment Variables, add DATABASE_URL (your Aiven Service URI with sslmode=require) for Production, then redeploy.";
    return h;
  }
  try {
    await sqlClient`select 1`;
    h.databaseReachable = true;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    h.problem = `Can't connect to the database: ${msg.replace(/postgres(ql)?:\/\/[^\s]+/g, "[hidden]").slice(0, 160)}`;
    h.fix = /password|authentication/i.test(msg) ? "The password in DATABASE_URL is wrong. Copy the current Service URI from Aiven again."
      : /too many|remaining connection/i.test(msg) ? "The database has run out of connections. Set DB_POOL_MAX=1 in Vercel and redeploy, or upgrade the Aiven plan."
      : /ENOTFOUND|getaddrinfo|ECONNREFUSED|timeout/i.test(msg) ? "Check the host and port in DATABASE_URL, and that the Aiven service is running and allows connections from anywhere (Aiven → Overview → Allowed IP addresses: 0.0.0.0/0)."
      : "Check DATABASE_URL and that the Aiven service is running.";
    return h;
  }
  try {
    const [r] = await sqlClient<{ n: number }[]>`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('organisation','punch_events','attendance_days','users')`;
    h.tablesReady = r.n === 4;
    if (!h.tablesReady) {
      h.problem = "The database is empty: tables haven't been created.";
      h.fix = "On your computer, set DATABASE_URL in .env to the Aiven URI and run: npm run db:reset";
      return h;
    }
    const [u] = await sqlClient<{ n: number }[]>`select count(*)::int as n from users`;
    h.demoDataLoaded = u.n > 0;
    if (!h.demoDataLoaded) {
      h.problem = "Tables exist but there's no data.";
      h.fix = "On your computer, with DATABASE_URL pointing at Aiven, run: npm run db:seed";
      return h;
    }
    const [c] = await sqlClient<{ n: number }[]>`select count(*)::int as n from information_schema.columns where table_name = 'attendance_days' and column_name = 'break_count'`;
    if (c.n === 0) {
      h.problem = "The database is from an older version of the app.";
      h.fix = "On your computer, with DATABASE_URL pointing at Aiven, run: npm run db:reset";
      return h;
    }
  } catch (e) {
    h.problem = `Database check failed: ${(e as Error).message.slice(0, 160)}`;
    h.fix = "Run npm run db:reset against this database.";
    return h;
  }
  h.ok = true;
  return h;
}
