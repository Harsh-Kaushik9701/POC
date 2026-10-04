-- Rules the database itself enforces, beyond what the ORM schema can express.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- 1. A worker can never be in two places at once.
--    Each segment covers [start_at, end_at); a running segment (end_at IS NULL) covers [start_at, infinity).
ALTER TABLE time_segments
  ADD COLUMN period tstzrange
  GENERATED ALWAYS AS (tstzrange(start_at, COALESCE(end_at, 'infinity'::timestamptz), '[)')) STORED;
--> statement-breakpoint
ALTER TABLE time_segments
  ADD CONSTRAINT time_segments_no_overlap
  EXCLUDE USING gist (employee_id WITH =, period WITH &&);
--> statement-breakpoint

-- 2. At most one running segment per worker.
CREATE UNIQUE INDEX time_segments_one_open ON time_segments (employee_id) WHERE end_at IS NULL;
--> statement-breakpoint

-- 3. Only one active credential per tag value.
CREATE UNIQUE INDEX credentials_active_value_uq ON credentials (kind, value) WHERE revoked_at IS NULL;
--> statement-breakpoint

-- 4. The punch log is append-only: block UPDATE and DELETE.
CREATE OR REPLACE FUNCTION punch_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'punch_events is append-only; add a VOID or correction event instead';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER punch_events_no_update BEFORE UPDATE OR DELETE ON punch_events
  FOR EACH ROW WHEN (current_setting('app.allow_punch_purge', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION punch_events_append_only();
--> statement-breakpoint

-- 5. Approved or locked days cannot have their time rebuilt.
CREATE OR REPLACE FUNCTION segments_locked_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM attendance_days
    WHERE employee_id = COALESCE(NEW.employee_id, OLD.employee_id)
      AND work_date = COALESCE(NEW.work_date, OLD.work_date);
  IF st = 'locked' THEN
    RAISE EXCEPTION 'work date is locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER time_segments_locked BEFORE INSERT OR UPDATE OR DELETE ON time_segments
  FOR EACH ROW EXECUTE FUNCTION segments_locked_guard();
