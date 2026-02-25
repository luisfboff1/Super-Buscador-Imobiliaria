import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as publicSchema from "./schema/public";
import * as tenantSchema from "./schema/tenant";
import * as authSchema from "./schema/auth";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida no ambiente");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, {
  schema: { ...publicSchema, ...tenantSchema, ...authSchema },
});

export type DB = typeof db;

// Exporta schemas para uso em outras partes
export { publicSchema, tenantSchema, authSchema };
