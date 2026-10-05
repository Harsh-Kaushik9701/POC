import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { setSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  await setSession(String(formData.get("userId")));
  redirect("/");
}

export default async function LoginPage() {
  const users = await db.select().from(t.users).orderBy(t.users.createdAt);
  const [org] = await db.select().from(t.organisation).limit(1);
  return (
    <main className="login-split">
      <section className="login-hero">
        <div className="mark"><i>{BRAND.shortMark}</i>{BRAND.appName}</div>
        <div className="stack" style={{ gap: 16 }}>
          <h2>Every hour on the floor, <em>accounted for.</em></h2>
          <p>Clock on, jobs, idle time and jobsheets for {org?.tradingName ?? BRAND.company}. From the gate kiosk to the payroll export.</p>
        </div>
        <div className="facts">
          <span><b>Live</b>Floor board</span>
          <span><b>Fob</b>Tap to clock on</span>
          <span><b>AUD</b>Job costing</span>
        </div>
      </section>
      <div className="login">
        <div className="card">
          <div>
            <div className="eyebrow">Proof of concept · demo data</div>
            <h1>Log in</h1>
            <p className="muted">{org?.tradingName} · {org?.address}</p>
          </div>
          <div className="callout">
            <p>Pick a person to log in as. Each role sees different screens. Production logins would use email or mobile one-time codes.</p>
          </div>
          <form action={login} className="stack">
            {users.map((u) => (
              <button key={u.id} className="who" name="userId" value={u.id}>
                <span className="avatar" style={{ background: "var(--nav)", color: "var(--brand)" }}>{u.name.split(" ").map((x) => x[0]).join("")}</span>
                <span><b>{u.name}</b><br /><span className="muted small">{u.title}</span></span>
                <span className="pill mute">{ROLE_LABEL[u.role] ?? u.role}</span>
              </button>
            ))}
          </form>
          <p className="small muted">Shop-floor workers don&apos;t log in here. They tap their fob on the <a href="/kiosk?device=kiosk-front-gate-demo">kiosk</a>.</p>
        </div>
      </div>
    </main>
  );
}
