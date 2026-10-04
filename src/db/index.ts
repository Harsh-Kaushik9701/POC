import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/shopfloor";

// Reuse one pool across hot reloads in dev.
const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
export const sqlClient = g.__sql ?? postgres(url, { max: 10, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") g.__sql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export type DB = typeof db;
export * as t from "./schema";
