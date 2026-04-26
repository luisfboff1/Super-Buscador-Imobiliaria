import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const client = await pool.connect();

try {
  const r = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'creci_import_jobs'
    ORDER BY ordinal_position;
  `);
  console.table(r.rows);

  const idx = await client.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'creci_import_jobs';
  `);
  console.log("Índices:", idx.rows);
} finally {
  client.release();
  await pool.end();
}
