"use server";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { db, t } from "@/db";
import { requireUser } from "@/lib/session";
import { appNow } from "@/lib/time";
import { audit } from "@/server/audit";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => { const v = s(f, k); return v === "" ? null : Number(v); };
const back = (path: string, msg: string, err = false): never => redirect(`${path}?${err ? "err" : "ok"}=${encodeURIComponent(msg)}`);

/* ---------- Jobs and tasks ---------- */
export async function saveProject(f: FormData) {
  const u = await requireUser("setup.jobs");
  const id = s(f, "id");
  const values = {
    code: s(f, "code").toUpperCase(), name: s(f, "name"), description: s(f, "description") || null,
    clientId: s(f, "clientId") || null, parentProjectId: s(f, "parentProjectId") || null, type: s(f, "type") || "customer",
    status: s(f, "status") || "active", startDate: s(f, "startDate") || null, dueDate: s(f, "dueDate") || null,
    budgetMinutes: n(f, "budgetHours") != null ? Math.round(n(f, "budgetHours")! * 60) : null,
    quoteCents: n(f, "quote") != null ? Math.round(n(f, "quote")! * 100) : null,
  };
  if (!values.code || !values.name) back(id ? `/setup/jobs/${id}` : "/setup/jobs", "Job number and name are required", true);
  try {
    if (id) {
      await db.update(t.projects).set(values).where(eq(t.projects.id, id));
      await audit(u.id, "project.update", "project", id, values);
      revalidatePath(`/setup/jobs/${id}`);
      back(`/setup/jobs/${id}`, "Job saved");
    } else {
      const [site] = await db.select().from(t.sites).limit(1);
      const [p] = await db.insert(t.projects).values({ ...values, siteId: site.id }).returning();
      await audit(u.id, "project.create", "project", p.id, values);
      redirect(`/setup/jobs/${p.id}?ok=${encodeURIComponent("Job created. Add its tasks below.")}`);
    }
  } catch (e) {
    unstable_rethrow(e);
    back(id ? `/setup/jobs/${id}` : "/setup/jobs", `Couldn't save: ${(e as Error).message.includes("unique") ? "that job number is already used" : "check the fields"}`, true);
  }
}

export async function saveTask(f: FormData) {
  const u = await requireUser("setup.jobs");
  const projectId = s(f, "projectId"), id = s(f, "id");
  const path = `/setup/jobs/${projectId}`;
  const [p] = await db.select().from(t.projects).where(eq(t.projects.id, projectId));
  const values = {
    name: s(f, "name"), activityTypeId: s(f, "activityTypeId") || null, standardMinutes: Math.round((n(f, "stdHours") ?? 0) * 60),
    priority: n(f, "priority") ?? 2, bay: s(f, "bay") || null, status: s(f, "status") || "ready", description: s(f, "description") || null,
  };
  if (!values.name || values.standardMinutes <= 0) back(path, "Task name and standard hours are required", true);
  if (id) {
    await db.update(t.tasks).set(values).where(eq(t.tasks.id, id));
    await audit(u.id, "task.update", "task", id, values);
  } else {
    const existing = await db.select().from(t.tasks).where(eq(t.tasks.projectId, projectId));
    const seq = existing.length + 1;
    const [tk] = await db.insert(t.tasks).values({ ...values, projectId, code: `${p.code}-${String(seq).padStart(2, "0")}`, sequence: seq, dueDate: p.dueDate }).returning();
    const dep = s(f, "dependsOn");
    if (dep) await db.insert(t.taskDependencies).values({ taskId: tk.id, dependsOnTaskId: dep });
    if (values.activityTypeId) await db.insert(t.projectActivityTypes).values({ projectId, activityTypeId: values.activityTypeId }).onConflictDoNothing();
    await audit(u.id, "task.create", "task", tk.id, values);
  }
  revalidatePath(path);
  back(path, id ? "Task saved" : "Task added");
}

export async function assignTask(f: FormData) {
  const u = await requireUser("setup.jobs");
  const taskId = s(f, "taskId"), employeeId = s(f, "employeeId"), projectId = s(f, "projectId");
  if (taskId && employeeId) {
    await db.insert(t.taskAssignments).values({ taskId, employeeId, assignedByUserId: u.id, status: "assigned" });
    await audit(u.id, "task.assign", "task", taskId, { employeeId });
  }
  revalidatePath(`/setup/jobs/${projectId}`);
  back(`/setup/jobs/${projectId}`, "Assigned. It shows first on the kiosk for that worker.");
}

