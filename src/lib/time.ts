/**
 * Time helpers. Everything is stored in UTC; display and day boundaries use the organisation timezone
 * (Australia/Brisbane, UTC+10, no daylight saving — but the helpers work for any IANA zone).
 */
export const TZ = "Australia/Brisbane";
export const MIN = 60_000;

/** Offset (ms) of `tz` from UTC at instant `ms`. */
export function tzOffset(ms: number, tz = TZ): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = +x.value;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a local date ("2026-10-06") plus minutes after local midnight. */
export function localToUtc(dateStr: string, minutes: number, tz = TZ): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * MIN;
  const off1 = tzOffset(guess, tz);
  const off2 = tzOffset(guess - off1, tz);
  return guess - off2;
}

export function localDate(ms: number, tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Minutes after local midnight. */
export function localMinutes(ms: number, tz = TZ): number {
  const off = tzOffset(ms, tz);
  const local = ms + off;
  return Math.floor((((local % 86_400_000) + 86_400_000) % 86_400_000) / MIN);
}

export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function mondayOf(dateStr: string): string {
  return addDays(dateStr, 1 - isoWeekday(dateStr));
}

export function fmtTime(ms: number | Date | null | undefined, tz = TZ): string {
  if (ms == null) return "–";
  const v = typeof ms === "number" ? ms : ms.getTime();
  return new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(v));
}

/** "Tue 6 Oct" */
export function fmtDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Tuesday 6 October 2026" */
export function fmtDayLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function minToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/* ---------------- Demo clock ----------------
 * DEMO_NOW="2026-10-06 10:45" makes the app behave as if it is that Brisbane time, with the clock running forward.
 * The clock is anchored to the moment the demo data was loaded (stored by the seed script), so every server
 * instance agrees — important on serverless hosts like Vercel, where many instances start at different times.
 * Without an anchor (e.g. the seed script itself) it starts from when the process started.
 */
const g = globalThis as unknown as { __demoOffset?: number };
export function demoTarget(): number | null {
  const m = (process.env.DEMO_NOW ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  return m ? localToUtc(m[1], +m[2] * 60 + +m[3]) : null;
}
/** Anchor the demo clock: DEMO_NOW corresponds to the real instant `realMs`. */
export function setDemoAnchor(realMs: number) {
  const target = demoTarget();
  if (target !== null) g.__demoOffset = target - realMs;
}
function demoOffset(): number {
  if (g.__demoOffset !== undefined) return g.__demoOffset;
  const target = demoTarget();
  g.__demoOffset = target !== null ? target - Date.now() : 0;
  return g.__demoOffset;
}

/** The app's "now" in UTC ms. Always use this instead of Date.now() on the server. */
export function appNow(): number {
  return Date.now() + demoOffset();
}

export function todayLocal(): string {
  return localDate(appNow());
}
