/**
 * Database schema (Drizzle ORM, PostgreSQL).
 *
 * Design rules (see README "Data model"):
 *  - punch_events is append-only: the app never UPDATEs or DELETEs it. Corrections add new events.
 *  - time_segments are derived from punch_events by the engine (src/lib/engine.ts) and rebuilt per worker per day.
 *    A database exclusion constraint (drizzle/0001_constraints.sql) stops two segments of one worker overlapping.
 *  - attendance_days caches every daily total. Timesheets and reports read from it.
 *  - All instants are timestamptz (UTC). work_date is the Brisbane-local date the shift belongs to.
 *
 * Single-organisation POC: multi-tenancy (tenant_id + row-level security) is a production step.
 */
import {
  pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, primaryKey, uniqueIndex, index, smallint,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "@/lib/uuid";

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ---------------- Organisation, people, access ---------------- */

export const organisation = pgTable("organisation", {
  id: id(),
  name: text("name").notNull(),
  tradingName: text("trading_name"),
  abn: text("abn"),
  address: text("address"),
  timezone: text("timezone").notNull().default("Australia/Brisbane"),
  currency: text("currency").notNull().default("AUD"),
  weekStart: smallint("week_start").notNull().default(1), // 1 = Monday
  createdAt: created(),
});

export const sites = pgTable("sites", {
  id: id(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  address: text("address"),
  timezone: text("timezone").notNull().default("Australia/Brisbane"),
  lat: text("lat"),
  lng: text("lng"),
  geofenceRadiusM: integer("geofence_radius_m"),
  createdAt: created(),
});

export const departments = pgTable("departments", {
  id: id(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  name: text("name").notNull(),
  createdAt: created(),
});

/** Expected shift. Minutes after local midnight. */
export const workPatterns = pgTable("work_patterns", {
  id: id(),
  name: text("name").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  days: integer("days").array().notNull(), // ISO weekday 1=Mon..7=Sun
  ordinaryMin: integer("ordinary_min").notNull(), // ordinary hours per day before overtime
  graceMin: integer("grace_min").notNull().default(5),
  createdAt: created(),
});

export const employees = pgTable("employees", {
  id: id(),
  code: text("code").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  trade: text("trade").notNull(),
  skills: text("skills").array().notNull().default([]), // activity type codes this worker usually does
  employmentType: text("employment_type").notNull(), // full_time | part_time | casual | apprentice
  siteId: uuid("site_id").notNull().references(() => sites.id),
  departmentId: uuid("department_id").references(() => departments.id),
  workPatternId: uuid("work_pattern_id").notNull().references(() => workPatterns.id),
  supervisorId: uuid("supervisor_id"),
  award: text("award"),
  payRateCents: integer("pay_rate_cents").notNull(), // per hour, AUD cents
  costRateCents: integer("cost_rate_cents").notNull(), // per hour incl. on-costs
  pinHash: text("pin_hash"),
  phone: text("phone"),
  email: text("email"),
  colour: text("colour").notNull().default("#5b6b7c"),
  active: boolean("active").notNull().default(true),
  startDate: date("start_date"),
  createdAt: created(),
});

/** Office users. A user may also be an employee (e.g. the leading hand). */
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(), // owner | admin | manager | supervisor | payroll | viewer
  title: text("title"),
  employeeId: uuid("employee_id").references(() => employees.id),
  createdAt: created(),
});

/** NFC tags, QR cards, PINs. Lost tags are revoked, never deleted. */
export const credentials = pgTable("credentials", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  kind: text("kind").notNull(), // nfc_uid | qr
  value: text("value").notNull(), // normalised, e.g. NFC UID as upper-case hex
  label: text("label"), // number printed on the fob
  issuedAt: ts("issued_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  revokeReason: text("revoke_reason"),
}, (t) => [index("credentials_value_idx").on(t.value)]);

export const devices = pgTable("devices", {
  id: id(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // kiosk | station | supervisor
  token: text("token").notNull().unique(),
  fixedTaskId: uuid("fixed_task_id"),
  photoRequired: boolean("photo_required").notNull().default(true),
  pinFallback: boolean("pin_fallback").notNull().default(true),
  lastSeenAt: ts("last_seen_at"),
  appVersion: text("app_version"),
  revokedAt: ts("revoked_at"),
  createdAt: created(),
});

/* ---------------- Work hierarchy ---------------- */

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull(),
  abn: text("abn"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  suburb: text("suburb"),
  createdAt: created(),
});

export const projects = pgTable("projects", {
  id: id(),
  clientId: uuid("client_id").references(() => clients.id),
  parentProjectId: uuid("parent_project_id"),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("customer"), // customer | internal | warranty
  status: text("status").notNull().default("active"), // quoted | active | on_hold | closed
  startDate: date("start_date"),
  dueDate: date("due_date"),
  budgetMinutes: integer("budget_minutes"),
  quoteCents: integer("quote_cents"),
  siteId: uuid("site_id").references(() => sites.id),
  createdAt: created(),
});

export const projectLinks = pgTable("project_links", {
  id: id(),
  fromProjectId: uuid("from_project_id").notNull().references(() => projects.id),
  toProjectId: uuid("to_project_id").notNull().references(() => projects.id),
  linkType: text("link_type").notNull(), // depends_on | related | supplies
});

/** TimeDock "Activities": labour types. Allowed on many projects. */
export const activityTypes = pgTable("activity_types", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  colour: text("colour").notNull().default("#2e8752"),
});

