import { readFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/uploads";
import { apiUser } from "@/lib/session";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const u = await apiUser("timesheets.view");
  if (u instanceof Response) return u;
  const { key } = await ctx.params;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(key)) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(path.join(UPLOAD_DIR, key));
    return new Response(buf, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