export async function linkProject(f: FormData) {
  const u = await requireUser("setup.jobs");
  const from = s(f, "projectId"), to = s(f, "toProjectId");
  if (from && to && from !== to) {
    await db.insert(t.projectLinks).values({ fromProjectId: from, toProjectId: to, linkType: s(f, "linkType") || "related" });
    await audit(u.id, "project.link", "project", from, { to });
  }
  back(`/setup/jobs/${from}`, "Jobs linked");
}

/* ---------- Clients ---------- */
export async function saveClient(f: FormData) {
  const u = await requireUser("setup.jobs");
  const values = { name: s(f, "name"), abn: s(f, "abn") || null, contactName: s(f, "contactName") || null, phone: s(f, "phone") || null, email: s(f, "email") || null, suburb: s(f, "suburb") || null };
  if (!values.name) back("/setup/clients", "Client name is required", true);
  const [c] = await db.insert(t.clients).values(values).returning();
  await audit(u.id, "client.create", "client", c.id, values);
  back("/setup/clients", "Client added");
}

/* ---------- Staff and fobs ---------- */
export async function saveEmployee(f: FormData) {
  const u = await requireUser("setup.people");
  const id = s(f, "id");
  const [site] = await db.select().from(t.sites).limit(1);
  const values = {
    code: s(f, "code").toUpperCase(), firstName: s(f, "firstName"), lastName: s(f, "lastName"), trade: s(f, "trade"),
    employmentType: s(f, "employmentType") || "full_time", departmentId: s(f, "departmentId") || null, workPatternId: s(f, "workPatternId"),
    payRateCents: Math.round((n(f, "payRate") ?? 0) * 100), costRateCents: Math.round((n(f, "costRate") ?? 0) * 100),
    phone: s(f, "phone") || null, email: s(f, "email") || null, award: s(f, "award") || null,
    skills: f.getAll("skills").map(String), active: s(f, "active") !== "no",
  };
  const path = id ? `/setup/staff/${id}` : "/setup/staff";
  if (!values.code || !values.firstName || !values.lastName || !values.workPatternId) back(path, "Staff number, name and shift are required", true);
  if (id) {
    await db.update(t.employees).set(values).where(eq(t.employees.id, id));
    await audit(u.id, "employee.update", "employee", id, { ...values, payRateCents: "…", costRateCents: "…" });
    revalidatePath(path);
    back(path, "Saved");
  } else {
    const [e] = await db.insert(t.employees).values({ ...values, siteId: site.id, colour: `hsl(${Math.floor(Math.random() * 360)} 45% 38%)` }).returning();
    await audit(u.id, "employee.create", "employee", e.id, { code: values.code });
    redirect(`/setup/staff/${e.id}?ok=${encodeURIComponent("Added. Now enrol their fob.")}`);
  }
}

export async function addFob(f: FormData) {
  const u = await requireUser("setup.people");
  const employeeId = s(f, "employeeId");
  const uid = s(f, "uid").replace(/[^0-9a-f]/gi, "").toUpperCase();
  const path = `/setup/staff/${employeeId}`;
  if (uid.length < 8) back(path, "That doesn't look like a fob ID. Tap the fob on a USB reader with this box selected.", true);
  const clash = await db.select().from(t.credentials).where(and(eq(t.credentials.value, uid), isNull(t.credentials.revokedAt)));
  if (clash.length) back(path, "That fob is already issued to someone. Revoke it there first.", true);
  await db.insert(t.credentials).values({ employeeId, kind: "nfc_uid", value: uid, label: s(f, "label") || null });
  await audit(u.id, "credential.issue", "employee", employeeId, { uid });
  revalidatePath(path);
  back(path, "Fob enrolled");
}

export async function revokeFob(f: FormData) {
  const u = await requireUser("setup.people");
  const employeeId = s(f, "employeeId"), id = s(f, "credentialId");
  await db.update(t.credentials).set({ revokedAt: new Date(appNow()), revokeReason: s(f, "reason") || "Lost" }).where(eq(t.credentials.id, id));
  await audit(u.id, "credential.revoke", "employee", employeeId, { credentialId: id });
  back(`/setup/staff/${employeeId}`, "Fob revoked. It no longer works on any device.");
}

export async function setPin(f: FormData) {
  const u = await requireUser("setup.people");
  const employeeId = s(f, "employeeId"), pin = s(f, "pin");
  if (!/^\d{4,6}$/.test(pin)) back(`/setup/staff/${employeeId}`, "PIN must be 4 to 6 digits", true);
  await db.update(t.employees).set({ pinHash: createHash("sha256").update(`ironbark:${pin}`).digest("hex") }).where(eq(t.employees.id, employeeId));
  await audit(u.id, "employee.set_pin", "employee", employeeId);
  back(`/setup/staff/${employeeId}`, "PIN updated");
}