export const projectActivityTypes = pgTable("project_activity_types", {
  projectId: uuid("project_id").notNull().references(() => projects.id),
  activityTypeId: uuid("activity_type_id").notNull().references(() => activityTypes.id),
}, (t) => [primaryKey({ columns: [t.projectId, t.activityTypeId] })]);

export const tasks = pgTable("tasks", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  parentTaskId: uuid("parent_task_id"),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  activityTypeId: uuid("activity_type_id").references(() => activityTypes.id),
  standardMinutes: integer("standard_minutes").notNull(),
  status: text("status").notNull().default("ready"), // todo | ready | in_progress | paused | blocked | done
  priority: smallint("priority").notNull().default(2), // 1 high, 2 normal, 3 low
  bay: text("bay"),
  dueDate: date("due_date"),
  sequence: integer("sequence").notNull().default(0),
  completedAt: ts("completed_at"),
  completedBy: uuid("completed_by"),
  createdAt: created(),
});

export const taskDependencies = pgTable("task_dependencies", {
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  dependsOnTaskId: uuid("depends_on_task_id").notNull().references(() => tasks.id),
}, (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })]);

export const taskAssignments = pgTable("task_assignments", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  assignedByUserId: uuid("assigned_by_user_id"),
  assignedAt: ts("assigned_at").notNull().defaultNow(),
  status: text("status").notNull().default("assigned"), // assigned | accepted | released
  note: text("note"),
});

/**
 * Non-productive codes and breaks. The flags drive every KPI:
 *  category: indirect | waiting | rework | training | travel | personal | break
 */
