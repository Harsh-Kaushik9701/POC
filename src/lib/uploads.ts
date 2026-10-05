import os from "node:os";
import path from "node:path";

/** Where punch photos are stored. Serverless hosts only allow writing to the temp folder (photos there are not kept). */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ?? (process.env.VERCEL ? path.join(os.tmpdir(), "uploads") : path.join(process.cwd(), "uploads"));
