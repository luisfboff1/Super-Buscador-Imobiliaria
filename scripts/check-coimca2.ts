import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql as dsql } from "drizzle-orm";

const conn = neon(process.env.DATABASE_URL!);
const db = drizzle(conn);
const FONTE_ID = "28c615c0-02b9-477a-8f8e-62b520b8d0c5";

async function main() {
  // Amostras completas
  const rows = await db.execute(dsql`
    SELECT titulo, bairro, tipo, quartos, banheiros, vagas, preco, url_anuncio, descricao
    FROM imoveis WHERE fonte_id = ${FONTE_ID}
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log("=== Amostras completas ===");
  for (const r of rows.rows as any[]) {
    console.log("---");
    console.log("Titulo:", r.titulo);
    console.log("Tipo:", r.tipo, "| Bairro:", r.bairro);
    console.log("Q:", r.quartos, "B:", r.banheiros, "V:", r.vagas, "P:", r.preco);
    console.log("URL:", r.url_anuncio);
    console.log("Desc(150):", String(r.descricao ?? "").substring(0, 150));
  }

  const tipos = await db.execute(dsql`
    SELECT tipo, count(*) as n FROM imoveis WHERE fonte_id = ${FONTE_ID} GROUP BY tipo ORDER BY n DESC
  `);
  console.log("\n=== Tipos ===");
  (tipos.rows as any[]).forEach(r => console.log(`  ${r.tipo ?? "NULL"}: ${r.n}`));

  const semQ = await db.execute(dsql`
    SELECT tipo, count(*) as n FROM imoveis WHERE fonte_id = ${FONTE_ID} AND quartos IS NULL GROUP BY tipo ORDER BY n DESC
  `);
  console.log("\n=== Sem quartos (por tipo) ===");
  (semQ.rows as any[]).forEach(r => console.log(`  ${r.tipo ?? "NULL"}: ${r.n}`));

  const casasSemQ = await db.execute(dsql`
    SELECT titulo, descricao, url_anuncio FROM imoveis
    WHERE fonte_id = ${FONTE_ID} AND quartos IS NULL AND tipo IN ('casa', 'apartamento', 'cobertura')
    LIMIT 5
  `);
  console.log("\n=== Casas/Aptos SEM quartos ===");
  for (const r of casasSemQ.rows as any[]) {
    console.log("---");
    console.log("Titulo:", r.titulo);
    console.log("URL:", r.url_anuncio);
    console.log("Desc:", String(r.descricao ?? "").substring(0, 300));
  }

  const semB = await db.execute(dsql`
    SELECT tipo, count(*) as n FROM imoveis WHERE fonte_id = ${FONTE_ID} AND banheiros IS NULL GROUP BY tipo ORDER BY n DESC
  `);
  console.log("\n=== Sem banheiros (por tipo) ===");
  (semB.rows as any[]).forEach(r => console.log(`  ${r.tipo ?? "NULL"}: ${r.n}`));
}

main().catch(console.error);
