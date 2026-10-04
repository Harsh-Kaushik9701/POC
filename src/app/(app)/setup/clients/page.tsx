import { sql } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { Flash } from "@/components/Flash";
import { saveClient } from "../actions";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function Clients({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser("setup.jobs");
  const sp = await searchParams;
  const rows = await db.select({ c: t.clients, n: sql<number>`(select count(*) from projects p where p.client_id = ${t.clients.id})::int` }).from(t.clients).orderBy(t.clients.name);
  return (
    <>
      <div className="pagehead"><div><h1>Clients</h1></div></div>
      <Flash {...sp} />
      <div className="tbl"><table>
        <thead><tr><th>Name</th><th>ABN</th><th>Contact</th><th>Phone</th><th>Email</th><th>Suburb</th><th className="num">Jobs</th></tr></thead>
        <tbody>{rows.map(({ c, n }) => <tr key={c.id}><td><b>{c.name}</b></td><td className="mono small">{c.abn}</td><td>{c.contactName}</td><td className="mono small">{c.phone}</td><td className="small">{c.email}</td><td className="small">{c.suburb}</td><td className="num">{n}</td></tr>)}</tbody>
      </table></div>
      <section className="panel"><header><h2>Add a client</h2></header>
        <form action={saveClient} className="form">
          <label className="field wide">Business name<input name="name" required /></label>
          <label className="field">ABN<input name="abn" placeholder="12 345 678 901" /></label>
          <label className="field">Contact<input name="contactName" /></label>
          <label className="field">Phone<input name="phone" /></label>
          <label className="field">Email<input name="email" type="email" /></label>
          <label className="field">Suburb<input name="suburb" placeholder="Rocklea QLD" /></label>
          <div><button className="btn primary">Add client</button></div>
        </form>
      </section>
    </>
  );
}
