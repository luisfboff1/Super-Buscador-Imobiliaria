import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql as dsql } from "drizzle-orm";

const conn = neon(process.env.DATABASE_URL!);
const db = drizzle(conn);

async function main() {
  const fonteId = '3c27bfdf-8189-470b-9797-eac121aef0de';

  // Inspect remaining quartos==banheiros
  const r = await db.execute(dsql`
    SELECT quartos, banheiros, tipo, url_anuncio
    FROM imoveis
    WHERE fonte_id = ${fonteId} AND quartos IS NOT NULL AND banheiros IS NOT NULL AND quartos = banheiros
    ORDER BY quartos
  `);
  console.log(`=== quartos==banheiros (${(r.rows as any[]).length} records) ===`);
  (r.rows as any[]).forEach(x =>
    console.log(`  q=${x.quartos} b=${x.banheiros} tipo=${x.tipo}  ${String(x.url_anuncio).split('/').slice(-2).join('/')}`)
  );

  // Final stats
  const s = await db.execute(dsql`
    SELECT COUNT(*) as total, COUNT(quartos) as com_q, MAX(quartos) as max_q,
           COUNT(banheiros) as com_b, MAX(banheiros) as max_b
    FROM imoveis WHERE fonte_id = ${fonteId}
  `);
  console.log('\nStats:', JSON.stringify(s.rows[0]));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
