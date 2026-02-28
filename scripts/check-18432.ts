import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql as dsql } from "drizzle-orm";

const conn = neon(process.env.DATABASE_URL!);
const db = drizzle(conn);

const FONTE_ID = '3c27bfdf-8189-470b-9797-eac121aef0de';

async function main() {
  // Check property 18432
  const r1 = await db.execute(dsql`
    SELECT url_anuncio, titulo, tipo, quartos, banheiros, vagas, bairro, cidade
    FROM imoveis
    WHERE fonte_id = ${FONTE_ID} AND url_anuncio LIKE '%/18432'
  `);
  console.log('=== Imóvel 18432 ===');
  console.log(r1.rows[0] ?? 'NOT FOUND');

  // Stats
  const s = await db.execute(dsql`
    SELECT
      COUNT(*) as total,
      COUNT(quartos) as com_q,
      MAX(quartos) as max_q,
      COUNT(banheiros) as com_b,
      MAX(banheiros) as max_b,
      COUNT(vagas) as com_v,
      COUNT(bairro) as com_bairro,
      COUNT(tipo) as com_tipo
    FROM imoveis WHERE fonte_id = ${FONTE_ID}
  `);
  console.log('\n=== Stats ===');
  const st = s.rows[0] as any;
  const total = Number(st.total);
  console.log('Total:     ' + total);
  console.log('Quartos:   ' + st.com_q + '/' + total + ' (' + Math.round(Number(st.com_q)/total*100) + '%)  max=' + st.max_q);
  console.log('Banheiros: ' + st.com_b + '/' + total + ' (' + Math.round(Number(st.com_b)/total*100) + '%)  max=' + st.max_b);
  console.log('Vagas:     ' + st.com_v + '/' + total + ' (' + Math.round(Number(st.com_v)/total*100) + '%)');
  console.log('Bairro:    ' + st.com_bairro + '/' + total + ' (' + Math.round(Number(st.com_bairro)/total*100) + '%)');
  console.log('Tipo:      ' + st.com_tipo + '/' + total + ' (' + Math.round(Number(st.com_tipo)/total*100) + '%)');

  // Bairros suspeitos
  const badBairros = await db.execute(dsql`
    SELECT bairro, COUNT(*) as n FROM imoveis
    WHERE fonte_id = ${FONTE_ID} AND bairro IN ('Casa','CASA','Apartamento','APARTAMENTO','Terreno','TERRENO','Sobrado','SOBRADO')
    GROUP BY bairro ORDER BY n DESC
  `);
  if (badBairros.rows.length > 0) {
    console.log('\n=== Bairros suspeitos ===');
    badBairros.rows.forEach((r: any) => console.log('  "' + r.bairro + '": ' + r.n));
  } else {
    console.log('\n✅ Sem bairros tipo=nometipo (CASA/APARTAMENTO etc)');
  }

  // Top bairros
  const topBairros = await db.execute(dsql`
    SELECT bairro, COUNT(*) as n FROM imoveis
    WHERE fonte_id = ${FONTE_ID} AND bairro IS NOT NULL
    GROUP BY bairro ORDER BY n DESC LIMIT 10
  `);
  console.log('\n=== Top 10 bairros ===');
  topBairros.rows.forEach((r: any) => console.log('  ' + r.bairro + ': ' + r.n));
  // Check some sala-terrea / apto-mobiliado URLs
  const samples = await db.execute(dsql`
    SELECT url_anuncio, bairro, tipo FROM imoveis
    WHERE fonte_id = ${FONTE_ID} AND bairro IN ('SALA TERREA','APTO. MOBILIADO','PAVILHAO','SALA AEREA')
    LIMIT 6
  `);
  console.log('\n=== Samples bairros errados ===');
  samples.rows.forEach((r: any) => console.log('  bairro:', r.bairro, '| url:', r.url_anuncio));
}

main().catch(console.error);
