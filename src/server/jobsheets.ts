import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { appNow } from "@/lib/time";

/** Jobsheets are views over time segments, so they always agree with timesheets. */
export async function projectSummaries() {
  const now = new Date(appNow()).toISOString();
  const rows = await db.execute<{
    id: string; code: string; name: string; status: string; type: string; due_date: string | null; client: string | null; parent_code: string | null;
    budget_minutes: number | null; quote_cents: number | null; tasks: number; done: number; direct_s: number; waiting_s: number; cost_cents: number; std_min: number; workers: number;
  }>(sql`
    select p.id, p.code, p.name, p.status, p.type, p.due_date, c.name as client, pp.code as parent_code, p.budget_minutes, p.quote_cents,
      (select count(*) from tasks x where x.project_id = p.id)::int as tasks,
      (select count(*) from tasks x where x.project_id = p.id and x.status = 'done')::int as done,
      (select coalesce(sum(standard_minutes),0) from tasks x where x.project_id = p.id)::int as std_min,
      coalesce(sum(extract(epoch from coalesce(s.end_at, ${now}::timestamptz) - s.start_at)) filter (where s.kind = 'direct'), 0)::int as direct_s,
      coalesce(sum(extract(epoch from coalesce(s.end_at, ${now}::timestamptz) - s.start_at)) filter (where s.kind = 'waiting'), 0)::int as waiting_s,
      coalesce(sum(extract(epoch from coalesce(s.end_at, ${now}::timestamptz) - s.start_at) / 3600.0 * s.cost_rate_cents) filter (where s.kind = 'direct'), 0)::int as cost_cents,
      count(distinct s.employee_id) filter (where s.kind = 'direct')::int as workers
    from projects p
    left join clients c on c.id = p.client_id
    left join projects pp on pp.id = p.parent_project_id
    left join time_segments s on s.project_id = p.id
    group by p.id, c.name, pp.code
    order by (p.status = 'closed'), p.code desc`);
  return rows.map((r) => ({ ...r, direct_s: Number(r.direct_s), waiting_s: Number(r.waiting_s), cost_cents: Number(r.cost_cents) }));
}

export async function projectDetail(projectId: string) {
  const [p] = await db.select({ p: t.projects, c: t.clients }).from(t.projects).leftJoin(t.clients, eq(t.clients.id, t.projects.clientId)).where(eq(t.projects.id, projectId));
  if (!p) return null;
  const children = await db.select().from(t.projects).where(eq(t.projects.parentProjectId, projectId));
  const parent = p.p.parentProjectId ? (await db.select().from(t.projects).where(eq(t.projects.id, p.p.parentProjectId)))[0] : null;
  const links = await db.select({ l: t.projectLinks, from: t.projects }).from(t.projectLinks)
    .innerJoin(t.projects, or(eq(t.projects.id, t.projectLinks.toProjectId), eq(t.projects.id, t.projectLinks.fromProjectId)))
    .where(or(eq(t.projectLinks.fromProjectId, projectId), eq(t.projectLinks.toProjectId, projectId)));
  const tasks = await db.select({ tk: t.tasks, a: t.activityTypes }).from(t.tasks).leftJoin(t.activityTypes, eq(t.activityTypes.id, t.tasks.activityTypeId))
    .where(eq(t.tasks.projectId, projectId)).orderBy(asc(t.tasks.sequence));
  const ids = tasks.map((x) => x.tk.id);
  const segs = ids.length ? await db.select({ s: t.timeSegments, e: t.employees, c: t.timeCodes }).from(t.timeSegments)
    .innerJoin(t.employees, eq(t.employees.id, t.timeSegments.employeeId))
    .leftJoin(t.timeCodes, eq(t.timeCodes.id, t.timeSegments.timeCodeId))
    .where(inArray(t.timeSegments.taskId, ids)).orderBy(asc(t.timeSegments.startAt)) : [];
  const deps = ids.length ? await db.select().from(t.taskDependencies).where(inArray(t.taskDependencies.taskId, ids)) : [];
  const activities = await db.select({ a: t.activityTypes }).from(t.projectActivityTypes).innerJoin(t.activityTypes, eq(t.activityTypes.id, t.projectActivityTypes.activityTypeId)).where(eq(t.projectActivityTypes.projectId, projectId));
  return { ...p, children, parent, links: links.filter((x) => x.from.id !== projectId), tasks, segs, deps, activities: activities.map((x) => x.a) };
}
