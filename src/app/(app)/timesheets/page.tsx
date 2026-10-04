import Link from "next/link";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { addDays, fmtDay, mondayOf, todayLocal } from "@/lib/time";
import { dur, hrs, pct } from "@/lib/format";
import { weekGrid } from "@/server/timesheets";
import { approveWeek } from "./actions";

export const metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  approved: ["Approved", "ok"], needs_review: ["Check", "warn"], open: ["Not approved", "mute"], locked: ["Locked", "info"],
};

export default async function Timesheets({ searchParams }: { searchParams: Promise<{ week?: string; dept?: string }> }) {
  const u = await requireUser("timesheets.view");
  const sp = await searchParams;
  const today = todayLocal();
  const monday = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const depts = await db.select().from(t.departments).orderBy(t.departments.name);
  const { emps, days } = await weekGrid(monday, sp.dept || null);
  const canApprove = can(u.role, "timesheets.approve");
  const q = (w: string) => `/timesheets?week=${w}${sp.dept ? `&dept=${sp.dept}` : ""}`;

  let grand = { paid: 0, ot: 0, direct: 0, idle: 0, avail: 0 };
  const rows = emps.map(({ e, d }) => {
    const mine = dates.map((dt) => days.find((x) => x.employeeId === e.id && x.workDate === dt) ?? null);
    const tot = mine.reduce((a, x) => x ? { paid: a.paid + x.paidS, ot: a.ot + x.overtimeS, direct: a.direct + x.directS, idle: a.idle + x.unallocatedS, avail: a.avail + x.availableS } : a, { paid: 0, ot: 0, direct: 0, idle: 0, avail: 0 });
    grand = { paid: grand.paid + tot.paid, ot: grand.ot + tot.ot, direct: grand.direct + tot.direct, idle: grand.idle + tot.idle, avail: grand.avail + tot.avail };
    const toApprove = mine.filter((x) => x && !x.isOpen && x.status !== "approved" && x.status !== "locked").length;
    return { e, d, mine, tot, toApprove };
  });

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Timesheets</h1>
          <p className="sub">Week of {fmtDay(monday)} – {fmtDay(addDays(monday, 6))}. Click a day to see exactly what happened; click a name for the week.</p>
        </div>
        <div className="row">
          <Link className="btn" href={q(addDays(monday, -7))}>← Previous week</Link>
          <Link className="btn" href={q(mondayOf(today))}>This week</Link>
          <Link className="btn" href={q(addDays(monday, 7))}>Next week →</Link>
        </div>
      </div>
      <form className="row" action="/timesheets">
        <input type="hidden" name="week" value={monday} />
        <label className="field" style={{ minWidth: 220 }}>Department
          <select name="dept" defaultValue={sp.dept ?? ""}>
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <button className="btn" style={{ alignSelf: "end" }}>Filter</button>
      </form>

      <div className="tbl">
        <table className="ts">
          <thead>
            <tr>
              <th>Worker</th>
              {dates.map((dt) => <th key={dt} className="num" style={dt === today ? { color: "var(--ink)" } : undefined}>{fmtDay(dt)}</th>)}
              <th className="num" title="Paid hours this week">Paid</th>
              <th className="num" title="Paid − ordinary hours">Overtime</th>
              <th className="num" title="On jobs ÷ available">Utilisation</th>
              <th className="num">Idle</th>
              {canApprove && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, d, mine, tot, toApprove }) => (
              <tr key={e.id}>
                <td style={{ minWidth: 190 }}><Link href={`/timesheets/${e.id}?week=${monday}`}><b>{e.firstName} {e.lastName}</b></Link><div className="muted small">{e.trade} · {d?.name}</div></td>
                {mine.map((x, i) => {
                  if (!x) return <td key={i} className="num muted">–</td>;
                  const s = STATUS[x.isOpen ? "" : x.status];
                  const av = Math.max(x.availableS, 1);
                  const ip = x.unallocatedS / av;
                  return (
                    <td key={i} className="num cell">
                      <Link href={`/timesheets/${e.id}/${dates[i]}`} title={`On jobs ${dur(x.directS)} · idle ${dur(x.unallocatedS)} · waiting ${dur(x.waitingS)}`}>
                        <div>{hrs(x.paidS)}{x.flags.includes("auto_clock_off") ? " ⚑" : ""}</div>
                        <div className="mbar"><i className="c-direct" style={{ width: `${(x.directS / av) * 100}%` }} /><i className="c-indirect" style={{ width: `${(x.indirectS / av) * 100}%` }} /><i className="c-waiting" style={{ width: `${(x.waitingS / av) * 100}%` }} /><i className="c-unallocated" style={{ width: `${ip * 100}%` }} /></div>
                        <div className={`idle${ip > 0.15 ? " hi" : ""}`}>{x.isOpen ? "on site" : `idle ${Math.round(ip * 100)}%`}</div>
                        {s && x.status !== "open" ? <span className={`pill ${s[1]}`} style={{ marginTop: 3 }}>{s[0]}</span> : null}
                      </Link>
                    </td>
                  );
                })}
                <td className="num"><b>{hrs(tot.paid)}</b></td>
                <td className="num">{tot.ot ? hrs(tot.ot) : "–"}</td>
                <td className="num">{pct(tot.avail ? tot.direct / tot.avail : null)}</td>
                <td className="num">{dur(tot.idle)}</td>
                {canApprove && (
                  <td>
                    {toApprove ? (
                      <form action={approveWeek}><input type="hidden" name="monday" value={monday} /><input type="hidden" name="employeeId" value={e.id} />
                        <button className="btn sm">Approve {toApprove}d</button></form>
                    ) : <span className="muted small">–</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>All staff</td>
              {dates.map((dt) => { const v = days.filter((x) => x.workDate === dt && rows.some((r) => r.e.id === x.employeeId)).reduce((a, x) => a + x.paidS, 0); return <td key={dt} className="num">{v ? hrs(v, 1) : "–"}</td>; })}
              <td className="num">{hrs(grand.paid, 1)}</td>
              <td className="num">{hrs(grand.ot, 1)}</td>
              <td className="num">{pct(grand.avail ? grand.direct / grand.avail : null)}</td>
              <td className="num">{dur(grand.idle)}</td>
              {canApprove && <td>
                <form action={approveWeek}><input type="hidden" name="monday" value={monday} />{rows.map((r) => <input key={r.e.id} type="hidden" name="employeeId" value={r.e.id} />)}
                  <button className="btn sm primary">Approve all</button></form>
              </td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="legend">
        <span><i className="dot c-direct" />On jobs</span><span><i className="dot c-indirect" />Indirect</span><span><i className="dot c-waiting" />Waiting</span><span><i className="dot c-unallocated" />Idle</span>
        <span>Hours are decimal paid hours · ⚑ auto clocked off</span>
      </div>
    </>
  );
}
