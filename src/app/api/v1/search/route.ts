import { ilike, or, eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { apiUser } from "@/lib/session";
import { can } from "@/lib/permissions";

const PAGES: { label: string; href: string; action?: Parameters<typeof can>[1] }[] = [
  { label: "Home", href: "/home" }, { label: "Floor board", href: "/floor", action: "floor.view" }, { label: "Idle workers", href: "/idle", action: "floor.view" },
  { label: "Exceptions", href: "/exceptions", action: "exceptions.view" }, { label: "Timesheets", href: "/timesheets", action: "timesheets.view" },
  { label: "Jobsheets", href: "/jobsheets", action: "jobsheets.view" }, { label: "Reports", href: "/reports", action: "reports.view" },
  { label: "Payroll export", href: "/payroll", action: "payroll.export" }, { label: "Jobs & tasks", href: "/setup/jobs", action: "setup.jobs" },
  { label: "Staff & fobs", href: "/setup/staff", action: "setup.people" }, { label: "Devices", href: "/setup/devices", action: "setup.system" },
  { label: "Activities & codes", href: "/setup/codes", action: "setup.system" }, { label: "Shifts & rules", href: "/setup/rules", action: "setup.system" },
];

/** Global search behind the top bar: workers, jobs, tasks and pages the user may open. */
export async function GET(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ hits: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const hits: { kind: string; label: string; sub: string; href: string }[] = [];
  if (can(u.role, "timesheets.view")) {
    const w = await db.select().from(t.employees)
      .where(or(ilike(sql`${t.employees.firstName} || ' ' || ${t.employees.lastName}`, like), ilike(t.employees.code, like), ilike(t.employees.trade, like))).limit(6);
    for (const e of w) hits.push({ kind: "worker", label: `${e.firstName} ${e.lastName}`, sub: `${e.code} · ${e.trade}`, href: `/timesheets/${e.id}` });
  }
  if (can(u.role, "jobsheets.view")) {
    const p = await db.select({ p: t.projects, c: t.clients }).from(t.projects).leftJoin(t.clients, eq(t.clients.id, t.projects.clientId))
      .where(or(ilike(t.projects.code, like), ilike(t.projects.name, like), ilike(t.clients.name, like))).limit(6);
    for (const { p: x, c } of p) hits.push({ kind: "job", label: `${x.code} ${x.name}`, sub: c?.name ?? "Internal", href: `/jobsheets/${x.id}` });
    const tk = await db.select({ tk: t.tasks, p: t.projects }).from(t.tasks).innerJoin(t.projects, eq(t.projects.id, t.tasks.projectId))
      .where(or(ilike(t.tasks.code, like), ilike(t.tasks.name, like))).limit(6);
    for (const { tk: x, p: pr } of tk) hits.push({ kind: "task", label: `${x.code} ${x.name}`, sub: pr.name, href: `/jobsheets/${pr.id}` });
  }
  const low = q.toLowerCase();
  for (const pg of PAGES) if (pg.label.toLowerCase().includes(low) && (!pg.action || can(u.role, pg.action))) hits.push({ kind: "page", label: pg.label, sub: "Go to page", href: pg.href });
  return Response.json({ hits: hits.slice(0, 14) });
}
