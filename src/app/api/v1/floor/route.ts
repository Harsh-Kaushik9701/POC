import { apiUser } from "@/lib/session";
import { getFloor } from "@/server/floor";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await apiUser("floor.view");
  if (u instanceof Response) return u;
  return Response.json(await getFloor());
}
