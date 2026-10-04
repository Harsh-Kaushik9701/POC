CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"colour" text DEFAULT '#2e8752' NOT NULL,
	CONSTRAINT "activity_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"employee_id" uuid,
	"task_id" uuid,
	"device_id" uuid,
	"work_date" date,
	"message" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"ack_by" uuid,
	"ack_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "alerts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"is_open" boolean DEFAULT false NOT NULL,
	"sched_start" timestamp with time zone,
	"sched_end" timestamp with time zone,
	"attendance_s" integer DEFAULT 0 NOT NULL,
	"pre_post_s" integer DEFAULT 0 NOT NULL,
	"break_paid_s" integer DEFAULT 0 NOT NULL,
	"break_unpaid_s" integer DEFAULT 0 NOT NULL,
	"reduced_s" integer DEFAULT 0 NOT NULL,
	"paid_s" integer DEFAULT 0 NOT NULL,
	"available_s" integer DEFAULT 0 NOT NULL,
	"direct_s" integer DEFAULT 0 NOT NULL,
	"indirect_s" integer DEFAULT 0 NOT NULL,
	"waiting_s" integer DEFAULT 0 NOT NULL,
	"unallocated_s" integer DEFAULT 0 NOT NULL,
	"overtime_s" integer DEFAULT 0 NOT NULL,
	"std_earned_s" integer DEFAULT 0 NOT NULL,
	"direct_done_s" integer DEFAULT 0 NOT NULL,
	"late_min" integer DEFAULT 0 NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"abn" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"suburb" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"action" text NOT NULL,
	"event_id" uuid,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"status" text DEFAULT 'applied' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"token" text NOT NULL,
	"fixed_task_id" uuid,
	"photo_required" boolean DEFAULT true NOT NULL,
	"pin_fallback" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"app_version" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"trade" text NOT NULL,
	"employment_type" text NOT NULL,
	"site_id" uuid NOT NULL,
	"department_id" uuid,
	"work_pattern_id" uuid NOT NULL,
	"supervisor_id" uuid,
	"award" text,
	"pay_rate_cents" integer NOT NULL,
	"cost_rate_cents" integer NOT NULL,
	"pin_hash" text,
	"phone" text,
	"email" text,
	"colour" text DEFAULT '#5b6b7c' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trading_name" text,
	"abn" text,
	"address" text,
	"timezone" text DEFAULT 'Australia/Brisbane' NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"week_start" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idle_alert_min" integer DEFAULT 15 NOT NULL,
	"auto_clock_off_after_end_min" integer DEFAULT 120 NOT NULL,
	"max_shift_min" integer DEFAULT 840 NOT NULL,
	"resume_after_break" boolean DEFAULT false NOT NULL,
	"task_over_standard_pct" integer DEFAULT 150 NOT NULL,
	"payroll_rounding_min" integer DEFAULT 15 NOT NULL,
	"lunch_auto_deduct" boolean DEFAULT true NOT NULL,
	"photo_required" boolean DEFAULT true NOT NULL,
	"undo_seconds" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_activity_types" (
	"project_id" uuid NOT NULL,
	"activity_type_id" uuid NOT NULL,
	CONSTRAINT "project_activity_types_project_id_activity_type_id_pk" PRIMARY KEY("project_id","activity_type_id")
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_project_id" uuid NOT NULL,
	"to_project_id" uuid NOT NULL,
	"link_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"parent_project_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'customer' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"due_date" date,
	"budget_minutes" integer,
	"quote_cents" integer,
	"site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "punch_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_time" timestamp with time zone,
	"work_date" date NOT NULL,
	"task_id" uuid,
	"time_code_id" uuid,
	"device_id" uuid,
	"credential_id" uuid,
	"method" text NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"supersedes_event_id" uuid,
	"was_offline" boolean DEFAULT false NOT NULL,
	"photo_key" text,
	"note" text,
	"flags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"timezone" text DEFAULT 'Australia/Brisbane' NOT NULL,
	"lat" text,
	"lng" text,
	"geofence_radius_m" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"activity_type_id" uuid,
	"standard_minutes" integer NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"priority" smallint DEFAULT 2 NOT NULL,
	"bay" text,
	"due_date" date,
	"sequence" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "time_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"reduces_availability" boolean DEFAULT false NOT NULL,
	"counts_as_idle" boolean DEFAULT false NOT NULL,
	"requires_task" boolean DEFAULT false NOT NULL,
	"max_minutes" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "time_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "time_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"task_id" uuid,
	"project_id" uuid,
	"activity_type_id" uuid,
	"time_code_id" uuid,
	"start_event_id" uuid,
	"end_event_id" uuid,
	"cost_rate_cents" integer,
	"flags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"title" text,
	"employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "work_patterns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"days" integer[] NOT NULL,
	"ordinary_min" integer NOT NULL,
	"grace_min" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_pattern_id_work_patterns_id_fk" FOREIGN KEY ("work_pattern_id") REFERENCES "public"."work_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_types" ADD CONSTRAINT "project_activity_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_types" ADD CONSTRAINT "project_activity_types_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_from_project_id_projects_id_fk" FOREIGN KEY ("from_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_to_project_id_projects_id_fk" FOREIGN KEY ("to_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_time_code_id_time_codes_id_fk" FOREIGN KEY ("time_code_id") REFERENCES "public"."time_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_segments" ADD CONSTRAINT "time_segments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_emp_date_uq" ON "attendance_days" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "credentials_value_idx" ON "credentials" USING btree ("value");--> statement-breakpoint
CREATE INDEX "punch_events_emp_time_idx" ON "punch_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "punch_events_emp_date_idx" ON "punch_events" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "time_segments_emp_date_idx" ON "time_segments" USING btree ("employee_id","work_date");