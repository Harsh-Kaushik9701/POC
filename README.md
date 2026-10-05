# Akaal Management — proof of concept

A working starter codebase for workshop time tracking, modelled on TimeDock but built to answer the question TimeDock can't: **of the time between clock-on and clock-off, how much was spent on jobs and how much was idle?**

It is branded for **Akaal Semi-Trailers** (Rocklea QLD) and ships with demo data: the people, clients, jobs and times are all made up. There are 12 staff, 13 jobs, and two weeks of history plus "today" running live.

Everything here is real code running on a real database. The kiosk, the floor board, timesheets, jobsheets, approvals, corrections, exports and setup all read and write PostgreSQL. Only the people, jobs and times are invented.

---

## Quick start

You need **Node 20+** and **PostgreSQL 16+**. Docker is the easiest way to get PostgreSQL.

```bash
cp .env.example .env          # check DATABASE_URL
docker compose up -d          # PostgreSQL 17 on localhost:5432 (skip if you have Postgres)
npm install
npm run db:reset              # create tables + load demo data
npm run dev                   # http://localhost:3000
```

Open two windows:

| Window | URL | What it is |
|---|---|---|
| Office | http://localhost:3000 | Pick a person to log in as |
| Kiosk | http://localhost:3000/kiosk?device=kiosk-front-gate-demo | The wall tablet workers tap |

Other kiosks are at `?device=station-bay3-demo` (a welding station) and `?device=station-paint-booth-demo`.

### The demo clock

`DEMO_NOW=2026-10-06 10:45` in `.env` makes the app start as if it's 10:45 am on a Tuesday in Brisbane. The clock then runs forward normally. This lets you demo a busy shift whatever the real time is, including from India.

The rules for the demo clock:

- Re-run `npm run db:reset` before a demo, so that "today" matches the clock.
- To use the real time instead, leave `DEMO_NOW` empty and reseed. If you seed on a weekend there will be no "today" activity.

### Demo logins

| Person | Role | Sees |
|---|---|---|
| Sarah Collins | Owner | Everything |
| Mark Jensen | Workshop manager | Floor board, timesheets (approve), jobsheets, reports, staff and jobs setup |
| Ben Walker | Leading hand | Floor board, timesheets (correct), jobsheets, jobs setup. No costs |
| Priya Raman | Payroll | Timesheets, jobsheets with costs, reports, payroll export, audit log |

Workers don't log in. On the kiosk, the dashed **Demo fobs** panel simulates tapping a fob.

- **PINs** are 1001–1012 for staff numbers E001–E012.
- **USB NFC reader:** one set to "keyboard mode" also works. It types the fob UID and presses Enter, and the kiosk listens for that.

---

## A 5-minute demo script

1. **Floor board** (log in as Mark). Ethan and Tom are at the top in red, idle for over 15 minutes, and their alerts have fired. Chloe is waiting on parts. Pick **J-24057-01** in the right panel and press **Assign** on Ethan.
2. **Kiosk.** Tap Ethan's fob. His assigned job is listed first. Start it. Back on the floor board (it refreshes every 5 s), Ethan moves to "On a job".
3. **Kiosk.** Tap Jack's fob and choose **Waiting on something → Waiting on parts**. Then tap Kate's fob and choose **Smoko**. Watch both move on the floor board.
4. **Timesheets.** Click any day cell to open the worker's day:
   - a colour timeline, with red pins at each idle alert;
   - every tap, with its device and method;
   - jobs worked, with labour cost.
   On a past day you can **Add a missed punch** or **Remove** a tap. Either one recalculates the day and asks for re-approval.
5. **Jobsheets → J-24051.** Shows tasks against standard time, who worked when, waiting time charged to the job, and labour cost against the quote.
6. **Reports.**
   - **Utilisation & idle** puts the painters at the bottom: they wait on welding upstream.
   - **Idle heatmap** shows the slow start after smoko and lunch.