export const timeCodes = pgTable("time_codes", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  isPaid: boolean("is_paid").notNull().default(true),
  reducesAvailability: boolean("reduces_availability").notNull().default(false),
  countsAsIdle: boolean("counts_as_idle").notNull().default(false),
  requiresTask: boolean("requires_task").notNull().default(false),
  maxMinutes: integer("max_minutes"), // breaks: allowance; overrun becomes idle
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/** Site rules. One row per organisation in this POC (versioning by effective date is a production step). */
export const policies = pgTable("policies", {
  id: id(),
  idleAlertMin: integer("idle_alert_min").notNull().default(15),
  autoClockOffAfterEndMin: integer("auto_clock_off_after_end_min").notNull().default(120),
  maxShiftMin: integer("max_shift_min").notNull().default(840),
  resumeAfterBreak: boolean("resume_after_break").notNull().default(false),
  taskOverStandardPct: integer("task_over_standard_pct").notNull().default(150),
  payrollRoundingMin: integer("payroll_rounding_min").notNull().default(15),
  lunchAutoDeduct: boolean("lunch_auto_deduct").notNull().default(true),
  photoRequired: boolean("photo_required").notNull().default(true),
  undoSeconds: integer("undo_seconds").notNull().default(60),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/* ---------------- Time capture ---------------- */

/** Append-only log. Never updated or deleted by the app. */
export const punchEvents = pgTable("punch_events", {
  id: uuid("id").primaryKey(), // client-generated UUIDv7 so offline retries are idempotent
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  type: text("type").notNull(),
  // CLOCK_IN | CLOCK_OUT | AUTO_CLOCK_OUT | TASK_START | TASK_PAUSE | TASK_FINISH
  // CODE_START | CODE_END | BREAK_START | BREAK_END | VOID
  occurredAt: ts("occurred_at").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  deviceTime: ts("device_time"),
  workDate: date("work_date").notNull(),
  taskId: uuid("task_id").references(() => tasks.id),
  activityTypeId: uuid("activity_type_id").references(() => activityTypes.id), // general activity with no job task
  timeCodeId: uuid("time_code_id").references(() => timeCodes.id),
  deviceId: uuid("device_id").references(() => devices.id),
  credentialId: uuid("credential_id"),
  method: text("method").notNull(), // nfc | qr | pin | manager | system
  source: text("source").notNull(), // kiosk | station | supervisor | web | system
  actorUserId: uuid("actor_user_id"),
  supersedesEventId: uuid("supersedes_event_id"),
  wasOffline: boolean("was_offline").notNull().default(false),
  photoKey: text("photo_key"),
  note: text("note"),
  flags: text("flags").array().notNull().default([]),
}, (t) => [
  index("punch_events_emp_time_idx").on(t.employeeId, t.occurredAt),
  index("punch_events_emp_date_idx").on(t.employeeId, t.workDate),
]);

/** Derived. Rebuilt per worker per work date. No overlaps (see 0001_constraints.sql). */
export const timeSegments = pgTable("time_segments", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  workDate: date("work_date").notNull(),
  kind: text("kind").notNull(),
  // pre_shift | post_shift | unallocated | direct | indirect | waiting | break_paid | break_unpaid
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at"), // null = running now
  taskId: uuid("task_id"),
  projectId: uuid("project_id"),
  activityTypeId: uuid("activity_type_id"),
  timeCodeId: uuid("time_code_id"),
  startEventId: uuid("start_event_id"),
  endEventId: uuid("end_event_id"),
  costRateCents: integer("cost_rate_cents"),
  flags: text("flags").array().notNull().default([]),
}, (t) => [index("time_segments_emp_date_idx").on(t.employeeId, t.workDate)]);

/** One row per worker per day: the heart of the timesheet. Seconds. */
export const attendanceDays = pgTable("attendance_days", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  workDate: date("work_date").notNull(),
  firstIn: ts("first_in"),
  lastOut: ts("last_out"),
  isOpen: boolean("is_open").notNull().default(false),
  schedStart: ts("sched_start"),
  schedEnd: ts("sched_end"),
  attendanceS: integer("attendance_s").notNull().default(0),
  prePostS: integer("pre_post_s").notNull().default(0),
  breakPaidS: integer("break_paid_s").notNull().default(0),
  breakUnpaidS: integer("break_unpaid_s").notNull().default(0),
  reducedS: integer("reduced_s").notNull().default(0),
  paidS: integer("paid_s").notNull().default(0),
  availableS: integer("available_s").notNull().default(0),
  directS: integer("direct_s").notNull().default(0),
  indirectS: integer("indirect_s").notNull().default(0),
  waitingS: integer("waiting_s").notNull().default(0),
  unallocatedS: integer("unallocated_s").notNull().default(0),
  overtimeS: integer("overtime_s").notNull().default(0),
  stdEarnedS: integer("std_earned_s").notNull().default(0),
  directDoneS: integer("direct_done_s").notNull().default(0),
  lateMin: integer("late_min").notNull().default(0),
  breakCount: integer("break_count").notNull().default(0),
  finishedCount: integer("finished_count").notNull().default(0),
  startCount: integer("start_count").notNull().default(0),
  exceptionCount: integer("exception_count").notNull().default(0),
  flags: text("flags").array().notNull().default([]),
  status: text("status").notNull().default("open"), // open | needs_review | approved | locked
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("attendance_days_emp_date_uq").on(t.employeeId, t.workDate)]);

export const corrections = pgTable("corrections", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  workDate: date("work_date").notNull(),
  action: text("action").notNull(), // add_event | void_event
  eventId: uuid("event_id"),
  reason: text("reason").notNull(),
  requestedBy: uuid("requested_by"),
  approvedBy: uuid("approved_by"),
  status: text("status").notNull().default("applied"),
  createdAt: created(),
});

/* ---------------- Operations ---------------- */

export const alerts = pgTable("alerts", {
  id: id(),
  type: text("type").notNull(),
  // idle_threshold | auto_clock_off | task_over_standard | offline_punch | pin_used | late_arrival | smoko_overrun
  severity: text("severity").notNull().default("warning"), // info | warning | critical
  employeeId: uuid("employee_id"),
  taskId: uuid("task_id"),
  deviceId: uuid("device_id"),
  workDate: date("work_date"),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  openedAt: ts("opened_at").notNull(),
  ackBy: uuid("ack_by"),
  ackAt: ts("ack_at"),
  resolvedAt: ts("resolved_at"),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  at: ts("at").notNull().defaultNow(),
});
