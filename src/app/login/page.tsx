import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { setSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";

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
    <main className="login">
      <div className="card">
        <div>
          <div className="eyebrow">Proof of concept · demo data</div>
          <h1>{org?.tradingName ?? "Shop Floor"}</h1>
          <p className="muted">{org?.address}</p>
        </div>
        <div className="callout">
          <p>Pick a person to log in as. Each role sees different screens. Production logins would use email or mobile one-time codes.</p>
        </div>
        <form action={login} className="stack">
          {users.map((u) => (
            <button key={u.id} className="who" name="userId" value={u.id}>
              <span className="avatar" style={{ background: "#3a4a5c" }}>{u.name.split(" ").map((x) => x[0]).join("")}</span>
              <span><b>{u.name}</b><br /><span className="muted small">{u.title}</span></span>
              <span className="pill mute">{ROLE_LABEL[u.role] ?? u.role}</span>
            </button>
          ))}
        </form>
        <p className="small muted">Shop-floor workers don&apos;t log in here. They tap their fob on the <a href="/kiosk?device=kiosk-front-gate-demo">kiosk</a>.</p>
      </div>
    </main>
  );
}
