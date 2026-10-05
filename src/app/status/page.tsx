import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";
export const metadata = { title: "System status" };

/** Human-readable setup check. Shown automatically when the app can't reach its database. */
export default async function Status() {
  const h = await checkHealth();
  const row = (label: string, ok: boolean) => (
    <li className="spread"><span>{label}</span><span className={`pill ${ok ? "ok" : "bad"}`}>{ok ? "OK" : "Not yet"}</span></li>
  );
  return (
    <main className="login">
      <div className="card panel">
        <div className="eyebrow">Akaal Management · setup check</div>
        <h1>{h.ok ? "Everything is connected" : "The app isn't set up yet"}</h1>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {row("DATABASE_URL is set on the server", h.databaseUrlSet || process.env.NODE_ENV !== "production")}
          {row("Database can be reached", h.databaseReachable)}
          {row("Tables are created", h.tablesReady)}
          {row("Demo data is loaded", h.demoDataLoaded)}
        </ul>
        {h.problem && <div className="flash err"><b>Problem:</b> {h.problem}</div>}
        {h.fix && <div className="callout"><p><b>Fix:</b> {h.fix}</p></div>}
        <div className="row">{h.ok ? <a className="btn primary" href="/login">Go to log in</a> : <a className="btn" href="/status">Check again</a>}</div>
      </div>
    </main>
  );
}
