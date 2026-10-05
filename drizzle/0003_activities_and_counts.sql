ALTER TABLE "attendance_days" ADD COLUMN "break_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "finished_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "start_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "punch_events" ADD COLUMN "activity_type_id" uuid;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;