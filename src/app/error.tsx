"use client";

/** Friendly error screen instead of the bare "This page couldn't load". */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="login">
      <div className="card panel">
        <div className="eyebrow">Something went wrong</div>
        <h1>This page couldn&apos;t load</h1>
        <p className="muted">The most common cause after deploying is the database connection. The setup check shows exactly what&apos;s missing.</p>
        <div className="row">
          <a className="btn primary" href="/status">Open setup check</a>
          <button className="btn" onClick={() => reset()}>Try again</button>
        </div>
        {error.digest && <p className="small muted">Error reference: {error.digest} (search for it in Vercel → Logs)</p>}
      </div>
    </main>
  );
}
