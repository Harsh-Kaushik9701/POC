import { and, between, eq, isNull } from "drizzle-orm";
import { db, sqlClient, t } from "@/db";
import { appNow } from "@/lib/time";
import { sweep } from "./sweep";

export interface IdleRow {
  employeeId: string; name: string; first: string; last: string; trade: string; dept: string | null; colour: string;
  /** Current state; idleSince is set when the worker is idle right now. */
  state: string; idleSince: number | null; idleNowS: number;
  idleS: number; stretches: number; longestS: number; lastIdleAt: number | null; availableS: number;
}

/**
 * Idle ranking for a date range (Brisbane work dates).
 * Idle = "unallocated" time: clocked on, inside the shift, not on a job, activity, code or break.
 * Running idle stretches count up to now.
 */
export async function idleRanking(from: string, to: string): Promise<{ rows: IdleRow[]; now: number; idleAlertMin: number }> {
  await sweep();
  const now = appNow();
  const nowIso = new Date(now).toISOString();
  const emps = await db.select({ e: t.employees, d: t.departments }).from(t.employees)
    .leftJoin(t.departments, eq(t.departments.id, t.employees.departmentId))
    .where(eq(t.employees.active, true));
  const stats = await sqlClient<{ employee_id: string; idle_s: number; stretches: number; longest_s: number; last_at: Date | null }[]>`
    select employee_id,
      sum(extract(epoch from coalesce(end_at, ${nowIso}::timestamptz) - start_at))::int as idle_s,
      count(*)::int as stretches,
      max(extract(epoch from coalesce(end_at, ${nowIso}::timestamptz) - start_at))::int as longest_s,
      max(start_at) as last_at
    from time_segments
    where kind = 'unallocated' and work_date between ${from} and ${to}
    group by employee_id`;
  const avail = await db.select({ employeeId: t.attendanceDays.employeeId, s: t.attendanceDays.availableS })
    .from(t.attendanceDays).where(between(t.attendanceDays.workDate, from, to));
  const open = await db.select().from(t.timeSegments).where(isNull(t.timeSegments.endAt));
  const [policy] = await db.select().from(t.policies).limit(1);

  const rows: IdleRow[] = emps.map(({ e, d }) => {
    const st = stats.find((x) => x.employee_id === e.id);
    const seg = open.find((x) => x.employeeId === e.id);
    const idleNow = seg?.kind === "unallocated";
    return {
      employeeId: e.id, name: `${e.firstName} ${e.lastName}`, first: e.firstName, last: e.lastName, trade: e.trade, dept: d?.name ?? null, colour: e.colour,
      state: seg ? seg.kind : "off", idleSince: idleNow ? seg!.startAt.getTime() : null, idleNowS: idleNow ? Math.round((now - seg!.startAt.getTime()) / 1000) : 0,
      idleS: Number(st?.idle_s ?? 0), stretches: Number(st?.stretches ?? 0), longestS: Number(st?.longest_s ?? 0),
      lastIdleAt: st?.last_at ? new Date(st.last_at).getTime() : null,
      availableS: avail.filter((a) => a.employeeId === e.id).reduce((a, x) => a + x.s, 0),
    };
  });
  void and;
  return { rows, now, idleAlertMin: policy.idleAlertMin };
}
