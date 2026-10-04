import { desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { fmtDay, fmtTime, localDate } from "@/lib/time";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function Audit() {
  await requireUser("audit.view");
  const rows = await db.select({ a: t.auditLog, u: t.users }).from(t.auditLog).leftJoin(t.users, eq(t.users.id, t.auditLog.actorUserId)).orderBy(desc(t.auditLog.at)).limit(200);
  return (
    <>
      <div className="pagehead"><div><h1>Audit log</h1><p className="sub">Every change made in the office: approvals, corrections, exports, setup. Latest 200.</p></div></div>
      <div className="tbl"><table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>{rows.map(({ a, u }) => (
          <tr key={a.id}><td className="num">{fmtDay(localDate(a.at.getTime()))} {fmtTime(a.at)}</td><td>{u?.name ?? "System"}</td><td className="mono small">{a.action}</td>
            <td className="mono small" style={{ maxWidth: 520, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a.detail ? JSON.stringify(a.detail) : ""}</td></tr>
        ))}{!rows.length && <tr><td colSpan={4} className="muted">Nothing yet</td></tr>}</tbody>
      </table></div>
    </>
  );
}
