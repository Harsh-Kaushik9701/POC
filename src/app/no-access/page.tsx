import Link from "next/link";

export default function NoAccess() {
  return (
    <main className="login">
      <div className="card panel">
        <h1>You don&apos;t have access to that page</h1>
        <p className="muted">Your role can&apos;t open it. Ask the owner if you need access, or log in as someone else.</p>
        <div className="row"><Link className="btn primary" href="/">Go to my home page</Link><Link className="btn" href="/login">Switch user</Link></div>
      </div>
    </main>
  );
}
