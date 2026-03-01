/**
 * check-all-fontes.ts
 * Relatório completo de qualidade de dados de todas as fontes.
 * Uso: doppler run -- npx tsx scripts/check-all-fontes.ts [--json]
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";

const conn = neon(process.env.DATABASE_URL!);
const db = drizzle(conn);

const JSON_MODE = process.argv.includes("--json");

interface FonteRow {
  id: string;
  nome: string;
  url: string;
  status: string;
  last_crawl: string | null;
  crawl_progress: any;
}

interface ImoveisStats {
  total: number;
  com_preco: number;
  com_quartos: number;
  com_banheiros: number;
  com_vagas: number;
  com_area: number;
  com_bairro: number;
  com_descricao: number;
  com_imagens: number;
  com_tipo: number;
  com_transacao: number;
  avg_preco: number | null;
  max_preco: number | null;
  min_preco: number | null;
  avg_quartos: number | null;
  max_quartos: number | null;
  avg_area: number | null;
  max_area: number | null;
  por_tipo: Record<string, number>;
  por_transacao: Record<string, number>;
  sem_quartos_residenciais: number; // casas/aptos sem quartos = problema
  preco_min_suspeito: number; // precos < 500 (provavelmente erros)
  preco_max_suspeito: number; // preços > 50M (provavelmente erros)
}

async function getImoveisStats(fonteId: string): Promise<ImoveisStats> {
  const res = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(preco)::int AS com_preco,
      COUNT(quartos)::int AS com_quartos,
      COUNT(banheiros)::int AS com_banheiros,
      COUNT(vagas)::int AS com_vagas,
      COUNT(area_m2)::int AS com_area,
      COUNT(bairro)::int AS com_bairro,
      COUNT(CASE WHEN descricao IS NOT NULL AND LENGTH(descricao) > 10 THEN 1 END)::int AS com_descricao,
      COUNT(CASE WHEN imagens IS NOT NULL AND array_length(imagens,1) > 0 THEN 1 END)::int AS com_imagens,
      COUNT(tipo)::int AS com_tipo,
      COUNT(transacao)::int AS com_transacao,
      ROUND(AVG(preco::numeric))::bigint AS avg_preco,
      MAX(preco::numeric)::bigint AS max_preco,
      MIN(preco::numeric)::bigint AS min_preco,
      ROUND(AVG(quartos::numeric), 1)::float AS avg_quartos,
      MAX(quartos)::int AS max_quartos,
      ROUND(AVG(area_m2::numeric), 1)::float AS avg_area,
      MAX(area_m2::numeric)::float AS max_area,
      COUNT(CASE WHEN tipo IN ('casa','apartamento','sobrado','cobertura','flat','kitnet') AND quartos IS NULL THEN 1 END)::int AS sem_quartos_residenciais,
      COUNT(CASE WHEN preco IS NOT NULL AND preco::numeric < 500 THEN 1 END)::int AS preco_min_suspeito,
      COUNT(CASE WHEN preco IS NOT NULL AND preco::numeric > 50000000 THEN 1 END)::int AS preco_max_suspeito
    FROM imoveis
    WHERE fonte_id = ${fonteId}
  `);

  const r = res.rows[0] as any;

  // tipos distribution
  const tipoRows = await db.execute(sql`
    SELECT tipo, COUNT(*)::int as cnt
    FROM imoveis
    WHERE fonte_id = ${fonteId} AND tipo IS NOT NULL
    GROUP BY tipo ORDER BY cnt DESC LIMIT 12
  `);
  const por_tipo: Record<string, number> = {};
  for (const t of tipoRows.rows as any[]) por_tipo[t.tipo] = t.cnt;

  // transacao distribution
  const transRows = await db.execute(sql`
    SELECT transacao, COUNT(*)::int as cnt
    FROM imoveis
    WHERE fonte_id = ${fonteId}
    GROUP BY transacao ORDER BY cnt DESC
  `);
  const por_transacao: Record<string, number> = {};
  for (const t of transRows.rows as any[]) por_transacao[t.transacao ?? 'NULL'] = t.cnt;

  return {
    total: r.total,
    com_preco: r.com_preco,
    com_quartos: r.com_quartos,
    com_banheiros: r.com_banheiros,
    com_vagas: r.com_vagas,
    com_area: r.com_area,
    com_bairro: r.com_bairro,
    com_descricao: r.com_descricao,
    com_imagens: r.com_imagens,
    com_tipo: r.com_tipo,
    com_transacao: r.com_transacao,
    avg_preco: r.avg_preco,
    max_preco: r.max_preco,
    min_preco: r.min_preco,
    avg_quartos: r.avg_quartos,
    max_quartos: r.max_quartos,
    avg_area: r.avg_area,
    max_area: r.max_area,
    por_tipo,
    por_transacao,
    sem_quartos_residenciais: r.sem_quartos_residenciais,
    preco_min_suspeito: r.preco_min_suspeito,
    preco_max_suspeito: r.preco_max_suspeito,
  };
}

async function getSamples(fonteId: string): Promise<any[]> {
  const rows = await db.execute(sql`
    SELECT titulo, tipo, transacao, preco, quartos, banheiros, vagas, area_m2, bairro, cidade,
           LENGTH(descricao) as desc_len,
           array_length(imagens, 1) as n_imagens
    FROM imoveis
    WHERE fonte_id = ${fonteId}
    ORDER BY RANDOM() LIMIT 5
  `);
  return rows.rows as any[];
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return Math.round(n / total * 100) + '%';
}

function fmt_preco(n: number | null): string {
  if (!n) return 'N/A';
  if (n >= 1_000_000) return 'R$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return 'R$' + Math.round(n / 1_000) + 'k';
  return 'R$' + n;
}

function qualityScore(s: ImoveisStats): { score: number; flags: string[] } {
  if (s.total === 0) return { score: 0, flags: ['SEM DADOS'] };
  const flags: string[] = [];
  let score = 100;

  const precoP = s.com_preco / s.total;
  const bairroP = s.com_bairro / s.total;
  const tipoP = s.com_tipo / s.total;

  if (precoP < 0.5) { score -= 20; flags.push(`preço só ${pct(s.com_preco, s.total)}`); }
  else if (precoP < 0.75) { score -= 10; flags.push(`preço ${pct(s.com_preco, s.total)}`); }

  if (bairroP < 0.8) { score -= 15; flags.push(`bairro ${pct(s.com_bairro, s.total)}`); }
  if (tipoP < 0.8) { score -= 15; flags.push(`tipo ${pct(s.com_tipo, s.total)}`); }

  // quartos só importa para residenciais
  if (s.sem_quartos_residenciais > 5) {
    const ratio = s.sem_quartos_residenciais / Math.max(s.total, 1);
    if (ratio > 0.2) { score -= 15; flags.push(`${s.sem_quartos_residenciais} resid s/quartos`); }
    else if (ratio > 0.05) { score -= 5; flags.push(`${s.sem_quartos_residenciais} resid s/quartos`); }
  }

  if (s.com_descricao / s.total < 0.3) { score -= 10; flags.push(`descrição ${pct(s.com_descricao, s.total)}`); }
  if (s.com_imagens / s.total < 0.3) { score -= 5; flags.push(`imagens ${pct(s.com_imagens, s.total)}`); }

  if (s.preco_min_suspeito > 0) flags.push(`${s.preco_min_suspeito} preços < R$500 suspeitos`);
  if (s.preco_max_suspeito > 0) flags.push(`${s.preco_max_suspeito} preços > R$50M suspeitos`);

  return { score: Math.max(0, score), flags };
}

function scoreLabel(s: number): string {
  if (s >= 90) return '🟢 Ótimo';
  if (s >= 70) return '🟡 Bom';
  if (s >= 50) return '🟠 Regular';
  return '🔴 Ruim';
}

async function main() {
  const fontes = await db.execute(sql`
    SELECT id, nome, url, status, last_crawl, crawl_progress
    FROM fontes ORDER BY nome
  `);

  const results: any[] = [];

  for (const f of fontes.rows as FonteRow[]) {
    const stats = await getImoveisStats(f.id);
    const samples = await getSamples(f.id);
    const prog = f.crawl_progress as any;
    const { score, flags } = qualityScore(stats);

    results.push({
      fonte: {
        id: f.id,
        nome: f.nome,
        url: f.url,
        status: f.status,
        last_crawl: f.last_crawl,
      },
      timing: {
        elapsed: prog?.elapsed ?? 'N/A',
        total_urls: prog?.total ?? 0,
        done: prog?.done ?? 0,
        failed: prog?.failed ?? 0,
        completos: prog?.message?.match(/(\d+) completos/)?.[1] ?? '?',
        parciais: prog?.message?.match(/(\d+) parciais/)?.[1] ?? '?',
        fase: prog?.fase ?? '?',
      },
      stats,
      quality: { score, flags },
      samples,
    });
  }

  if (JSON_MODE) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // ======= HUMAN READABLE =======
  const sep = '═'.repeat(90);
  const sep2 = '─'.repeat(90);

  console.log('\n' + sep);
  console.log('  RELATÓRIO COMPLETO DE QUALIDADE — TODAS AS FONTES');
  console.log('  Gerado em: ' + new Date().toLocaleString('pt-BR'));
  console.log(sep);

  for (const r of results) {
    const { fonte, timing, stats, quality, samples } = r;
    console.log('\n' + sep);
    console.log(`  ${fonte.nome}`);
    console.log(`  ${fonte.url}`);
    console.log(`  Status: ${fonte.status}  |  Último crawl: ${fonte.last_crawl ? new Date(fonte.last_crawl).toLocaleString('pt-BR') : 'nunca'}`);
    console.log(sep2);

    // Timing
    console.log(`  ⏱  TIMING`);
    console.log(`     Duração:  ${timing.elapsed}  |  URLs: ${timing.total_urls}  |  Falhas: ${timing.failed}`);
    console.log(`     Completos: ${timing.completos}  |  Parciais: ${timing.parciais}`);
    if (timing.total_urls > 0) {
      const spu = timing.elapsed.includes('min')
        ? (parseFloat(timing.elapsed) * 60 / timing.total_urls).toFixed(1)
        : timing.elapsed.includes('s') ? (parseFloat(timing.elapsed) / timing.total_urls).toFixed(1) : '?';
      console.log(`     Velocidade aprox: ~${spu}s/URL`);
    }

    if (stats.total === 0) {
      console.log(`\n  ⚠️  SEM IMÓVEIS NO BANCO\n`);
      continue;
    }

    // Quality score
    console.log(`\n  ★  QUALIDADE: ${quality.score}/100 — ${scoreLabel(quality.score)}`);
    if (quality.flags.length > 0) {
      console.log(`     Problemas: ${quality.flags.join(' | ')}`);
    }

    // Stats table
    console.log(`\n  📊  DADOS (${stats.total} imóveis)`);
    const prow = (label: string, n: number) =>
      console.log(`     ${label.padEnd(16)} ${String(n).padStart(5)} / ${stats.total} = ${pct(n, stats.total).padStart(4)}`);
    prow('Preço',         stats.com_preco);
    prow('Quartos',       stats.com_quartos);
    prow('Banheiros',     stats.com_banheiros);
    prow('Vagas',         stats.com_vagas);
    prow('Área m²',       stats.com_area);
    prow('Bairro',        stats.com_bairro);
    prow('Descrição',     stats.com_descricao);
    prow('Imagens',       stats.com_imagens);
    prow('Tipo',          stats.com_tipo);
    prow('Transação',     stats.com_transacao);

    if (stats.sem_quartos_residenciais > 0) {
      console.log(`\n     ⚠️  Residenciais s/ quartos: ${stats.sem_quartos_residenciais}`);
    }

    // Precos
    console.log(`\n  💰  PREÇOS: min=${fmt_preco(stats.min_preco)}  avg=${fmt_preco(stats.avg_preco)}  max=${fmt_preco(stats.max_preco)}`);
    if (stats.avg_quartos) console.log(`  🛏  QUARTOS: avg=${stats.avg_quartos}  max=${stats.max_quartos}`);
    if (stats.avg_area) console.log(`  📐  ÁREA:    avg=${stats.avg_area}m²  max=${stats.max_area}m²`);

    // Tipos
    const tipos = Object.entries(stats.por_tipo).map(([k, v]) => `${k}=${v}`).join('  ');
    if (tipos) console.log(`\n  🏠  TIPOS: ${tipos}`);

    const trans = Object.entries(stats.por_transacao).map(([k, v]) => `${k}=${v}`).join('  ');
    if (trans) console.log(`  🔄  TRANSAÇÃO: ${trans}`);

    // Amostras
    if (samples.length > 0) {
      console.log(`\n  📋  AMOSTRAS ALEATÓRIAS:`);
      for (const s of samples) {
        const titulo = (s.titulo ?? 'SEM TITULO').substring(0, 50);
        const preco = s.preco ? fmt_preco(Number(s.preco)) : 's/preço';
        const q = s.quartos ?? '?';
        const b = s.banheiros ?? '?';
        const v = s.vagas ?? '?';
        const a = s.area_m2 ? s.area_m2 + 'm²' : '?m²';
        const bairro = s.bairro ?? '?';
        const desc = s.desc_len ? `desc=${s.desc_len}c` : 'sem desc';
        const imgs = s.n_imagens ? `${s.n_imagens}img` : 'sem imgs';
        console.log(`     • ${titulo}`);
        console.log(`       ${preco} | ${s.tipo ?? '?'} | ${s.transacao ?? '?'} | q=${q} b=${b} v=${v} ${a} | ${bairro} | ${desc} ${imgs}`);
      }
    }
  }

  // ======= SUMMARY TABLE =======
  console.log('\n\n' + sep);
  console.log('  RESUMO COMPARATIVO');
  console.log(sep);
  console.log(`  ${'Fonte'.padEnd(35)} ${'Imóv'.padStart(5)} ${'Qualid'.padStart(7)} ${'Tempo'.padStart(8)} ${'Preço%'.padStart(7)} ${'Qrt%'.padStart(5)} ${'Desc%'.padStart(6)} ${'Probl'}`);
  console.log(sep2);

  // sort by quality score desc
  const sorted = [...results].sort((a, b) => b.quality.score - a.quality.score);
  for (const r of sorted) {
    const nome = r.fonte.nome.substring(0, 34).padEnd(35);
    const total = String(r.stats.total).padStart(5);
    const qs = `${r.quality.score}/100`.padStart(7);
    const elapsed = (r.timing.elapsed ?? 'N/A').padStart(8);
    const precoP = pct(r.stats.com_preco, r.stats.total).padStart(7);
    const qrtP = pct(r.stats.com_quartos, r.stats.total).padStart(5);
    const descP = pct(r.stats.com_descricao, r.stats.total).padStart(6);
    const flags = r.quality.flags.slice(0, 2).join('; ');
    const status = r.fonte.status !== 'ok' ? ` [${r.fonte.status}]` : '';
    console.log(`  ${nome} ${total} ${qs} ${elapsed} ${precoP} ${qrtP} ${descP}${status}  ${flags}`);
  }

  console.log('\n' + sep);
  console.log('  FONTES COM PROBLEMAS CRÍTICOS:');
  const problemas = results.filter(r => r.quality.score < 70 || r.stats.total === 0);
  if (problemas.length === 0) {
    console.log('  ✅ Nenhuma fonte com problemas críticos');
  } else {
    for (const r of problemas) {
      console.log(`  ❌  ${r.fonte.nome}: ${r.quality.flags.join(', ') || 'SEM DADOS'}`);
    }
  }
  console.log(sep + '\n');
}

main().catch(console.error);
