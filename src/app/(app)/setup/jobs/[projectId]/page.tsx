import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne, or } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { Flash } from "@/components/Flash";
import { saveProject, saveTask, assignTask, linkProject } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditJob({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser("setup.jobs");
  const { projectId } = await params;
  const sp = await searchParams;
  const [p] = await db.select().from(t.projects).where(eq(t.projects.id, projectId));
  if (!p) notFound();
  const clients = await db.select().from(t.clients).orderBy(t.clients.name);
  const others = await db.select().from(t.projects).where(ne(t.projects.id, projectId)).orderBy(t.projects.code);
  const tasks = await db.select().from(t.tasks).where(eq(t.tasks.projectId, projectId)).orderBy(t.tasks.sequence);
  const acts = await db.select().from(t.activityTypes).orderBy(t.activityTypes.name);
  const emps = await db.select().from(t.employees).where(eq(t.employees.active, true)).orderBy(t.employees.firstName);
  const assigns = await db.select({ a: t.taskAssignments, e: t.employees }).from(t.taskAssignments).innerJoin(t.employees, eq(t.employees.id, t.taskAssignments.employeeId)).where(ne(t.taskAssignments.status, "released"));
  const links = await db.select().from(t.projectLinks).where(or(eq(t.projectLinks.fromProjectId, projectId), eq(t.projectLinks.toProjectId, projectId)));
  const deps = await db.select().from(t.taskDependencies);
  const code = (id: string) => others.find((o) => o.id === id)?.code ?? p.code;
  void and;
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow"><Link href="/setup/jobs">Jobs &amp; tasks</Link></div><h1><span className="mono">{p.code}</span> {p.name}</h1></div>
        <Link className="btn" href={`/jobsheets/${p.id}`}>View jobsheet</Link></div>
      <Flash {...sp} />
      <section className="panel">
        <header><h2>Job details</h2></header>
        <form action={saveProject} className="form">
          <input type="hidden" name="id" value={p.id} />
          <label className="field">Job number<input name="code" defaultValue={p.code} required /></label>
          <label className="field wide">Name<input name="name" defaultValue={p.name} required /></label>
          <label className="field">Client<select name="clientId" defaultValue={p.clientId ?? ""}><option value="">Internal job</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field">Sub-job of<select name="parentProjectId" defaultValue={p.parentProjectId ?? ""}><option value="">–</option>{others.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}</select></label>
          <label className="field">Type<select name="type" defaultValue={p.type}><option value="customer">Customer</option><option value="internal">Internal</option><option value="warranty">Warranty</option></select></label>
          <label className="field">Status<select name="status" defaultValue={p.status}><option value="quoted">Quoted</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed (no more time)</option></select></label>
          <label className="field">Start<input type="date" name="startDate" defaultValue={p.startDate ?? ""} /></label>
          <label className="field">Due<input type="date" name="dueDate" defaultValue={p.dueDate ?? ""} /></label>
          <label className="field">Budget hours<input type="number" step="0.5" name="budgetHours" defaultValue={p.budgetMinutes ? p.budgetMinutes / 60 : ""} /></label>
          <label className="field">Quote (AUD ex GST)<input type="number" name="quote" defaultValue={p.quoteCents ? p.quoteCents / 100 : ""} /></label>
          <label className="field wide">Description<textarea name="description" rows={2} defaultValue={p.description ?? ""} /></label>
          <div><button className="btn primary">Save job</button></div>
        </form>
      </section>

      <section className="panel">
        <header><h2>Tasks</h2><span className="muted small">Standard hours drive efficiency and the &quot;over standard&quot; alert.</span></header>
        <div className="tbl"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Activity</th><th className="num">Std hours</th><th>Priority</th><th>Bay</th><th>Status</th><th>Assigned</th><th /></tr></thead>
          <tbody>{tasks.map((tk) => (
            <tr key={tk.id}>
              <td className="mono">{tk.code}{deps.filter((d) => d.taskId === tk.id).map((d) => <div key={d.dependsOnTaskId} className="muted small">after {tasks.find((x) => x.id === d.dependsOnTaskId)?.code}</div>)}</td>
              <td colSpan={6}>
                <form action={saveTask} className="row">
                  <input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="id" value={tk.id} />
                  <input name="name" defaultValue={tk.name} aria-label="Task name" style={{ width: 200 }} />
                  <select name="activityTypeId" defaultValue={tk.activityTypeId ?? ""} aria-label="Activity"><option value="">–</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  <input name="stdHours" type="number" step="0.25" defaultValue={tk.standardMinutes / 60} aria-label="Standard hours" style={{ width: 80 }} />
                  <select name="priority" defaultValue={String(tk.priority)} aria-label="Priority"><option value="1">Urgent</option><option value="2">Normal</option><option value="3">Low</option></select>
                  <input name="bay" defaultValue={tk.bay ?? ""} aria-label="Bay" style={{ width: 100 }} />
                  <select name="status" defaultValue={tk.status} aria-label="Status">{["todo", "ready", "in_progress", "paused", "blocked", "done"].map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select>
                  <button className="btn sm">Save</button>
                </form>
              </td>
              <td className="small">{assigns.filter((a) => a.a.taskId === tk.id).map((a) => a.e.firstName).join(", ") || "–"}</td>
              <td>
                <form action={assignTask} className="row">
                  <input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="taskId" value={tk.id} />
                  <select name="employeeId" defaultValue="" aria-label="Assign to"><option value="">Assign to…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select>
                  <button className="btn sm">Assign</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <h3>Add a task</h3>
        <form action={saveTask} className="form">
          <input type="hidden" name="projectId" value={p.id} />
          <label className="field wide">Task name<input name="name" required placeholder="e.g. Weld new cross-members" /></label>
          <label className="field">Activity<select name="activityTypeId" defaultValue=""><option value="">–</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field">Standard hours<input name="stdHours" type="number" step="0.25" required /></label>
          <label className="field">Priority<select name="priority" defaultValue="2"><option value="1">Urgent</option><option value="2">Normal</option><option value="3">Low</option></select></label>
          <label className="field">Bay / machine<input name="bay" /></label>
          <label className="field">Can&apos;t start until<select name="dependsOn" defaultValue=""><option value="">–</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></label>
          <div><button className="btn primary">Add task</button></div>
        </form>
      </section>

      <section className="panel">
        <header><h2>Linked jobs</h2></header>
        <div className="row">{links.map((l) => <span key={l.id} className="chip">{l.linkType.replace("_", " ")} · {code(l.fromProjectId === p.id ? l.toProjectId : l.fromProjectId)}</span>)}{!links.length && <span className="muted small">None</span>}</div>
        <form action={linkProject} className="row">
          <input type="hidden" name="projectId" value={p.id} />
          <select name="linkType" defaultValue="related" aria-label="Link type"><option value="related">Related to</option><option value="depends_on">Depends on</option><option value="supplies">Supplies</option></select>
          <select name="toProjectId" defaultValue="" aria-label="Job"><option value="">Pick a job…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}</select>
          <button className="btn sm">Link</button>
        </form>
      </section>
    </>
  );
}
