import { and, isNull, gte, sql, ne, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { requireUser, clearSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { appNow, addDays, todayLocal } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/format";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { NavShell } from "@/components/NavShell";
import { TopBar } from "@/components/TopBar";
import { BRAND } from "@/lib/brand";

async function logout() {
  "use server";
  await clearSession();
  redirect("/login");
}

/**
 * App shell, following the common enterprise pattern (SAP Fiori launchpad, Dynamics 365, NetSuite):
 * a role-based side navigation, and a top bar with search, alerts and the user menu on every page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.alerts)
    .where(and(isNull(t.alerts.ackAt), ne(t.alerts.severity, "info"), gte(t.alerts.workDate, addDays(todayLocal(), -7))));
  const [{ idleNow }] = await db.select({ idleNow: sql<number>`count(*)::int` }).from(t.timeSegments)
    .where(and(isNull(t.timeSegments.endAt), eq(t.timeSegments.kind, "unallocated")));
  const r = user.role;

  const items: NavItem[] = [{ href: "/home", label: "Home", icon: "home" }];
  if (can(r, "floor.view")) {
    items.push({ group: "Live" });
    items.push({ href: "/floor", label: "Floor board", icon: "board" });
    items.push({ href: "/idle", label: "Idle workers", icon: "idle", badge: idleNow });
  }
  if (can(r, "exceptions.view")) items.push({ href: "/exceptions", label: "Exceptions", icon: "alert", badge: n });
  items.push({ group: "Time & jobs" });
  if (can(r, "timesheets.view")) items.push({ href: "/timesheets", label: "Timesheets", icon: "timesheet" });
  if (can(r, "jobsheets.view")) items.push({ href: "/jobsheets", label: "Jobsheets", icon: "jobsheet" });
  if (can(r, "reports.view")) items.push({ href: "/reports", label: "Reports", icon: "reports" });
  if (can(r, "payroll.export")) items.push({ href: "/payroll", label: "Payroll export", icon: "payroll" });
  const settings: NavItem[] = [];
  if (can(r, "setup.jobs")) settings.push({ href: "/setup/jobs", label: "Jobs & tasks", icon: "jobs" });
  if (can(r, "setup.people")) settings.push({ href: "/setup/staff", label: "Staff & fobs", icon: "staff" });
  if (can(r, "setup.jobs")) settings.push({ href: "/setup/clients", label: "Clients", icon: "clients" });
  if (can(r, "setup.system")) {
    settings.push({ href: "/setup/devices", label: "Devices", icon: "device" });
    settings.push({ href: "/setup/codes", label: "Activities & codes", icon: "codes" });
    settings.push({ href: "/setup/rules", label: "Shifts & rules", icon: "rules" });
  }
  if (can(r, "audit.view")) settings.push({ href: "/audit", label: "Audit log", icon: "audit" });
  if (settings.length) items.push({ group: "Settings", collapsible: true, items: settings });

  return (
    <div className="shell">
      <NavShell alerts={n} brand={<div className="brand"><b><i>{BRAND.shortMark}</i>{BRAND.wordmark}<small>{BRAND.product}</small></b><span>{BRAND.company} · {BRAND.siteLabel}</span></div>}>
        <NavLinks items={items} />
      </NavShell>
      <div className="workarea">
        <TopBar user={user.name} role={ROLE_LABEL[user.role] ?? user.role} alerts={n} serverNow={appNow()} demo={!!process.env.DEMO_NOW} logout={logout} />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
