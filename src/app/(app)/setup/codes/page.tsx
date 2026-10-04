import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { Flash } from "@/components/Flash";
import { saveActivity, saveCode } from "../actions";

export const metadata = { title: "Activities & codes" };
export const dynamic = "force-dynamic";

const CATS = ["indirect", "waiting", "rework", "training", "travel", "personal", "break"];

export default async function Codes({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser("setup.system");
  const sp = await searchParams;
  const acts = await db.select().from(t.activityTypes).orderBy(t.activityTypes.name);
  const codes = await db.select().from(t.timeCodes).orderBy(t.timeCodes.sort);
  return (
    <>
      <div className="pagehead"><div><h1>Activities &amp; codes</h1><p className="sub">Activities are kinds of job work (TimeDock&apos;s &quot;Activities&quot;). Codes cover everything that isn&apos;t job work, and their flags decide how each minute counts.</p></div></div>
      <Flash {...sp} />
      <section className="panel">
        <header><h2>Activities</h2><span className="muted small">Any activity can be used on any job.</span></header>
        <div className="row">{acts.map((a) => <span key={a.id} className="chip"><i className="dot" style={{ background: a.colour }} />{a.code} · {a.name}</span>)}</div>
        <form action={saveActivity} className="row">
          <input name="code" placeholder="CODE" required aria-label="Code" style={{ width: 90 }} />
          <input name="name" placeholder="Name" required aria-label="Name" />
          <input name="colour" type="color" defaultValue="#5b6b7c" aria-label="Colour" style={{ width: 50, padding: 2 }} />
          <button className="btn sm">Add activity</button>
        </form>
      </section>
      <section className="panel">
        <header><h2>Codes and breaks</h2></header>
        <div className="tbl"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Category</th><th title="Included in paid hours">Paid</th><th title="Removed from available time (e.g. training)">Reduces available</th><th title="Counted as idle in KPIs">Counts as idle</th><th title="Worker must pick the job it relates to">Needs a job</th><th>Max min</th><th>Active</th><th /></tr></thead>
          <tbody>{codes.map((c) => (
            <tr key={c.id}><td colSpan={10} style={{ padding: 0 }}>
              <form action={saveCode} className="row" style={{ padding: "6px 10px", flexWrap: "nowrap" }}>
                <input type="hidden" name="id" value={c.id} />
                <input name="code" defaultValue={c.code} style={{ width: 110 }} aria-label="Code" className="mono" />
                <input name="name" defaultValue={c.name} style={{ width: 210 }} aria-label="Name" />
                <select name="category" defaultValue={c.category} aria-label="Category">{CATS.map((x) => <option key={x}>{x}</option>)}</select>
                <label className="small"><input type="checkbox" name="isPaid" defaultChecked={c.isPaid} /> Paid</label>
                <label className="small"><input type="checkbox" name="reducesAvailability" defaultChecked={c.reducesAvailability} /> Reduces</label>
                <label className="small"><input type="checkbox" name="countsAsIdle" defaultChecked={c.countsAsIdle} /> Idle</label>
                <label className="small"><input type="checkbox" name="requiresTask" defaultChecked={c.requiresTask} /> Job</label>
                <input name="maxMinutes" type="number" defaultValue={c.maxMinutes ?? ""} style={{ width: 70 }} aria-label="Max minutes" />
                <label className="small"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                <button className="btn sm">Save</button>
              </form>
            </td></tr>
          ))}</tbody>
        </table></div>
        <h3>New code</h3>
        <form action={saveCode} className="row">
          <input name="code" placeholder="CODE" required style={{ width: 110 }} aria-label="Code" />
          <input name="name" placeholder="Name" required aria-label="Name" />
          <select name="category" defaultValue="indirect" aria-label="Category">{CATS.map((x) => <option key={x}>{x}</option>)}</select>
          <label className="small"><input type="checkbox" name="isPaid" defaultChecked /> Paid</label>
          <label className="small"><input type="checkbox" name="reducesAvailability" /> Reduces available</label>
          <label className="small"><input type="checkbox" name="countsAsIdle" /> Counts as idle</label>
          <label className="small"><input type="checkbox" name="requiresTask" /> Needs a job</label>
          <input type="hidden" name="active" value="on" />
          <button className="btn sm primary">Add code</button>
        </form>
      </section>
    </>
  );
}
