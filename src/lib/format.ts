/** Display helpers. Durations are seconds. */
export function dur(s: number | null | undefined): string {
  if (s == null) return "–";
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h ${String(mm).padStart(2, "0")}m` : `${mm}m`;
}
/** Decimal hours, as payroll uses: 7.75 */
export function hrs(s: number | null | undefined, dp = 2): string {
  if (s == null) return "–";
  return (s / 3600).toFixed(dp);
}
export function pct(x: number | null | undefined, dp = 0): string {
  if (x == null || !isFinite(x)) return "–";
  return `${(x * 100).toFixed(dp)}%`;
}
export function money(cents: number | null | undefined): string {
  if (cents == null) return "–";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
}
export function initials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export const KIND_LABEL: Record<string, string> = {
  off: "Not clocked on",
  pre_shift: "Before shift",
  post_shift: "After shift",
  unallocated: "Idle",
  direct: "On a job",
  indirect: "Indirect",
  waiting: "Waiting",
  break_paid: "Smoko",
  break_unpaid: "Lunch",
};

export const EVENT_LABEL: Record<string, string> = {
  CLOCK_IN: "Clocked on",
  CLOCK_OUT: "Clocked off",
  AUTO_CLOCK_OUT: "Auto clocked off",
  TASK_START: "Started task",
  TASK_PAUSE: "Paused task",
  TASK_FINISH: "Finished task",
  CODE_START: "Started code",
  CODE_END: "Ended code",
  BREAK_START: "Started break",
  BREAK_END: "Back from break",
  VOID: "Undone",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin: "Admin", manager: "Workshop manager", supervisor: "Leading hand", payroll: "Payroll", viewer: "Viewer",
};
