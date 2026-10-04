import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { can } from "@/lib/permissions";

export default async function Home() {
  const u = await getUser();
  if (!u) redirect("/login");
  redirect(can(u.role, "floor.view") ? "/floor" : "/timesheets");
}
