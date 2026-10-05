// Dev helper: prints a session cookie for a user email (used for automated checks).
import "dotenv/config";
import { createHmac } from "node:crypto";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const email = process.argv[2] ?? "mark@akaal.example.com.au";
const [u] = await sql`select id from users where email = ${email}`;
const sig = createHmac("sha256", process.env.SESSION_SECRET || "dev-secret").update(u.id).digest("base64url");
console.log(`sf_session=${u.id}.${sig}`);
await sql.end();
