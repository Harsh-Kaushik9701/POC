"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

export type NavItem = { href: string; label: string; icon: string; badge?: number } | { group: string; collapsible?: boolean; items?: NavItem[] };

function NavLink({ it, path }: { it: Extract<NavItem, { href: string }>; path: string }) {
  const active = path === it.href || (it.href !== "/" && path.startsWith(it.href + "/"));
  return (
    <Link href={it.href} aria-current={active ? "page" : undefined}>
      <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Icon name={it.icon} />{it.label}</span>
      {it.badge ? <span className="badge">{it.badge}</span> : null}
    </Link>
  );
}

/** Side navigation. Groups of links; "Settings" folds away so day-to-day pages stay short. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((it, i) => {
        if ("href" in it) return <NavLink key={it.href} it={it} path={path} />;
        if (it.collapsible && it.items) {
          const open = it.items.some((x) => "href" in x && path.startsWith(x.href));
          return (
            <details key={i} className="navgroup" open={open}>
              <summary className="grp">{it.group}<Icon name="chevron" size={14} className="chev" /></summary>
              {it.items.map((x) => ("href" in x ? <NavLink key={x.href} it={x} path={path} /> : null))}
            </details>
          );
        }
        return <div key={i} className="grp">{it.group}</div>;
      })}
    </>
  );
}
