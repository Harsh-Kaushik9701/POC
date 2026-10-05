"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Sidebar on desktop; on phones a compact top bar with a Menu button that opens the links. */
export function NavShell({ brand, alerts, children }: { brand: React.ReactNode; alerts: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  return (
    <nav className="nav" aria-label="Main" data-open={open ? "true" : "false"}>
      <div className="nav-top">
        {brand}
        <button className="nav-toggle" aria-expanded={open} aria-controls="nav-items" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}{!open && alerts ? <span className="badge">{alerts}</span> : null}
        </button>
      </div>
      <div className="nav-items" id="nav-items">{children}</div>
    </nav>
  );
}