7. **Payroll export** (log in as Priya). Downloads approved hours as a Xero / Employment Hero-style CSV, with rounding applied only in the export.

---

## How time is counted

This is the core of the product. The engine is in `src/lib/engine.ts` and its tests are in `src/lib/engine.test.ts`.

**At every minute, a clocked-on worker is in exactly one state:**

| State | Starts when | Counts as |
|---|---|---|
| On a job (direct) | Start task | Productive |
| Indirect | Code: clean-up, maintenance, toolbox talk, training, travel | Accounted for, not job time |
| Waiting | Code or pause: waiting on parts / drawings / machine. Linked to the job | Blocked; shows on the job's bottleneck report |
| Smoko / Lunch | Break start | Paid / unpaid break |
| **Idle (unallocated)** | Clock-on, finishing or pausing a task, ending a code or break | **Idle** |
| Before / after shift | Idle time outside the rostered shift | Not counted as idle or paid |

**Rules that make idle visible:**

- **Switching is one tap.** Starting a task ends whatever was running before.
- **Time is never carried forward.** Finishing or pausing without a reason makes the worker idle. In TimeDock, time keeps running on the last job scanned, so gaps never show.
- **Breaks have a limit.** Break time beyond the allowance (smoko 10 min) becomes idle and is flagged.
- **Lunch can be auto-deducted.** If no lunch is punched on a day over 5 h, the lunch break is deducted and the day is flagged.
- **Forgotten clock-offs close themselves.** The day is auto clocked off at shift end + 2 h (or after 14 h). It's set to "needs review" and a critical alert is raised.

**Formulas.** Every KPI tile shows its formula when you hover over it.

```
Available    = attendance − time outside shift − breaks − training
Idle         = available − on jobs − indirect − waiting
Utilisation  = on jobs ÷ available
Idle %       = idle ÷ available
Efficiency   = standard time of finished tasks ÷ time spent on them
Overtime     = paid − ordinary hours (8 h/day)
```

`npm test` runs 19 tests. They include the worked example from the requirements: 470 min available, 320 on jobs, 90 idle, 68.1 % utilisation.

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Web app + API | **Next.js 16** (App Router, server components, server actions, route handlers) | `/api/v1/*` is the versioned API the kiosk and future mobile app call |
| Database | **PostgreSQL** via **Drizzle ORM** | Migrations in `drizzle/` |
| Validation | zod | All API input |
| Time engine | Plain TypeScript, no dependencies | Same code can run on an offline device later |
| Tests | Vitest | `npm test` |

There is no UI framework. The CSS is hand-written with design tokens (`src/app/globals.css`) and supports light and dark mode.

### Why PostgreSQL rather than MongoDB

The database itself enforces the rules that matter most:

- **No overlapping time for one worker.** An exclusion constraint on a time range rejects it, even if a kiosk and a phone write at the same moment.
- **At most one running segment per worker.**
- **The punch log is append-only.** A trigger blocks UPDATE and DELETE.
- **Locked (exported) days can't be rebuilt.**

See `drizzle/0001_constraints.sql`. Reports are ordinary SQL joins across jobs, tasks, workers and time.

---

## Code layout

