import { sweep } from "@/server/sweep";

/**
 * Runs the background rules once (auto clock-off, idle alerts, over-standard alerts).
 * Call every minute from a scheduler. Protect with CRON_SECRET when set.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorised" }, { status: 401 });
  return Response.json(await sweep(true));
}
export const GET = POST;
