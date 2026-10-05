import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";

/** Open this URL after deploying to see whether the database is connected and set up. */
export async function GET() {
  const h = await checkHealth();
  return Response.json(h, { status: h.ok ? 200 : 503 });
}
