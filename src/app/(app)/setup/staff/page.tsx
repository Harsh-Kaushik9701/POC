import Link from "next/link";
import { eq, isNull } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { money } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { EmployeeForm } from "./EmployeeForm";

export const metadata = { title: "Staff & fobs" };
export const dynamic = "force-dynamic";

export default async function Staff({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const u = await requireUser("setup.people");
  const sp = await searchParams;
  const showRates = can(u.role, "costs.view");
  const rows = await db.select({ e: t.employees, d: t.departments, w: t.workPatterns }).from(t.employees)
    .leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId)).innerJoin(t.workPatterns, eq(t.workPatterns.id, t.employees.workPatternId))
    .orderBy(t.employees.code);
  const creds = await db.select().from(t.credentials).where(isNull(t.credentials.revokedAt));
  const depts = await db.select().from(t.departments);
  const patterns = await db.select().from(t.workPatterns);
  const acts = await db.select().from(t.activityTypes);
  return (
    <>
      <div className="pagehead"><div><h1>Staff &amp; fobs</h1><p className="sub">Workers, their NFC fobs, shifts and rates. Workers don&apos;t need a login: they tap a fob on the kiosk.</p></div></div>
      <Flash {...sp} />
      <div className="tbl"><table>
        <thead><tr><th>No.</th><th>Name</th><th>Trade</th><th>Department</th><th>Type</th><th>Shift</th><th>Fob</th>{showRates && <th className="num">Pay rate</th>}{showRates && <th className="num">Cost rate</th>}<th /></tr></thead>
        <tbody>{rows.map(({ e, d, w }) => {
          const fob = creds.find((c) => c.employeeId === e.id);
          return (
            <tr key={e.id} style={e.active ? undefined : { opacity: 0.55 }}>
              <td className="mono">{e.code}</td><td><b>{e.firstName} {e.lastName}</b></td><td className="small">{e.trade}</td><td className="small">{d?.name}</td>
              <td className="small">{e.employmentType.replace("_", " ")}</td><td className="small">{w.name}</td>
              <td>{fob ? <span className="chip">{fob.label ?? "Fob"} · <span className="mono">{fob.value.slice(-6)}</span></span> : <span className="pill warn">No fob</span>}</td>
              {showRates && <td className="num">{money(e.payRateCents)}</td>}{showRates && <td className="num">{money(e.costRateCents)}</td>}
              <td><Link className="btn sm" href={`/setup/staff/${e.id}`}>Edit</Link></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <section className="panel">
        <header><h2>Add a staff member</h2></header>
        <EmployeeForm depts={depts} patterns={patterns} acts={acts} showRates={showRates} />
      </section>
    </>
  );
}
