import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deviceFromRequest, deviceError } from "@/server/device";
import { uuidv7 } from "@/lib/uuid";

/** Punch photo upload (JPEG). Stored on local disk in this POC; S3-compatible storage in production. */
export async function POST(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return deviceError();
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length < 100 || buf.length > 2_000_000 || buf[0] !== 0xff || buf[1] !== 0xd8) return Response.json({ error: "Expected a JPEG under 2 MB" }, { status: 400 });
  const key = `${uuidv7()}.jpg`;
  const dir = path.join(process.cwd(), "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), buf);
  return Response.json({ key });
}
