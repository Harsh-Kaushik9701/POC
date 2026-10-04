import { eq, ne } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { appNow, fmtTime, fmtDay, localDate } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { createDevice, updateDevice } from "../actions";

export const metadata = { title: "Devices" };
export const dynamic = "force-dynamic";

export default async function Devices({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser("setup.system");
  const sp = await searchParams;
  const devices = await db.select({ d: t.devices, tk: t.tasks }).from(t.devices).leftJoin(t.tasks, eq(t.tasks.id, t.devices.fixedTaskId)).orderBy(t.devices.createdAt);
  const tasks = await db.select().from(t.tasks).where(ne(t.tasks.status, "done")).orderBy(t.tasks.code);
  const now = appNow();
  return (
    <>
      <div className="pagehead"><div><h1>Devices</h1><p className="sub">Kiosks, station terminals and supervisor phones. Each has its own pairing code and can be revoked.</p></div></div>
      <Flash {...sp} />
      <div className="tbl"><table>
        <thead><tr><th>Device</th><th>Type</th><th>Status</th><th>Last seen</th><th>Settings</th><th>Open</th></tr></thead>
        <tbody>{devices.map(({ d, tk }) => {
          const online = d.lastSeenAt && now - d.lastSeenAt.getTime() < 3 * 60_000;
          return (
            <tr key={d.id} style={d.revokedAt ? { opacity: 0.5 } : undefined}>
              <td><b>{d.name}</b><div className="mono small muted">{d.token}</div></td>
              <td className="small">{d.kind === "station" ? `Station · ${tk?.code ?? "no task"}` : d.kind === "supervisor" ? "Supervisor phone" : "Kiosk"}</td>
              <td>{d.revokedAt ? <span className="pill mute">Revoked</span> : online ? <span className="pill ok">Online</span> : <span className="pill warn">Offline</span>}</td>
              <td className="small">{d.lastSeenAt ? `${fmtDay(localDate(d.lastSeenAt.getTime()))} ${fmtTime(d.lastSeenAt)}` : "Never"}{d.appVersion ? ` · v${d.appVersion}` : ""}</td>
              <td>{!d.revokedAt && (
                <form action={updateDevice} className="row small">
                  <input type="hidden" name="id" value={d.id} />
                  <select name="fixedTaskId" defaultValue={d.fixedTaskId ?? ""} aria-label="Fixed task"><option value="">No fixed task</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select>
                  <label><input type="checkbox" name="photoRequired" defaultChecked={d.photoRequired} /> Photo</label>
                  <label><input type="checkbox" name="pinFallback" defaultChecked={d.pinFallback} /> PIN</label>
                  <button className="btn sm">Save</button>
                  <button className="btn sm danger" name="revoke" value="1">Revoke</button>
                </form>
              )}</td>
              <td>{!d.revokedAt && <a className="btn sm" href={`/kiosk?device=${d.token}`} target="_blank">Open ↗</a>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <section className="panel">
        <header><h2>Pair a new device</h2><span className="muted small">Creates a pairing code. Enter it on the tablet, or open the kiosk link on it.</span></header>
        <form action={createDevice} className="form">
          <label className="field">Name<input name="name" required placeholder="Paint booth tablet" /></label>
          <label className="field">Type<select name="kind" defaultValue="kiosk"><option value="kiosk">Kiosk (clock on/off and jobs)</option><option value="station">Station (one machine or bay)</option><option value="supervisor">Supervisor phone</option></select></label>
          <label className="field">Fixed task (stations)<select name="fixedTaskId" defaultValue=""><option value="">–</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></label>
          <div><button className="btn primary">Create device</button></div>
        </form>
      </section>
      <div className="callout"><p><b>Hardware note.</b> This POC kiosk runs in a browser and accepts a USB NFC reader in keyboard mode. The production app is an Android build (Expo) that reads fob chip IDs with the tablet&apos;s own NFC, works offline and runs locked to the app. eSSL/ZKTeco gate terminals can push punches to the API in phase 2.</p></div>
    </>
  );
}
