import { apiUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { appNow, fmtTime, localDate } from "@/lib/time";
import { toCsv, csvResponse } from "@/lib/csv";
import { projectDetail } from "@/server/jobsheets";
import { audit } from "@/server/audit";

export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const u = await apiUser("jobsheets.view");
  if (u instanceof Response) return u;
  const d = await projectDetail((await ctx.params).projectId);
  if (!d) return new Response("Not found", { status: 404 });
  const cost = can(u.role, "costs.view");
  const now = appNow();
  const rows: (string | number | null)[][] = [["Job", "Task", "Task name", "Date", "Worker", "Staff no", "Type", "Start", "End", "Minutes", ...(cost ? ["Cost rate (AUD/h)", "Labour cost (AUD)"] : [])]];
  for (const { s, e, c } of d.segs) {
    const tk = d.tasks.find((x) => x.tk.id === s.taskId)?.tk;
    const mins = ((s.endAt?.getTime() ?? now) - s.startAt.getTime()) / 60000;
    rows.push([d.p.code, tk?.code ?? "", tk?.name ?? "", localDate(s.startAt.getTime()), `${e.firstName} ${e.lastName}`, e.code,
      s.kind === "direct" ? "Job time" : c?.name ?? s.kind, fmtTime(s.startAt), s.endAt ? fmtTime(s.endAt) : "running", mins.toFixed(1),
      ...(cost ? [((s.costRateCents ?? 0) / 100).toFixed(2), s.kind === "direct" ? (((s.costRateCents ?? 0) / 100) * (mins / 60)).toFixed(2) : ""] : [])]);
  }
  await audit(u.id, "export.jobsheet", "project", d.p.id);
  return csvResponse(`jobsheet-${d.p.code}.csv`, toCsv(rows));
}
