import "dotenv/config";
import postgres from "postgres";

// Drops everything in the public schema. Demo databases only.
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
console.log("Database reset");
await sql.end();
