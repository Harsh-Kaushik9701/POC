import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database connection.
 * - DATABASE_URL must be set in the hosting environment (Vercel: Project → Settings → Environment Variables).
 * - On serverless hosts every function instance opens its own pool, so keep it small there;
 *   Aiven's free plan allows only 15 connections in total.
 */
export const DATABASE_URL_SET = !!process.env.DATABASE_URL;
const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/shopfloor";
const serverless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const max = Number(process.env.DB_POOL_MAX ?? (serverless ? 2 : 10));

const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
export const sqlClient = g.__sql ?? postgres(url, {
  max,
  idle_timeout: serverless ? 20 : undefined,
  connect_timeout: 15,
  onnotice: () => {},
});
g.__sql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export type DB = typeof db;
export * as t from "./schema";
