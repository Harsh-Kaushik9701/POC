import { and, isNull, gte, sql, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { requireUser, clearSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { appNow, addDays, todayLocal } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/format";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { DemoClock } from "@/components/DemoClock";
import { BRAND } from "@/lib/brand";

async function logout() {
  "use server";
  await clearSession();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.alerts)
    .where(and(isNull(t.alerts.ackAt), ne(t.alerts.severity, "info"), gte(t.alerts.workDate, addDays(todayLocal(), -7))));
  const r = user.role;
  const items: NavItem[] = [{ group: "Today" }];
  if (can(r, "floor.view")) items.push({ href: "/floor", label: "Floor board" });
  if (can(r, "exceptions.view")) items.push({ href: "/exceptions", label: "Exceptions", badge: n });
  items.push({ group: "Time" });
  if (can(r, "timesheets.view")) items.push({ href: "/timesheets", label: "Timesheets" });
  if (can(r, "jobsheets.view")) items.push({ href: "/jobsheets", label: "Jobsheets" });
  if (can(r, "reports.view")) items.push({ href: "/reports", label: "Reports" });
  if (can(r, "payroll.export")) items.push({ href: "/payroll", label: "Payroll export" });
  if (can(r, "setup.jobs") || can(r, "setup.people")) {
    items.push({ group: "Setup" });
    if (can(r, "setup.jobs")) items.push({ href: "/setup/jobs", label: "Jobs & tasks" });
    if (can(r, "setup.people")) items.push({ href: "/setup/staff", label: "Staff & fobs" });
    if (can(r, "setup.system")) {
      items.push({ href: "/setup/devices", label: "Devices" });
      items.push({ href: "/setup/codes", label: "Activities & codes" });
      items.push({ href: "/setup/rules", label: "Shifts & rules" });
    }
    if (can(r, "setup.jobs")) items.push({ href: "/setup/clients", label: "Clients" });
  }
  if (can(r, "audit.view")) items.push({ href: "/audit", label: "Audit log" });

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand"><b><i>{BRAND.shortMark}</i>{BRAND.wordmark}<small>{BRAND.product}</small></b><span>{BRAND.company} · {BRAND.siteLabel}</span></div>
        <NavLinks items={items} />
        <div className="foot">
          <span className="mono"><DemoClock serverNow={appNow()} demo={!!process.env.DEMO_NOW} /></span>
          <span><b>{user.name}</b><br />{ROLE_LABEL[user.role] ?? user.role}</span>
          <a href="/kiosk?device=kiosk-front-gate-demo" target="_blank" style={{ padding: 0, color: "var(--tape)" }}>Open kiosk ↗</a>
          <form action={logout}><button>Switch user</button></form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