```
src/
  lib/engine.ts            the time engine (events → segments → daily totals)
  lib/engine.test.ts       golden tests
  lib/time.ts              Brisbane time helpers + demo clock
  lib/permissions.ts       role → action matrix
  db/schema.ts             all tables (Drizzle)
  server/punch.ts          record a tap: validate, append event, side effects, recompute
  server/recompute.ts      rebuild one worker-day from the punch log
  server/sweep.ts          background rules: auto clock-off, idle + over-standard alerts
  server/floor.ts          live floor board data
  server/jobsheets.ts      job summaries and detail
  server/payroll.ts        approved days → pay lines
  app/kiosk/               the tablet app (fob tap, PIN, task picker, codes, undo, offline queue, photo)
  app/(app)/floor          live floor board with assign / drag-and-drop
  app/(app)/timesheets     week grid → worker week → worker day (timeline, taps, corrections, approval)
  app/(app)/jobsheets      job list → job detail (tasks, who worked when, waiting, cost)
  app/(app)/reports        utilisation, idle heatmap, non-productive, waiting, estimate vs actual
  app/(app)/payroll        payroll CSV export and period lock
  app/(app)/setup          jobs & tasks, staff & fobs, devices, activities & codes, shifts & rules, clients
  app/api/v1/              device API (roster, punches, pin, photo, state), floor, exports, cron
drizzle/                   SQL migrations (0001 adds the constraints and triggers)
scripts/                   migrate, reset, seed, demo-cookie (dev helper)
```

## Data model

| Group | Tables |
|---|---|
| Organisation | organisation, sites, departments, work_patterns (shifts), policies (rules) |
| People | employees, users (office logins), credentials (NFC fobs, revocable), devices |
| Work | clients, projects (jobs; nest via parent_project_id), project_links, tasks, task_dependencies, task_assignments, activity_types, project_activity_types, time_codes |
| Time | **punch_events** (append-only source of truth) → **time_segments** (derived, no overlaps) → **attendance_days** (daily totals; timesheets read these) |
| Control | corrections, alerts, audit_log |

A jobsheet is not its own table. It's a query over time_segments, so it can never disagree with the timesheet.

### API used by the kiosk

All device calls send the `x-device-token` header. Devices are paired and revoked under Setup → Devices.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/device/roster` | Workers (fob → name), open tasks, codes, settings. Cached by the kiosk for offline use |
| GET | `/api/v1/device/state?employeeId=` | Current state and today's hours after a tap |
| POST | `/api/v1/device/punches` | One tap or a queued batch. Idempotent on the client-made UUIDv7 |
| POST | `/api/v1/device/pin` | PIN fallback |
| POST | `/api/v1/device/photo` | Punch photo (JPEG) |
| POST | `/api/v1/cron/sweep` | Run background rules (call every minute; set `CRON_SECRET`) |

**Offline taps** are queued on the tablet with the device time. When they sync, the server corrects for the device's clock offset and flags them for review.

---

## What's in the POC vs. production

| Area | In this POC | For production |
|---|---|---|
| Kiosk | Browser kiosk. Reads fobs via the demo panel or a USB keyboard-mode reader. Camera photo on every tap if the browser allows it. Offline queue | Expo (React Native) Android app reading fob chip IDs with the tablet's own NFC, in kiosk lock mode, managed by MDM |
| Login | Pick-a-user demo login (signed cookie) | Better Auth with email or mobile one-time codes; device binding |
| Background rules | Run when the floor board loads (at most every 20 s) or via `/api/v1/cron/sweep` | Queue worker (BullMQ) every minute; push / WhatsApp notifications |
| Live updates | Floor board polls every 5 s | Server-Sent Events |
| Photos | Saved to `./uploads` | S3-compatible storage with a retention period |
| Multi-company | Single organisation | tenant_id on every table + PostgreSQL row-level security |
| Payroll | Daily overtime at 1.5× and rounding | Award interpretation (Manufacturing Award: first 2 h at 1.5×, then 2×; weekends; apprentice rates), Xero / Employment Hero API |
| Rules versioning | One rules row | Dated versions so old days recalculate under the rules of the time |
| Not built yet | — | Worker phone app, rosters and leave, public holidays, eSSL/ZKTeco terminal push, BuildPlus / MechanicDesk integration, face match |

## Useful commands

```bash
npm run dev          # start in development
npm test             # engine tests
npm run typecheck    # TypeScript
npm run build        # production build
npm run db:reset     # drop everything, migrate, reseed (demo only!)
npm run db:generate  # after editing src/db/schema.ts, create a migration
```
