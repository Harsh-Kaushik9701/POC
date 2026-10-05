/**
 * Seeds a realistic demo for Akaal Semi-Trailers, a trailer manufacturer in Rocklea, Brisbane.
 * The company name and address are Akaal's; every person, client, job and figure is made-up demo data.
 *
 * It generates ~10 working days of history plus "today" up to the demo clock (DEMO_NOW in .env),
 * by writing punch events exactly as kiosks would, then running the same engine the app uses.
 */
import "dotenv/config";
import { pinHash } from "../src/lib/pin";
import { sql as dsql } from "drizzle-orm";
import { db, sqlClient, t } from "../src/db";
import { appNow, localDate, localMinutes, localToUtc, isoWeekday, addDays, mondayOf } from "../src/lib/time";
import { uuidv7 } from "../src/lib/uuid";
import { recomputeDay } from "../src/server/recompute";
import { autoClockOffStale, sweep } from "../src/server/sweep";

function rng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261006);
const ri = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(R() * xs.length)];

async function main() {
  const existing = await db.select().from(t.organisation).limit(1);
  if (existing.length) {
    console.log("Database already seeded. Run `npm run db:reset` to start again.");
    await sqlClient.end();
    return;
  }

  const NOW = appNow();
  const TODAY = localDate(NOW);
  const NOW_MIN = localMinutes(NOW);
  console.log(`Demo clock: ${TODAY} ${String(Math.floor(NOW_MIN / 60)).padStart(2, "0")}:${String(NOW_MIN % 60).padStart(2, "0")} Brisbane`);

  /* ---------- Organisation, site, rules ---------- */
  await db.insert(t.organisation).values({
    name: "Akaal Semi-Trailers", tradingName: "Akaal Semi-Trailers", abn: null,
    address: "45 Suscatand Street, Rocklea QLD 4106", timezone: "Australia/Brisbane", currency: "AUD",
  });
  const [site] = await db.insert(t.sites).values({ name: "Rocklea Workshop", code: "ROC", address: "45 Suscatand Street, Rocklea QLD 4106", lat: "-27.5440", lng: "153.0060", geofenceRadiusM: 150 }).returning();
  const deptNames = ["Fabrication", "Paint & Finish", "Fit-out & Electrical", "Yard"];
  const depts = Object.fromEntries((await db.insert(t.departments).values(deptNames.map((name) => ({ siteId: site.id, name }))).returning()).map((d) => [d.name, d.id]));
  const [dayShift, appShift] = await db.insert(t.workPatterns).values([
    { name: "Day shift 7:00 am – 3:30 pm", startMin: 420, endMin: 930, days: [1, 2, 3, 4, 5], ordinaryMin: 480, graceMin: 5 },
    { name: "Apprentice 7:00 am – 3:30 pm (TAFE Wednesdays)", startMin: 420, endMin: 930, days: [1, 2, 4, 5], ordinaryMin: 480, graceMin: 5 },
  ]).returning();
  await db.insert(t.policies).values({});

  /* ---------- Codes and activities ---------- */
  const codeRows = await db.insert(t.timeCodes).values([
    { code: "SMOKO", name: "Smoko", category: "break", isPaid: true, maxMinutes: 10, sort: 1 },
    { code: "LUNCH", name: "Lunch", category: "break", isPaid: false, maxMinutes: 30, sort: 2 },
    { code: "CLEAN", name: "Workshop clean-up", category: "indirect", sort: 10 },
    { code: "MAINT", name: "Machine & tool maintenance", category: "indirect", sort: 11 },
    { code: "TOOLBOX", name: "Toolbox talk", category: "indirect", sort: 12 },
    { code: "WAIT-PARTS", name: "Waiting on parts", category: "waiting", requiresTask: true, sort: 20 },
    { code: "WAIT-DWG", name: "Waiting on drawings / approval", category: "waiting", requiresTask: true, sort: 21 },
    { code: "WAIT-MACH", name: "Machine or crane down", category: "waiting", sort: 22 },
    { code: "REWORK", name: "Rework / rectification", category: "rework", requiresTask: true, sort: 30 },
    { code: "TRAIN", name: "Training", category: "training", reducesAvailability: true, sort: 40 },
    { code: "TRAVEL", name: "Travel to customer site", category: "travel", sort: 41 },
    { code: "PERSONAL", name: "Personal time (unpaid)", category: "personal", isPaid: false, countsAsIdle: true, sort: 50 },
  ]).returning();
  const C = Object.fromEntries(codeRows.map((c) => [c.code, c.id]));
  const actRows = await db.insert(t.activityTypes).values([
    { code: "FAB", name: "Fabrication", colour: "#2e8752" }, { code: "WELD", name: "Welding", colour: "#c47f10" },
    { code: "PAINT", name: "Blasting & painting", colour: "#3a6ebd" }, { code: "FIT", name: "Fitting & assembly", colour: "#7a5cc2" },
    { code: "HYD", name: "Air, brakes & hydraulics", colour: "#0f8a8a" }, { code: "ELEC", name: "Auto electrical", colour: "#b8452e" },
    { code: "QC", name: "Inspection & QA", colour: "#5b6b7c" },
  ]).returning();
  const A = Object.fromEntries(actRows.map((a) => [a.code, a.id]));

  /* ---------- Clients and jobs ---------- */
  const clientRows = await db.insert(t.clients).values([
    { name: "Brisbane City Haulage", abn: null, contactName: "Craig Donnelly", phone: "07 3277 4410", email: "craig@bchaulage.example.com.au", suburb: "Rocklea QLD" },
    { name: "Darling Downs Grain Co", abn: null, contactName: "Bec Hartley", phone: "07 4632 8812", email: "fleet@ddgrain.example.com.au", suburb: "Toowoomba QLD" },
    { name: "Lockyer Valley Earthmoving", abn: null, contactName: "Shane Pirie", phone: "0428 551 902", email: "shane@lvearthmoving.example.com.au", suburb: "Gatton QLD" },
    { name: "Sunshine Coast Tippers", abn: null, contactName: "Narelle Brooks", phone: "07 5491 3307", email: "admin@sctippers.example.com.au", suburb: "Caloundra QLD" },
    { name: "Scenic Rim Livestock Transport", abn: null, contactName: "Matt Cuthbert", phone: "0409 117 664", email: "matt@srlt.example.com.au", suburb: "Beaudesert QLD" },
  ]).returning();
  const CL = Object.fromEntries(clientRows.map((c) => [c.name, c.id]));
  const day0 = addDays(TODAY, -16);

  type JobDef = { code: string; name: string; client?: string; type?: string; start: string; due: string; quote?: number; parent?: string; desc: string;
    tasks: [string, string, number, number?][] }; // name, activity, std minutes, bay?
  const jobs: JobDef[] = [
    { code: "J-24044", name: "Converter dolly build (tandem, PBS)", client: "Scenic Rim Livestock Transport", start: addDays(day0, -10), due: addDays(TODAY, -4), quote: 64_800_00,
      desc: "New tandem-axle converter dolly to drawing CD-2A rev C, PBS approved.",
      tasks: [["Cut & prep drawbar and frame", "FAB", 960], ["Weld frame, drawbar & turntable mount", "WELD", 1500], ["Fit axles & suspension", "FIT", 720], ["Blast & paint chassis", "PAINT", 900], ["Wire lights & EBS", "ELEC", 420], ["Final QA & handover", "QC", 180]] },
    { code: "J-24047", name: "Skel trailer chassis crack repair", client: "Darling Downs Grain Co", start: addDays(day0, -4), due: addDays(TODAY, -8), quote: 9_850_00,
      desc: "Repair cracked cross-members and re-certify.",
      tasks: [["Strip & inspect chassis", "FAB", 240], ["Weld repairs & gussets", "WELD", 600], ["Paint repaired areas", "PAINT", 240]] },
    { code: "J-24051", name: "Tri-axle curtainsider build (45 ft)", client: "Brisbane City Haulage", start: addDays(day0, 1), due: addDays(TODAY, 18), quote: 86_500_00,
      desc: "New 45 ft tri-axle curtainsider to drawing CS-45 rev B. Customer spec: 2 × sliding gates, alloy deck.",
      tasks: [["Cut & prep chassis rails", "FAB", 1500], ["Weld chassis & cross-members", "WELD", 3600], ["Fabricate deck & bulkheads", "FAB", 4800], ["Weld deck & gates", "WELD", 3600], ["Fit air suspension & axles", "HYD", 900], ["Abrasive blast & prime", "PAINT", 1500], ["Top coat", "PAINT", 1200], ["Wire lights & EBS", "ELEC", 720], ["Final QA & roadworthy check", "QC", 240]] },
    { code: "J-24051-H", name: "Curtain & gantry kit for J-24051", client: "Brisbane City Haulage", parent: "J-24051", start: addDays(day0, 4), due: addDays(TODAY, 10),
      desc: "Sub-job: gantry, curtain rails, curtains and buckles for the curtainsider.",
      tasks: [["Assemble gantry & curtain rails", "HYD", 360], ["Fit curtains & buckles", "HYD", 300]] },
    { code: "J-24055", name: "Curtainsider body repair", client: "Darling Downs Grain Co", start: addDays(day0, 3), due: addDays(TODAY, 3), quote: 14_200_00,
      desc: "Accident repair, nearside. Insurance job.",
      tasks: [["Strip damaged panels", "FAB", 300], ["Replace side gates", "WELD", 540], ["Repair floor bearers", "WELD", 600], ["Re-spray nearside", "PAINT", 480], ["New curtains & fit-up", "FIT", 360]] },
    { code: "J-24058", name: "Flat top headboard & toolboxes", client: "Lockyer Valley Earthmoving", start: addDays(day0, 6), due: addDays(TODAY, 7), quote: 11_900_00,
      desc: "Aluminium headboard, 2 × underbody toolboxes, LED beacons.",
      tasks: [["Fabricate headboard", "FAB", 960], ["Fabricate toolboxes (×2)", "FAB", 900], ["Weld & mount", "WELD", 720], ["Powder coat prep", "PAINT", 420], ["Fit lights & beacons", "ELEC", 420]] },
    { code: "J-24060", name: "Low loader ramp rebuild", client: "Sunshine Coast Tippers", start: addDays(day0, 9), due: addDays(TODAY, 12), quote: 8_400_00,
      desc: "Replace both ramps with heavier section, new springs and pins.",
      tasks: [["Remove old ramps", "FAB", 300], ["Fabricate new ramps", "WELD", 1500], ["Fit springs & pins", "FIT", 480], ["Paint ramps", "PAINT", 540]] },
    { code: "J-24049", name: "Flat top refurbishment (45 ft)", client: "Scenic Rim Livestock Transport", start: addDays(day0, -2), due: addDays(TODAY, 9), quote: 27_600_00,
      desc: "Strip and refurbish a 45 ft flat top: deck, air suspension, brake lines and lighting.",
      tasks: [["Strip down & inspect", "FIT", 900], ["Rebuild air suspension", "HYD", 1800], ["Replace air & brake lines", "HYD", 1500], ["Rewire lights & EBS", "ELEC", 1440], ["Re-deck & reassemble", "FIT", 1200], ["Blast & repaint crane boom", "PAINT", 1200]] },
    { code: "J-24053", name: "Skel trailer pair (20 ft + 40 ft)", client: "Lockyer Valley Earthmoving", start: addDays(day0, 2), due: addDays(TODAY, 11), quote: 21_400_00,
      desc: "Two container skel trailers on stock frames: running gear, twist locks, air and lighting.",
      tasks: [["Assemble running gear", "FIT", 900], ["Fit twist locks & landing legs", "FIT", 1500], ["Fit air & brake system", "HYD", 960], ["Wire lights & EBS", "ELEC", 1320], ["Paint & decal", "PAINT", 600], ["Pre-delivery check", "QC", 180]] },
    { code: "J-24057", name: "Fleet trailer inspections (×6)", client: "Brisbane City Haulage", start: addDays(day0, 5), due: addDays(TODAY, 6), quote: 7_800_00,
      desc: "Pre-rego inspections and minor repairs on six fleet trailers.",
      tasks: [["Brake & suspension checks", "FIT", 1080], ["Lighting & EBS checks", "ELEC", 720], ["Minor weld repairs", "WELD", 900], ["Touch-up paint after repairs", "PAINT", 720], ["Inspection reports", "QC", 240]] },
    { code: "INT-001", name: "Workshop maintenance", type: "internal", start: addDays(day0, -30), due: addDays(TODAY, 60),
      desc: "Internal: equipment and workshop improvements (not billable).",
      tasks: [["Service MIG welders", "FIT", 240], ["Install pallet racking", "FAB", 360]] },
    { code: "J-24062", name: "B-double skel trailer modifications", client: "Brisbane City Haulage", start: TODAY, due: addDays(TODAY, 14), quote: 18_300_00,
      desc: "Add twist locks and extend landing legs. Starts today.",
      tasks: [["Cut out old twist lock mounts", "FAB", 240], ["Weld new twist lock mounts", "WELD", 480], ["Extend landing legs", "FAB", 300], ["Paint & decal", "PAINT", 240]] },
    { code: "J-24063", name: "Converter dollies × 2 (PBS)", client: "Lockyer Valley Earthmoving", type: "customer", start: addDays(TODAY, 3), due: addDays(TODAY, 20), quote: 6_200_00,
      desc: "Quoted, materials on order.",
      tasks: [["Cut & prep frames", "FAB", 420], ["Weld frames & drawbars", "WELD", 360]] },
  ];

  const projectIds: Record<string, string> = {};
  type TaskRec = { id: string; code: string; projectCode: string; act: string; std: number; remaining: number; seq: number; start: string; done: boolean; deps: string[] };
  const allTasks: TaskRec[] = [];
  for (const j of jobs) {
    const [p] = await db.insert(t.projects).values({
      code: j.code, name: j.name, description: j.desc, clientId: j.client ? CL[j.client] : null, parentProjectId: j.parent ? projectIds[j.parent] : null,
      type: j.type ?? "customer", status: j.start > TODAY ? "quoted" : "active", startDate: j.start, dueDate: j.due,
      budgetMinutes: Math.round(j.tasks.reduce((a, x) => a + x[2], 0) * 1.1), quoteCents: j.quote ?? null, siteId: site.id,
    }).returning();
    projectIds[j.code] = p.id;
    await db.insert(t.projectActivityTypes).values([...new Set(j.tasks.map((x) => A[x[1]]))].map((a) => ({ projectId: p.id, activityTypeId: a })));
    let seq = 0;
    for (const [name, act, std] of j.tasks) {
      seq++;
      const code = `${j.code}-${String(seq).padStart(2, "0")}`;
      const [tk] = await db.insert(t.tasks).values({
        projectId: p.id, code, name, activityTypeId: A[act], standardMinutes: std, sequence: seq,
        status: j.start > TODAY ? "todo" : "ready", priority: j.code === "J-24055" ? 1 : 2,
        bay: act === "PAINT" ? "Paint booth" : act === "WELD" ? `Bay ${ri(1, 4)}` : act === "ELEC" || act === "HYD" ? "Fit-out bay" : `Bay ${ri(1, 4)}`,
        dueDate: j.due,
      }).returning();
      const prev = allTasks.filter((x) => x.projectCode === j.code);
      // Sequential dependencies for builds: welding follows its fabrication step, paint follows welding, etc.
      const deps = seq > 1 && j.code !== "INT-001" ? [prev[prev.length - 1].id] : [];
      allTasks.push({ id: tk.id, code, projectCode: j.code, act, std, remaining: std, seq, start: j.start, done: false, deps });
      for (const d of deps) await db.insert(t.taskDependencies).values({ taskId: tk.id, dependsOnTaskId: d });
    }
  }
  await db.insert(t.projectLinks).values([
    { fromProjectId: projectIds["J-24058"], toProjectId: projectIds["J-24051"], linkType: "related" },
    { fromProjectId: projectIds["J-24062"], toProjectId: projectIds["J-24051"], linkType: "related" },
    { fromProjectId: projectIds["J-24063"], toProjectId: projectIds["J-24058"], linkType: "depends_on" },
  ]);

  /* ---------- People ---------- */
  type P = { first: string; last: string; trade: string; type: string; dept: string; pay: number; skills: string[]; idle: number; eff: number; code: number; colour: string; apprentice?: boolean };
  const people: P[] = [
    { first: "Jack", last: "Thompson", trade: "Boilermaker", type: "full_time", dept: "Fabrication", pay: 42.5, skills: ["FAB", "WELD"], idle: 1.3, eff: 1.0, code: 1, colour: "#2e6f9e" },
    { first: "Liam", last: "O'Connor", trade: "Welder (coded)", type: "full_time", dept: "Fabrication", pay: 44.0, skills: ["WELD"], idle: 0.7, eff: 1.08, code: 2, colour: "#9e5a2e" },
    { first: "Mia", last: "Nguyen", trade: "Spray painter", type: "full_time", dept: "Paint & Finish", pay: 39.0, skills: ["PAINT"], idle: 1.2, eff: 0.97, code: 3, colour: "#7a3e9e" },
    { first: "Chloe", last: "Wilson", trade: "Diesel fitter", type: "full_time", dept: "Fit-out & Electrical", pay: 43.0, skills: ["HYD", "FIT"], idle: 1.3, eff: 1.02, code: 4, colour: "#2e9e7a" },
    { first: "Ethan", last: "Kelly", trade: "Apprentice boilermaker (2nd year)", type: "apprentice", dept: "Fabrication", pay: 21.5, skills: ["FAB", "WELD", "FIT"], idle: 1.8, eff: 0.78, code: 5, colour: "#9e2e5a", apprentice: true },
    { first: "Ben", last: "Walker", trade: "Leading hand, fabrication", type: "full_time", dept: "Fabrication", pay: 47.0, skills: ["FAB", "WELD", "QC"], idle: 1.35, eff: 1.05, code: 6, colour: "#4a5a6e" },
    { first: "Sophie", last: "Mitchell", trade: "Auto electrician", type: "full_time", dept: "Fit-out & Electrical", pay: 43.5, skills: ["ELEC"], idle: 0.9, eff: 1.0, code: 7, colour: "#b8862e" },
    { first: "Josh", last: "Taylor", trade: "Boilermaker", type: "full_time", dept: "Fabrication", pay: 41.0, skills: ["FAB", "WELD"], idle: 1.45, eff: 0.94, code: 8, colour: "#2e8a4a" },
    { first: "Ryan", last: "Murphy", trade: "Fitter & turner", type: "full_time", dept: "Fit-out & Electrical", pay: 42.0, skills: ["FIT", "HYD"], idle: 1.25, eff: 1.0, code: 9, colour: "#5a2e9e" },
    { first: "Kate", last: "Robinson", trade: "Blaster & painter", type: "full_time", dept: "Paint & Finish", pay: 38.5, skills: ["PAINT"], idle: 1.45, eff: 0.95, code: 10, colour: "#9e2e2e" },
    { first: "Daniel", last: "Papadopoulos", trade: "Welder", type: "full_time", dept: "Fabrication", pay: 41.5, skills: ["WELD", "FAB"], idle: 1.05, eff: 1.03, code: 11, colour: "#2e5a9e" },
    { first: "Tom", last: "Harris", trade: "Yard hand", type: "casual", dept: "Yard", pay: 33.0, skills: ["FIT", "PAINT"], idle: 1.9, eff: 0.9, code: 12, colour: "#6e6e2e" },
  ];
  const AWARD = "Manufacturing and Associated Industries and Occupations Award 2020";
  const emps: (P & { id: string; patternId: string })[] = [];
  for (const p of people) {
    const [e] = await db.insert(t.employees).values({
      code: `E${String(p.code).padStart(3, "0")}`, firstName: p.first, lastName: p.last, trade: p.trade, skills: p.skills, employmentType: p.type,
      siteId: site.id, departmentId: depts[p.dept], workPatternId: p.apprentice ? appShift.id : dayShift.id, award: AWARD,
      payRateCents: Math.round(p.pay * 100), costRateCents: Math.round(p.pay * (p.type === "casual" ? 1.25 : 1.38) * 100),
      pinHash: pinHash(String(1000 + p.code)), phone: `04${ri(10, 99)} ${ri(100, 999)} ${ri(100, 999)}`,
      email: `${p.first.toLowerCase()}.${p.last.toLowerCase().replace(/[^a-z]/g, "")}@akaal.example.com.au`,
      colour: p.colour, startDate: addDays(TODAY, -ri(120, 2400)),
    }).returning();
    emps.push({ ...p, id: e.id, patternId: e.workPatternId });
    const uid = Array.from({ length: 7 }, (_, i) => (i === 0 ? 0x04 : ri(0, 255)).toString(16).padStart(2, "0").toUpperCase()).join("");
    await db.insert(t.credentials).values({ employeeId: e.id, kind: "nfc_uid", value: uid, label: `Fob ${100 + p.code}` });
  }
  const ben = emps.find((e) => e.first === "Ben")!;
  for (const e of emps) if (e.id !== ben.id && e.dept === "Fabrication") await db.update(t.employees).set({ supervisorId: ben.id }).where(dsql`id = ${e.id}`);

  await db.insert(t.users).values([
    { name: "Sarah Collins", email: "sarah@akaal.example.com.au", role: "owner", title: "Owner (demo user)" },
    { name: "Mark Jensen", email: "mark@akaal.example.com.au", role: "manager", title: "Workshop Manager" },
    { name: "Ben Walker", email: "ben@akaal.example.com.au", role: "supervisor", title: "Leading Hand, Fabrication", employeeId: ben.id },
    { name: "Priya Raman", email: "priya@akaal.example.com.au", role: "payroll", title: "Payroll & Accounts" },
  ]);
  const mark = (await db.select().from(t.users).where(dsql`role = 'manager'`))[0];

  const bay3 = allTasks.find((x) => x.code === "J-24051-04")!;
  const booth = allTasks.find((x) => x.code === "J-24051-06")!;
  await db.insert(t.devices).values([
    { siteId: site.id, name: "Front gate kiosk", kind: "kiosk", token: "kiosk-front-gate-demo", appVersion: "0.1.0" },
    { siteId: site.id, name: "Bay 3 welding station", kind: "station", token: "station-bay3-demo", fixedTaskId: bay3.id, appVersion: "0.1.0" },
    { siteId: site.id, name: "Paint booth station", kind: "station", token: "station-paint-booth-demo", fixedTaskId: booth.id, appVersion: "0.1.0" },
    { siteId: site.id, name: "Ben's phone (supervisor)", kind: "supervisor", token: "supervisor-ben-demo", appVersion: "0.1.0" },
  ]);
  const [kiosk] = await db.select().from(t.devices).where(dsql`token = 'kiosk-front-gate-demo'`);

  /* ---------- Generate history ---------- */
  const days: string[] = [];
  for (let d = addDays(TODAY, -1); days.length < 10; d = addDays(d, -1)) if (isoWeekday(d) <= 5) days.unshift(d);
  const isWorkday = isoWeekday(TODAY) <= 5;
  if (isWorkday) days.push(TODAY);

  const events: (typeof t.punchEvents.$inferInsert)[] = [];
  const doneTasks = new Set<string>();
  const finishedBy = new Map<string, { at: number; emp: string }>();
  const workedOn = new Map<string, Set<string>>();
  const sickDays = new Set([`Ryan:${TODAY}`, `Josh:${days[3]}`, `Kate:${days[6]}`]);
  const forgotClockOff = `Tom:${days[7]}`;

  function available(e: P, day: string, current?: TaskRec) {
    if (current && !current.done) return current;
    const cand = allTasks.filter((x) => !x.done && x.start <= day && x.projectCode !== "J-24063" && x.projectCode !== "J-24062" && e.skills.includes(x.act)
      && x.deps.every((d) => { const y = allTasks.find((z) => z.id === d)!; return y.done || y.remaining < y.std * (x.act === "PAINT" || x.act === "ELEC" ? 0.8 : x.act === "WELD" ? 0.6 : 0.35); }));
    cand.sort((a, b) => (a.projectCode === "J-24055" ? -1 : 0) - (b.projectCode === "J-24055" ? -1 : 0) || a.start.localeCompare(b.start) || a.seq - b.seq);
    return cand[0];
  }

  for (const day of days) {
    const isToday = day === TODAY;
    const endLimit = isToday ? NOW_MIN : 2000;
    // Process workers in a rotating order so task allocation is fair.
    const order = [...emps].sort(() => R() - 0.5);
    for (const e of order) {
      if (e.apprentice && isoWeekday(day) === 3) continue; // TAFE
      if (sickDays.has(`${e.first}:${day}`)) continue;
      const evs: { m: number; type: string; task?: string; code?: string }[] = [];
      const push = (m: number, type: string, x: { task?: string; code?: string } = {}) => { if (m <= endLimit) evs.push({ m, type, ...x }); };
      let m = 420 - ri(4, 16) + (R() < 0.08 ? ri(8, 20) : 0);
      push(m, "CLOCK_IN");
      m += Math.round(R() * 6 * e.idle) + 1;
      if (isoWeekday(day) === 1) { m = Math.max(m, 422); push(m, "CODE_START", { code: "TOOLBOX" }); m += 15; push(m, "CODE_END"); m += ri(1, 6); }
      let smoko = false, lunch = false;
      let cur: TaskRec | undefined;
      let guard = 0;
      while (m < 925 && m <= endLimit && guard++ < 80) {
        const nextBreak = !smoko ? 540 + ri(-2, 3) : !lunch ? 720 + ri(-3, 5) : 9999;
        if (m >= nextBreak) {
          const code = !smoko ? "SMOKO" : "LUNCH";
          const len = code === "SMOKO" ? 10 + (R() < 0.18 * e.idle ? ri(3, 12) : 0) : 30 + (R() < 0.1 * e.idle ? ri(2, 10) : 0);
          push(m, "BREAK_START", { code }); m += len; push(m, "BREAK_END");
          if (code === "SMOKO") smoko = true; else lunch = true;
          // Many workers resume their job straight after; some drift.
          m += Math.round(R() * R() * 22 * e.idle);
          continue;
        }
        if (cur && !cur.done && cur.remaining <= 0.5) {
          // A crew-mate's work finished this task off; this worker closes it.
          push(m, "TASK_FINISH", { task: cur.id });
          if (m <= endLimit) cur.done = true;
          cur = undefined; m += ri(2, 12); continue;
        }
        cur = available(e, day, cur);
        if (!cur) {
          // Nothing suitable: a useful indirect code, or just standing around.
          if (R() < 0.55) { const code = pick(["CLEAN", "MAINT", "CLEAN"]); push(m, "CODE_START", { code }); const len = ri(20, 45); m = Math.min(m + len, nextBreak, 925); push(m, "CODE_END"); }
          m += ri(8, 25);
          continue;
        }
        push(m, "TASK_START", { task: cur.id });
        (workedOn.get(cur.id) ?? workedOn.set(cur.id, new Set()).get(cur.id)!).add(e.id);
        const actualToFinish = Math.ceil(cur.remaining / e.eff);
        const blockLen = Math.min(actualToFinish, ri(70, 170), nextBreak - m, 930 - m);
        if (blockLen <= 0) { m += 1; continue; }
        // Occasionally blocked waiting on parts or drawings mid-block.
        if (R() < 0.09 && blockLen > 40) {
          const half = Math.floor(blockLen / 2);
          m += half; cur.remaining -= half * e.eff;
          const wcode = pick(["WAIT-PARTS", "WAIT-DWG", "WAIT-PARTS"]);
          push(m, "TASK_PAUSE", { task: cur.id, code: wcode }); m += ri(15, 45);
          continue;
        }
        m += blockLen; cur.remaining -= blockLen * e.eff;
        // Untracked gaps between blocks (fetching material, chatting, phone) show up as idle.
        const gap = Math.min(Math.round(R() * R() * 60 * e.idle), nextBreak - m - 1, 925 - m);
        if (gap > 2 && cur.remaining > 0.5) { push(m, "TASK_PAUSE", { task: cur.id }); m += gap; }
        if (cur.remaining <= 0.5) {
          push(m, "TASK_FINISH", { task: cur.id });
          if (m <= endLimit) { cur.done = true; doneTasks.add(cur.id); finishedBy.set(cur.id, { at: localToUtc(day, m), emp: e.id }); }
          cur = undefined;
          m += Math.round(R() * 18 * e.idle) + 1;
        } else if (R() < 0.12) {
          m += 0; // carries on next loop with the same task
        }
        // Rework now and then
        if (R() < 0.03 && cur && nextBreak - m > 20) { push(m, "CODE_START", { code: "REWORK", task: cur.id }); m = Math.min(m + ri(15, 40), nextBreak - 1); push(m, "CODE_END"); }
      }
      if (!isToday && `${e.first}:${day}` !== forgotClockOff) push(930 + ri(-3, 14), "CLOCK_OUT");
      // Write out
      for (const x of evs) {
        const at = localToUtc(day, x.m) + ri(0, 50) * 1000;
        events.push({
          id: uuidv7(at), employeeId: e.id, type: x.type, occurredAt: new Date(at), receivedAt: new Date(at + 400), workDate: day,
          taskId: x.task ?? null, timeCodeId: x.code ? C[x.code] : null, deviceId: kiosk.id, method: R() < 0.03 ? "pin" : "nfc", source: "kiosk",
          flags: [],
        });
      }
    }
  }

  // Shape "today" so the floor board tells a story at the demo time.
  if (isWorkday && NOW_MIN > 470) {
    const tail = (first: string, minsAgo: number, type: string, code?: string) => {
      const e = emps.find((x) => x.first === first)!;
      const at = NOW - minsAgo * 60_000;
      // drop that worker's events after the cut, then add the tail event
      for (let i = events.length - 1; i >= 0; i--) if (events[i].employeeId === e.id && events[i].workDate === TODAY && events[i].occurredAt.getTime() >= at) events.splice(i, 1);
      const lastTask = [...events].reverse().find((x) => x.employeeId === e.id && x.workDate === TODAY && x.type === "TASK_START")?.taskId ?? null;
      events.push({ id: uuidv7(at), employeeId: e.id, type, occurredAt: new Date(at), receivedAt: new Date(at), workDate: TODAY,
        taskId: type === "TASK_PAUSE" ? lastTask : null, timeCodeId: code ? C[code] : null, deviceId: kiosk.id, method: "nfc", source: "kiosk", flags: [] });
    };
    tail("Ethan", 24, "TASK_PAUSE");          // idle, alert already fired
    tail("Tom", 19, "TASK_PAUSE");            // idle
    tail("Kate", 7, "TASK_PAUSE");            // just went idle
    tail("Chloe", 31, "TASK_PAUSE", "WAIT-PARTS"); // blocked on parts
    tail("Daniel", 12, "CODE_START", "MAINT");
  }
  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (let i = 0; i < events.length; i += 500) await db.insert(t.punchEvents).values(events.slice(i, i + 500));
  console.log(`Inserted ${events.length} punch events over ${days.length} days`);

  // Task statuses and assignments from what actually happened in the event log
  doneTasks.clear(); finishedBy.clear();
  for (const x of events) if (x.type === "TASK_FINISH" && x.taskId) { doneTasks.add(x.taskId); finishedBy.set(x.taskId, { at: x.occurredAt.getTime(), emp: x.employeeId }); }
  for (const tk of allTasks) {
    const workers = workedOn.get(tk.id);
    let status = tk.start > TODAY ? "todo" : "ready";
    if (doneTasks.has(tk.id)) status = "done"; else if (workers?.size) status = "in_progress";
    const fin = finishedBy.get(tk.id);
    await db.update(t.tasks).set({ status, completedAt: fin ? new Date(fin.at) : null, completedBy: fin?.emp ?? null }).where(dsql`id = ${tk.id}`);
    if (workers) for (const w of workers) await db.insert(t.taskAssignments).values({ taskId: tk.id, employeeId: w, assignedByUserId: mark.id, status: doneTasks.has(tk.id) ? "released" : "accepted", assignedAt: new Date(localToUtc(days[0], 400)) });
  }
  await db.execute(dsql`update tasks set status = 'blocked' where id in (select task_id from punch_events p where p.work_date = ${TODAY} and p.type = 'TASK_PAUSE' and p.time_code_id is not null)`);
  await db.execute(dsql`update projects set status = 'closed' where code in ('J-24044','J-24047') and not exists (select 1 from tasks t where t.project_id = projects.id and t.status <> 'done')`);
  // Two upcoming assignments so "My next tasks" isn't empty
  const nextUp = allTasks.filter((x) => x.projectCode === "J-24062").slice(0, 2);
  await db.insert(t.taskAssignments).values([
    { taskId: nextUp[0].id, employeeId: emps.find((x) => x.first === "Josh")!.id, assignedByUserId: mark.id, status: "assigned", note: "Start after current job" },
  ]);

  /* ---------- Build segments and totals ---------- */
  for (const day of days) {
    for (const e of emps) {
      await recomputeDay(e.id, day, { now: NOW });
      await autoClockOffStale(e.id, day === TODAY ? NOW : localToUtc(addDays(day, 1), 400));
    }
  }
  await sweep(true);

  // Last week approved by the workshop manager; this week still open.
  const thisMonday = mondayOf(TODAY);
  await db.execute(dsql`update attendance_days set status = 'approved', approved_by = ${mark.id}, approved_at = ${new Date(localToUtc(thisMonday, 480)).toISOString()}::timestamptz
    where work_date < ${thisMonday} and status = 'open'`);
  // Older alerts were dealt with.
  await db.execute(dsql`update alerts set ack_by = ${mark.id}, ack_at = opened_at + interval '20 minutes' where work_date < ${addDays(TODAY, -1)} and type <> 'auto_clock_off'`);
  await db.insert(t.auditLog).values({ actorUserId: null, action: "seed", entity: "database", detail: { days: days.length, events: events.length } });

  console.log("Seed complete. Log in at http://localhost:3000 and open the kiosk at /kiosk?device=kiosk-front-gate-demo");
  await sqlClient.end();
}

main().catch(async (e) => { console.error(e); await sqlClient.end(); process.exit(1); });
