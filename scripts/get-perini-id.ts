import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";

const conn = neon(process.env.DATABASE_URL!);
const db = drizzle(conn);

const r = await db.execute(sql`SELECT id, nome, url FROM fontes WHERE nome ILIKE '%perini%'`);
console.log(r.rows[0]);