/* ---------- Devices ---------- */
export async function createDevice(f: FormData) {
  const u = await requireUser("setup.system");
  const [site] = await db.select().from(t.sites).limit(1);
  const token = `dev-${randomBytes(9).toString("base64url")}`;
  const [d] = await db.insert(t.devices).values({ siteId: site.id, name: s(f, "name") || "New device", kind: s(f, "kind") || "kiosk", fixedTaskId: s(f, "fixedTaskId") || null, token }).returning();
  await audit(u.id, "device.create", "device", d.id, { name: d.name, kind: d.kind });
  back("/setup/devices", `Device created. Pairing code: ${token}`);
}

export async function updateDevice(f: FormData) {
  const u = await requireUser("setup.system");
  const id = s(f, "id");
  if (s(f, "revoke") === "1") {
    await db.update(t.devices).set({ revokedAt: new Date(appNow()) }).where(eq(t.devices.id, id));
    await audit(u.id, "device.revoke", "device", id);
    back("/setup/devices", "Device revoked. It can't record taps any more.");
  }
  await db.update(t.devices).set({ fixedTaskId: s(f, "fixedTaskId") || null, photoRequired: s(f, "photoRequired") === "on", pinFallback: s(f, "pinFallback") === "on" }).where(eq(t.devices.id, id));
  await audit(u.id, "device.update", "device", id);
  back("/setup/devices", "Device updated");
}

/* ---------- Activities, codes, rules ---------- */
export async function saveActivity(f: FormData) {
  const u = await requireUser("setup.system");
  await db.insert(t.activityTypes).values({ code: s(f, "code").toUpperCase(), name: s(f, "name"), colour: s(f, "colour") || "#5b6b7c" });
  await audit(u.id, "activity.create", "activity_type", null, { code: s(f, "code") });
  back("/setup/codes", "Activity added");
}

export async function saveCode(f: FormData) {
  const u = await requireUser("setup.system");
  const id = s(f, "id");
  const values = {
    code: s(f, "code").toUpperCase(), name: s(f, "name"), category: s(f, "category"),
    isPaid: s(f, "isPaid") === "on", reducesAvailability: s(f, "reducesAvailability") === "on", countsAsIdle: s(f, "countsAsIdle") === "on",
    requiresTask: s(f, "requiresTask") === "on", maxMinutes: n(f, "maxMinutes"), active: s(f, "active") === "on",
  };
  if (!values.code || !values.name) back("/setup/codes", "Code and name are required", true);
  if (id) await db.update(t.timeCodes).set(values).where(eq(t.timeCodes.id, id));
  else await db.insert(t.timeCodes).values({ ...values, sort: 60 });
  await audit(u.id, id ? "time_code.update" : "time_code.create", "time_code", id || null, values);
  back("/setup/codes", "Saved. New taps use this straight away.");
}

export async function savePolicy(f: FormData) {
  const u = await requireUser("setup.system");
  const [p] = await db.select().from(t.policies).limit(1);
  const values = {
    idleAlertMin: n(f, "idleAlertMin") ?? 15, autoClockOffAfterEndMin: n(f, "autoClockOffAfterEndMin") ?? 120, maxShiftMin: Math.round((n(f, "maxShiftHours") ?? 14) * 60),
    taskOverStandardPct: n(f, "taskOverStandardPct") ?? 150, payrollRoundingMin: n(f, "payrollRoundingMin") ?? 15, undoSeconds: n(f, "undoSeconds") ?? 60,
    resumeAfterBreak: s(f, "resumeAfterBreak") === "on", lunchAutoDeduct: s(f, "lunchAutoDeduct") === "on", photoRequired: s(f, "photoRequired") === "on",
    updatedAt: new Date(appNow()),
  };
  await db.update(t.policies).set(values).where(eq(t.policies.id, p.id));
  await audit(u.id, "policy.update", "policy", p.id, values);
  back("/setup/rules", "Rules saved. They apply to new taps and recalculations.");
}

export async function savePattern(f: FormData) {
  const u = await requireUser("setup.system");
  const hm = (v: string) => { const m = v.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  const id = s(f, "id");
  const start = hm(s(f, "start")), end = hm(s(f, "end"));
  if (start == null || end == null || end <= start) back("/setup/rules", "Start and finish must look like 07:00 and 15:30", true);
  const values = { name: s(f, "name"), startMin: start!, endMin: end!, ordinaryMin: Math.round((n(f, "ordinaryHours") ?? 8) * 60), graceMin: n(f, "graceMin") ?? 5, days: f.getAll("days").map(Number) };
  if (id) await db.update(t.workPatterns).set(values).where(eq(t.workPatterns.id, id));
  else await db.insert(t.workPatterns).values(values);
  await audit(u.id, id ? "work_pattern.update" : "work_pattern.create", "work_pattern", id || null, values);
  back("/setup/rules", "Shift saved");
}
