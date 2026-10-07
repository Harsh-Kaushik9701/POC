import Link from "next/link";
import { requireUser } from "@/lib/session";
import { addDays, fmtDay, fmtTime, mondayOf, todayLocal } from "@/lib/time";
import { dur, pct, KIND_LABEL } from "@/lib/format";
import { idleRanking } from "@/server/idle";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Idle workers" };
export const dynamic = "force-dynamic";

const VIEWS: [string, string][] = [["now", "Idle right now"], ["today", "Most idle today"], ["week", "This week"], ["14d", "Last 14 days"]];

export default async function IdleWorkers({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser("floor.view");
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "now";
  const today = todayLocal();
  const from = view === "week" ? mondayOf(today) : view === "14d" ? addDays(today, -13) : today;
  const { rows, now, idleAlertMin } = await idleRanking(from, today);

  const tabs = <nav className="tabs">{VIEWS.map(([k, label]) => <Link key={k} href={`/idle?view=${k}`} aria-current={view === k ? "page" : undefined}>{label}</Link>)}</nav>;
  const avatar = (r: (typeof rows)[number]) => (
    <span className="row" style={{ flexWrap: "nowrap" }}>
      <span className="avatar" style={{ background: r.colour }}>{r.first[0]}{r.last[0]}</span>
      <span><Link href={`/timesheets/${r.employeeId}/${today}`}><b>{r.name}</b></Link><br /><span className="muted small">{r.trade}{r.dept ? ` · ${r.dept}` : ""}</span></span>
    </span>
  );

  if (view === "now") {
    const list = rows.filter((r) => r.idleSince !== null).sort((a, b) => b.idleNowS - a.idleNowS);
    const over = list.filter((r) => r.idleNowS > idleAlertMin * 60).length;
    return (
      <>
        <AutoRefresh seconds={15} />
        <div className="pagehead">
          <div><h1>Idle workers</h1><p className="sub">Clocked on but not on a job, activity, code or break. Longest idle first. Updates every 15 seconds.</p></div>
          <div className="row"><span className="clockchip">{fmtTime(now)}</span><Link className="btn tape" href="/floor">Assign work on the floor board</Link></div>
        </div>
        {tabs}
        <div className="kpis">
          <div className={`kpi ${list.length ? "bad" : "good"}`}><small>Idle now</small><b>{list.length}</b></div>
          <div className={`kpi ${over ? "bad" : ""}`}><small>Idle over {idleAlertMin} min</small><b>{over}</b></div>
          <div className="kpi"><small>Longest right now</small><b>{list[0] ? dur(list[0].idleNowS) : "–"}</b></div>
          <div className="kpi"><small>Idle time lost so far</small><b>{dur(list.reduce((a, r) => a + r.idleNowS, 0))}</b></div>
        </div>
        {list.length === 0 ? <div className="panel empty">Nobody is idle right now.</div> : (
          <div className="tbl"><table>
            <thead><tr><th className="num">#</th><th>Worker</th><th className="num">Idle since</th><th className="num">Idle for</th><th style={{ minWidth: 140 }} /><th className="num" title="All idle time today, including this stretch">Idle today</th><th /></tr></thead>
            <tbody>{list.map((r, i) => {
              const alarm = r.idleNowS > idleAlertMin * 60;
              return (
                <tr key={r.employeeId} style={alarm ? { background: "var(--bad-bg)" } : undefined}>
                  <td className="num">{i + 1}</td>
                  <td>{avatar(r)}</td>
                  <td className="num">{fmtTime(r.idleSince)}</td>
                  <td className="num"><b style={{ fontSize: 18, color: alarm ? "var(--s-unalloc)" : undefined }}>{dur(r.idleNowS)}</b></td>
                  <td><div className="pbar"><i className="over" style={{ width: `${Math.min(100, (r.idleNowS / Math.max(list[0].idleNowS, 1)) * 100)}%` }} /></div>{alarm && <span className="pill bad nocap" style={{ marginTop: 4 }}>Over {idleAlertMin} min</span>}</td>
                  <td className="num">{dur(r.idleS)}</td>
                  <td><Link className="btn sm" href={`/timesheets/${r.employeeId}/${today}`}>Open day</Link></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </>
    );
  }

  const list = rows.filter((r) => r.idleS > 0).sort((a, b) => b.idleS - a.idleS);
  const max = Math.max(1, ...list.map((r) => r.idleS));
  const total = list.reduce((a, r) => a + r.idleS, 0);
  const avail = rows.reduce((a, r) => a + r.availableS, 0);
  return (
    <>
      {view === "today" && <AutoRefresh seconds={30} />}
      <div className="pagehead">
        <div><h1>Idle workers</h1><p className="sub">Total idle time {from === today ? "today" : `${fmtDay(from)} – ${fmtDay(today)}`}, most idle first. Idle = clocked on but not on a job, activity, code or break.</p></div>
        <span className="clockchip">{fmtTime(now)}</span>
      </div>
      {tabs}
      <div className="kpis">
        <div className="kpi bad"><small>Total idle</small><b>{dur(total)}</b></div>
        <div className="kpi bad" title="Idle ÷ available, all staff"><small>Idle %</small><b>{pct(avail ? total / avail : null)}</b></div>
        <div className="kpi"><small>Most idle</small><b>{list[0] ? list[0].first : "–"}</b></div>
        <div className="kpi"><small>Idle right now</small><b>{rows.filter((r) => r.idleSince !== null).length}</b></div>
      </div>
      {list.length === 0 ? <div className="panel empty">No idle time in this period.</div> : (
        <div className="tbl"><table>
          <thead><tr><th className="num">#</th><th>Worker</th><th className="num">Idle</th><th style={{ minWidth: 160 }} /><th className="num" title="Idle ÷ available time">Idle %</th><th className="num" title="Separate idle stretches">Times idle</th><th className="num">Longest</th><th>Now</th><th /></tr></thead>
          <tbody>{list.map((r, i) => (
            <tr key={r.employeeId}>
              <td className="num">{i + 1}</td>
              <td>{avatar(r)}</td>
              <td className="num"><b style={{ fontSize: 16 }}>{dur(r.idleS)}</b></td>
              <td><div className="pbar" style={{ height: 8 }}><i className="over" style={{ width: `${(r.idleS / max) * 100}%` }} /></div></td>
              <td className="num" style={{ color: r.availableS && r.idleS / r.availableS > 0.15 ? "var(--s-unalloc)" : undefined }}>{pct(r.availableS ? r.idleS / r.availableS : null)}</td>
              <td className="num">{r.stretches}</td>
              <td className="num">{dur(r.longestS)}</td>
              <td>{r.idleSince !== null ? <span className="pill bad nocap">Idle {dur(r.idleNowS)}</span> : <span className="pill mute nocap">{r.state === "off" ? "Not on site" : KIND_LABEL[r.state] ?? r.state}</span>}</td>
              <td><Link className="btn sm" href={view === "today" ? `/timesheets/${r.employeeId}/${today}` : `/timesheets/${r.employeeId}?week=${from}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="small muted">Idle time before the shift starts or after it ends isn&apos;t counted. Break overruns are counted as idle.</p>
    </>
  );
}
