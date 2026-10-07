"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { DemoClock } from "./DemoClock";

type Hit = { kind: "worker" | "job" | "task" | "page"; label: string; sub: string; href: string };

/** Shell bar: search everything (Ctrl/⌘ K), alerts, and the user menu — the same place on every page. */
export function TopBar({ user, role, alerts, serverNow, demo, logout }: {
  user: string; role: string; alerts: number; serverNow: number; demo: boolean; logout: () => Promise<void>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpen(true); }
      if (e.key === "Escape") { setOpen(false); setMenu(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const c = new AbortController();
    const tm = setTimeout(async () => {
      try {
        const r = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, { signal: c.signal });
        if (r.ok) { setHits((await r.json()).hits); setSel(0); }
      } catch { /* typing faster than the network */ }
    }, 150);
    return () => { clearTimeout(tm); c.abort(); };
  }, [q]);
  const go = (h: Hit) => { setOpen(false); setQ(""); router.push(h.href); };
  const KIND: Record<Hit["kind"], string> = { worker: "Worker", job: "Job", task: "Task", page: "Page" };

  return (
    <header className="topbar">
      <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
        <Icon name="search" size={16} />
        <input ref={input} value={q} placeholder="Search workers, jobs, tasks…" aria-label="Search" role="combobox" aria-expanded={open && hits.length > 0} aria-controls="search-results"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && hits[sel]) go(hits[sel]);
          }} />
        <kbd>Ctrl K</kbd>
        {open && q.trim().length >= 2 && (
          <ul className="results" id="search-results" role="listbox">
            {hits.length === 0 && <li className="none">No matches for &ldquo;{q}&rdquo;</li>}
            {hits.map((h, i) => (
              <li key={h.href + i} role="option" aria-selected={i === sel}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} className={i === sel ? "on" : ""}>
                  <span className="pill mute nocap">{KIND[h.kind]}</span><b>{h.label}</b><span className="muted small">{h.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="row tb-right">
        <span className="clockchip"><DemoClock serverNow={serverNow} demo={demo} /></span>
        <Link href="/exceptions" className="iconbtn" aria-label={`Alerts: ${alerts} need attention`} title="Alerts">
          <Icon name="bell" />{alerts > 0 && <span className="dotcount">{alerts > 99 ? "99+" : alerts}</span>}
        </Link>
        <div className="usermenu">
          <button className="userchip" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span className="avatar sm">{user.split(" ").map((x) => x[0]).join("")}</span>
            <span className="who"><b>{user}</b><small>{role}</small></span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <a href="/kiosk?device=kiosk-front-gate-demo" target="_blank" role="menuitem"><Icon name="kiosk" size={16} /> Open kiosk</a>
              <form action={logout}><button role="menuitem"><Icon name="logout" size={16} /> Switch user</button></form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
