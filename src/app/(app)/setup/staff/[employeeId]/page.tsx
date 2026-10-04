import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { fmtDay, localDate } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { EmployeeForm } from "../EmployeeForm";
import { addFob, revokeFob, setPin } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditStaff({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const u = await requireUser("setup.people");
  const { employeeId } = await params;
  const sp = await searchParams;
  const [e] = await db.select().from(t.employees).where(eq(t.employees.id, employeeId));
  if (!e) notFound();
  const creds = await db.select().from(t.credentials).where(eq(t.credentials.employeeId, employeeId)).orderBy(desc(t.credentials.issuedAt));
  const depts = await db.select().from(t.departments);
  const patterns = await db.select().from(t.workPatterns);
  const acts = await db.select().from(t.activityTypes);
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow"><Link href="/setup/staff">Staff &amp; fobs</Link></div><h1>{e.firstName} {e.lastName}</h1><p className="sub">{e.code} · {e.trade}</p></div>
        <Link className="btn" href={`/timesheets/${e.id}`}>Timesheet</Link></div>
      <Flash {...sp} />
      <section className="panel"><header><h2>Details</h2></header><EmployeeForm e={e} depts={depts} patterns={patterns} acts={acts} showRates={can(u.role, "costs.view")} /></section>
      <div className="grid2">
        <section className="panel">
          <header><h2>Fobs</h2><span className="muted small">A lost fob is revoked, never deleted, so old timesheets still show it.</span></header>
          <div className="tbl"><table>
            <thead><tr><th>Label</th><th>Fob ID (UID)</th><th className="num">Issued</th><th>Status</th><th /></tr></thead>
            <tbody>{creds.map((c) => (
              <tr key={c.id}><td>{c.label ?? "–"}</td><td className="mono">{c.value}</td><td className="num">{fmtDay(localDate(c.issuedAt.getTime()))}</td>
                <td>{c.revokedAt ? <span className="pill mute">Revoked · {c.revokeReason}</span> : <span className="pill ok">Active</span>}</td>
                <td>{!c.revokedAt && <form action={revokeFob} className="row"><input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="credentialId" value={c.id} />
                  <select name="reason" aria-label="Reason"><option>Lost</option><option>Damaged</option><option>Left the company</option></select><button className="btn sm danger">Revoke</button></form>}</td></tr>
            ))}{!creds.length && <tr><td colSpan={5} className="muted">No fobs yet</td></tr>}</tbody>
          </table></div>
          <form action={addFob} className="form">
            <input type="hidden" name="employeeId" value={e.id} />
            <label className="field">Fob ID<input name="uid" required placeholder="Click here, then tap the fob on the USB reader" autoComplete="off" /></label>
            <label className="field">Printed number<input name="label" placeholder="Fob 113" /></label>
            <div><button className="btn primary">Enrol fob</button></div>
          </form>
        </section>
        <section className="panel">
          <header><h2>Kiosk PIN</h2><span className="muted small">For days they forget their fob. PIN taps are flagged.</span></header>
          <form action={setPin} className="row">
            <input type="hidden" name="employeeId" value={e.id} />
            <input name="pin" inputMode="numeric" pattern="\d{4,6}" placeholder="4–6 digits" aria-label="New PIN" required />
            <button className="btn">Set PIN</button>
          </form>
          <p className="small muted">{e.pinHash ? "A PIN is set." : "No PIN set."}</p>
        </section>
      </div>
    </>
  );
}
