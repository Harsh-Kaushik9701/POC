import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { fmtDay } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { saveProject } from "../actions";

export const metadata = { title: "Jobs & tasks" };
export const dynamic = "force-dynamic";

export default async function Jobs({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser("setup.jobs");
  const sp = await searchParams;
  const rows = await db.select({ p: t.projects, c: t.clients, n: sql<number>`(select count(*) from tasks x where x.project_id = ${t.projects.id})::int` })
    .from(t.projects).leftJoin(t.clients, eq(t.clients.id, t.projects.clientId)).orderBy(sql`${t.projects.status} = 'closed'`, sql`${t.projects.code} desc`);
  const clients = await db.select().from(t.clients).orderBy(t.clients.name);
  return (
    <>
      <div className="pagehead"><div><h1>Jobs &amp; tasks</h1><p className="sub">Jobs hold tasks. Workers start and finish tasks on the kiosk. Jobs can have sub-jobs and links to related jobs.</p></div></div>
      <Flash {...sp} />
      <div className="tbl"><table>
        <thead><tr><th>Job</th><th>Client</th><th>Type</th><th>Status</th><th className="num">Start</th><th className="num">Due</th><th className="num">Tasks</th><th /></tr></thead>
        <tbody>{rows.map(({ p, c, n }) => (
          <tr key={p.id}><td><b className="mono">{p.code}</b> {p.name}</td><td className="small">{c?.name ?? "–"}</td><td className="small">{p.type}</td><td><span className="pill mute">{p.status}</span></td>
            <td className="num">{p.startDate ? fmtDay(p.startDate) : "–"}</td><td className="num">{p.dueDate ? fmtDay(p.dueDate) : "–"}</td><td className="num">{n}</td>
            <td><Link className="btn sm" href={`/setup/jobs/${p.id}`}>Edit</Link> <Link className="btn sm" href={`/jobsheets/${p.id}`}>Jobsheet</Link></td></tr>
        ))}</tbody>
      </table></div>
      <section className="panel">
        <header><h2>New job</h2></header>
        <form action={saveProject} className="form">
          <label className="field">Job number<input name="code" required placeholder="J-24070" /></label>
          <label className="field wide">Name<input name="name" required placeholder="e.g. Tandem tipper body repair" /></label>
          <label className="field">Client<select name="clientId" defaultValue=""><option value="">Internal job</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field">Sub-job of<select name="parentProjectId" defaultValue=""><option value="">–</option>{rows.map(({ p }) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
          <label className="field">Type<select name="type" defaultValue="customer"><option value="customer">Customer</option><option value="internal">Internal</option><option value="warranty">Warranty</option></select></label>
          <label className="field">Status<select name="status" defaultValue="active"><option value="quoted">Quoted</option><option value="active">Active</option><option value="on_hold">On hold</option></select></label>
          <label className="field">Start<input type="date" name="startDate" /></label>
          <label className="field">Due<input type="date" name="dueDate" /></label>
          <label className="field">Budget hours<input type="number" step="0.5" name="budgetHours" /></label>
          <label className="field">Quote (AUD ex GST)<input type="number" step="1" name="quote" /></label>
          <label className="field wide">Description<textarea name="description" rows={2} /></label>
          <div><button className="btn primary">Create job</button></div>
        </form>
      </section>
    </>
  );
}
