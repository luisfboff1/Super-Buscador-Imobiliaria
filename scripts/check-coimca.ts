import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql as dsql } from "drizzle-orm";

const conn = neon(process.env.DATABASE_URL!);
const db = drizzle(conn);

const FONTE_ID = '28c615c0-02b9-477a-8f8e-62b520b8d0c5';

async function main() {
  const s = await db.execute(dsql`
    SELECT COUNT(*) as total, COUNT(quartos) as com_q, MAX(quartos) as max_q,
           COUNT(banheiros) as com_b, MAX(banheiros) as max_b,
           COUNT(vagas) as com_v, COUNT(bairro) as com_bairro, COUNT(tipo) as com_tipo
    FROM imoveis WHERE fonte_id = ${FONTE_ID}
  `);
  const st = s.rows[0] as any;
  const total = Number(st.total);
  console.log('=== Coimca Stats ===');
  console.log('Total:     ' + total);
  console.log('Quartos:   ' + st.com_q + '/' + total + ' (' + Math.round(Number(st.com_q)/total*100) + '%)  max=' + st.max_q);
  console.log('Banheiros: ' + st.com_b + '/' + total + ' (' + Math.round(Number(st.com_b)/total*100) + '%)  max=' + st.max_b);
  console.log('Vagas:     ' + st.com_v + '/' + total + ' (' + Math.round(Number(st.com_v)/total*100) + '%)');
  console.log('Bairro:    ' + st.com_bairro + '/' + total + ' (' + Math.round(Number(st.com_bairro)/total*100) + '%)');
  console.log('Tipo:      ' + st.com_tipo + '/' + total + ' (' + Math.round(Number(st.com_tipo)/total*100) + '%)');

  const samples = await db.execute(dsql`
    SELECT titulo, tipo, quartos, banheiros, vagas, bairro, cidade
    FROM imoveis WHERE fonte_id = ${FONTE_ID}
    ORDER BY quartos DESC NULLS LAST LIMIT 6
  `);
  console.log('\n=== Amostras ===');
  samples.rows.forEach((r: any) => {
    console.log(' ' + r.titulo?.substring(0, 40) + ' | q=' + r.quartos + ' b=' + r.banheiros + ' v=' + r.vagas + ' | ' + r.bairro + ', ' + r.cidade);
  });
}

main().catch(console.error);
