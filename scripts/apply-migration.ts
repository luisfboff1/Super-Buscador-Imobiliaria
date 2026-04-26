import { Pool } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: tsx scripts/apply-migration.ts <arquivo.sql>");
    process.exit(1);
  }

  const sqlText = readFileSync(resolve(file), "utf8");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

  console.log(`Aplicando ${file}...`);
  const client = await pool.connect();
  try {
    await client.query(sqlText);
    console.log("✓ migration aplicada");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ Falhou:", err);
  process.exit(1);
});
