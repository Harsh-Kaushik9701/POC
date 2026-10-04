import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { minToHHMM } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { savePolicy, savePattern } from "../actions";

export const metadata = { title: "Shifts & rules" };
export const dynamic = "force-dynamic";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function Rules({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser("setup.system");
  const sp = await searchParams;
  const [p] = await db.select().from(t.policies).limit(1);
  const patterns = await db.select().from(t.workPatterns);
  const PatternForm = ({ w }: { w?: typeof patterns[number] }) => (
    <form action={savePattern} className="form">
      {w && <input type="hidden" name="id" value={w.id} />}
      <label className="field wide">Name<input name="name" defaultValue={w?.name} required /></label>
      <label className="field">Start<input name="start" defaultValue={w ? minToHHMM(w.startMin) : "07:00"} required /></label>
      <label className="field">Finish<input name="end" defaultValue={w ? minToHHMM(w.endMin) : "15:30"} required /></label>
      <label className="field">Ordinary hours / day<input name="ordinaryHours" type="number" step="0.1" defaultValue={w ? w.ordinaryMin / 60 : 8} /></label>
      <label className="field">Grace (min late)<input name="graceMin" type="number" defaultValue={w?.graceMin ?? 5} /></label>
      <fieldset className="wide row" style={{ border: 0, padding: 0, margin: 0 }}><legend className="small muted">Days</legend>
        {DAYS.map((d, i) => <label key={d} className="chip"><input type="checkbox" name="days" value={i + 1} defaultChecked={w ? w.days.includes(i + 1) : i < 5} /> {d}</label>)}</fieldset>
      <div><button className="btn">{w ? "Save shift" : "Add shift"}</button></div>
    </form>
  );
  return (
    <>
      <div className="pagehead"><div><h1>Shifts &amp; rules</h1><p className="sub">How time is counted. Changes apply to new taps and whenever a day is recalculated.</p></div></div>
      <Flash {...sp} />
      <section className="panel">
        <header><h2>Rules</h2></header>
        <form action={savePolicy} className="form">
          <label className="field">Idle alert after (min)<input name="idleAlertMin" type="number" defaultValue={p.idleAlertMin} /></label>
          <label className="field">Auto clock-off (min after shift end)<input name="autoClockOffAfterEndMin" type="number" defaultValue={p.autoClockOffAfterEndMin} /></label>
          <label className="field">Longest shift (hours)<input name="maxShiftHours" type="number" step="0.5" defaultValue={p.maxShiftMin / 60} /></label>
          <label className="field">Flag task at % of standard<input name="taskOverStandardPct" type="number" defaultValue={p.taskOverStandardPct} /></label>
          <label className="field">Payroll rounding (min)<select name="payrollRoundingMin" defaultValue={String(p.payrollRoundingMin)}>{[0, 1, 5, 6, 10, 15].map((x) => <option key={x} value={x}>{x === 0 ? "None" : x}</option>)}</select></label>
          <label className="field">Kiosk undo window (sec)<input name="undoSeconds" type="number" defaultValue={p.undoSeconds} /></label>
          <label className="row small wide"><input type="checkbox" name="lunchAutoDeduct" defaultChecked={p.lunchAutoDeduct} /> Deduct lunch automatically if none is punched on a day over 5 hours</label>
          <label className="row small wide"><input type="checkbox" name="resumeAfterBreak" defaultChecked={p.resumeAfterBreak} /> After a break, put the worker back on their last job automatically (off = they show idle until they tap a job)</label>
          <label className="row small wide"><input type="checkbox" name="photoRequired" defaultChecked={p.photoRequired} /> Take a photo with every kiosk tap</label>
          <div><button className="btn primary">Save rules</button></div>
        </form>
      </section>
      <section className="panel">
        <header><h2>Shifts</h2><span className="muted small">Time before start or after finish that isn&apos;t on a job is kept separate and not counted as idle.</span></header>
        {patterns.map((w) => <div key={w.id} className="panel" style={{ background: "var(--bg)" }}><PatternForm w={w} /></div>)}
        <h3>New shift</h3>
        <PatternForm />
      </section>
    </>
  );
}
