import { saveEmployee } from "../actions";

type Opt = { id: string; name: string };
export function EmployeeForm({ e, depts, patterns, acts, showRates }: {
  e?: { id: string; code: string; firstName: string; lastName: string; trade: string; employmentType: string; departmentId: string | null; workPatternId: string; payRateCents: number; costRateCents: number; phone: string | null; email: string | null; award: string | null; skills: string[]; active: boolean };
  depts: Opt[]; patterns: Opt[]; acts: { code: string; name: string }[]; showRates: boolean;
}) {
  return (
    <form action={saveEmployee} className="form">
      {e && <input type="hidden" name="id" value={e.id} />}
      <label className="field">Staff number<input name="code" defaultValue={e?.code} required placeholder="E013" /></label>
      <label className="field">First name<input name="firstName" defaultValue={e?.firstName} required /></label>
      <label className="field">Surname<input name="lastName" defaultValue={e?.lastName} required /></label>
      <label className="field">Trade / position<input name="trade" defaultValue={e?.trade} required placeholder="Boilermaker" /></label>
      <label className="field">Employment<select name="employmentType" defaultValue={e?.employmentType ?? "full_time"}><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="casual">Casual</option><option value="apprentice">Apprentice</option></select></label>
      <label className="field">Department<select name="departmentId" defaultValue={e?.departmentId ?? ""}><option value="">–</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label className="field">Shift<select name="workPatternId" defaultValue={e?.workPatternId ?? patterns[0]?.id}>{patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {showRates ? (<>
        <label className="field">Pay rate (AUD/h)<input name="payRate" type="number" step="0.01" defaultValue={e ? e.payRateCents / 100 : ""} required /></label>
        <label className="field">Cost rate incl. on-costs (AUD/h)<input name="costRate" type="number" step="0.01" defaultValue={e ? e.costRateCents / 100 : ""} required /></label>
      </>) : (<>
        <input type="hidden" name="payRate" value={e ? e.payRateCents / 100 : 0} /><input type="hidden" name="costRate" value={e ? e.costRateCents / 100 : 0} />
      </>)}
      <label className="field">Mobile<input name="phone" defaultValue={e?.phone ?? ""} /></label>
      <label className="field">Email<input name="email" type="email" defaultValue={e?.email ?? ""} /></label>
      <label className="field wide">Award<input name="award" defaultValue={e?.award ?? "Manufacturing and Associated Industries and Occupations Award 2020"} /></label>
      <fieldset className="wide row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted">Usually works on (sorts their kiosk job list)</legend>
        {acts.map((a) => <label key={a.code} className="chip"><input type="checkbox" name="skills" value={a.code} defaultChecked={e?.skills.includes(a.code)} /> {a.name}</label>)}
      </fieldset>
      {e && <label className="field">Status<select name="active" defaultValue={e.active ? "yes" : "no"}><option value="yes">Active</option><option value="no">Left / inactive</option></select></label>}
      <div><button className="btn primary">{e ? "Save" : "Add staff member"}</button></div>
    </form>
  );
}
