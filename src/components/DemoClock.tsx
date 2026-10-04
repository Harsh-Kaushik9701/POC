"use client";
import { useEffect, useState } from "react";

/** Shows the app's clock (which may be the demo clock), ticking in the browser. */
export function DemoClock({ serverNow, demo }: { serverNow: number; demo: boolean }) {
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(serverNow);
  useEffect(() => { const i = setInterval(() => setNow(Date.now() + offset), 15_000); return () => clearInterval(i); }, [offset]);
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return <span title={demo ? "Demo clock (DEMO_NOW in .env)" : "Brisbane time"}>{f.format(new Date(now))}{demo ? " · demo" : ""}</span>;
}
