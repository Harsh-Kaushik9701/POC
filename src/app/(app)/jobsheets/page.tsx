import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { fmtDay } from "@/lib/time";
import { dur, money, pct } from "@/lib/format";
import { projectSummaries } from "@/server/jobsheets";

export const metadata = { title: "Jobsheets" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { active: "ok", quoted: "info", on_hold: "warn", closed: "mute" };

export default async function Jobsheets() {
  const u = await requireUser("jobsheets.view");
  const rows = await projectSummaries();
  const showCost = can(u.role, "costs.view");
  return (
    <>
      <div className="pagehead">
        <div><h1>Jobsheets</h1><p className="sub">Hours, labour cost and progress for every job. Click a job for tasks, workers and its timeline.</p></div>
      </div>
      <div className="tbl"><table>
        <thead><tr>
          <th>Job</th><th>Client</th><th>Status</th><th className="num">Due</th><th className="num">Tasks done</th>
          <th className="num" title="Time booked to job tasks">Actual</th><th className="num">Budget</th><th>Budget used</th>
          <th className="num" title="Time workers were blocked on this job">Waiting</th><th className="num">Workers</th>{showCost && <th className="num">Labour cost</th>}{showCost && <th className="num">Quote</th>}
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const used = r.budget_minutes ? r.direct_s / 60 / r.budget_minutes : null;
            return (
              <tr key={r.id}>
                <td><Link href={`/jobsheets/${r.id}`}><b className="mono">{r.code}</b></Link> {r.name}{r.parent_code ? <div className="muted small">Sub-job of {r.parent_code}</div> : null}</td>
                <td className="small">{r.client ?? <span className="muted">Internal</span>}</td>
                <td><span className={`pill ${STATUS[r.status] ?? "mute"}`}>{r.status.replace("_", " ")}</span></td>
                <td className="num">{r.due_date ? fmtDay(r.due_date) : "–"}</td>
                <td className="num">{r.done}/{r.tasks}</td>
                <td className="num">{dur(r.direct_s)}</td>
                <td className="num">{r.budget_minutes ? dur(r.budget_minutes * 60) : "–"}</td>
                <td style={{ minWidth: 120 }}>{used != null ? <><div className="pbar"><i className={used > 1 ? "over" : ""} style={{ width: `${Math.min(100, used * 100)}%` }} /></div><span className="small mono">{pct(used)}</span></> : "–"}</td>
                <td className="num">{r.waiting_s ? dur(r.waiting_s) : "–"}</td>
                <td className="num">{r.workers || "–"}</td>
                {showCost && <td className="num">{money(r.cost_cents)}</td>}
                {showCost && <td className="num">{money(r.quote_cents)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}
