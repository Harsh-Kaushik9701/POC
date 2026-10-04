"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number } | { group: string };

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((it, i) =>
        "group" in it ? (
          <div key={i} className="grp">{it.group}</div>
        ) : (
          <Link key={it.href} href={it.href} aria-current={path === it.href || (it.href !== "/" && path.startsWith(it.href + "/")) ? "page" : undefined}>
            <span>{it.label}</span>
            {it.badge ? <span className="badge">{it.badge}</span> : null}
          </Link>
        ),
      )}
    </>
  );
}
