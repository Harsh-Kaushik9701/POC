import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getFloor } from "@/server/floor";
import { FloorBoard } from "./FloorBoard";

export const metadata = { title: "Floor board" };
export const dynamic = "force-dynamic";

export default async function FloorPage() {
  const u = await requireUser("floor.view");
  const data = await getFloor();
  return <FloorBoard initial={JSON.parse(JSON.stringify(data))} canAssign={can(u.role, "floor.assign")} />;
}
