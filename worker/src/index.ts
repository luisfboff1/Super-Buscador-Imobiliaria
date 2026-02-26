/**
 * Worker HTTP Server — Hono
 *
 * Endpoints:
 * - GET  /health     → health check
 * - POST /crawl      → inicia crawl de uma fonte (async, retorna imediatamente)
 *
 * Autenticação via header: Authorization: Bearer <WORKER_SECRET>
 */

import "dotenv/config"; // carrega .env em dev (no-op em produção sem .env)
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  getFonteById,
  updateFonteStatus,
  upsertImoveis,
  markImoveisIndisponiveis,
} from "./db.js";
import {
  discoverPropertyUrls,
  scrapePropertyPage,
  closeBrowser,
} from "./crawler.js";

const app = new Hono();

const WORKER_SECRET = process.env.WORKER_SECRET;

// ─── Auth middleware ──────────────────────────────────────────────────────────

function checkAuth(authHeader: string | undefined): boolean {
  if (!WORKER_SECRET) return true; // sem secret = dev mode
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  return token === WORKER_SECRET;
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Crawl endpoint ───────────────────────────────────────────────────────────

app.post("/crawl", async (c) => {
  if (!checkAuth(c.req.header("Authorization"))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{ fonteId: string }>();
  const { fonteId } = body;

  if (!fonteId) {
    return c.json({ error: "fonteId required" }, 400);
  }

  // Retorna imediatamente, processa em background
  // (não usa await para não bloquear a resposta)
  executeCrawl(fonteId).catch((err) => {
    console.error(`[worker] crawl falhou para fonte ${fonteId}:`, err);
  });

  return c.json({ status: "started", fonteId });
});

// ─── Crawl execution (background) ────────────────────────────────────────────

async function executeCrawl(fonteId: string) {
  const startTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[worker] INICIANDO CRAWL — fonte: ${fonteId}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // 1. Buscar fonte no DB
    const fonte = await getFonteById(fonteId);
    if (!fonte) {
      console.error(`[worker] fonte ${fonteId} não encontrada no DB`);
      return;
    }

    console.log(`[worker] fonte: ${fonte.nome} — ${fonte.url}`);
    console.log(`[worker] cidade: ${fonte.cidade}, estado: ${fonte.estado}`);

    // 2. Marcar como crawling
    await updateFonteStatus(fonteId, "crawling");

    // 3. Descobrir URLs de imóveis (paginação completa)
    console.log(`\n[worker] ── FASE 1: Descoberta de URLs ──\n`);
    const urls = await discoverPropertyUrls(fonte.url, (msg) =>
      console.log(msg)
    );

    if (urls.length === 0) {
      console.log(`[worker] nenhum imóvel encontrado, finalizando`);
      await updateFonteStatus(fonteId, "ok");
      await closeBrowser();
      return;
    }

    console.log(`\n[worker] ✓ ${urls.length} URLs de imóveis descobertas\n`);

    // 4. Salvar URLs base no DB (progresso parcial — nunca perde)
    console.log(`[worker] ── FASE 2: Salvando URLs base ──\n`);
    await upsertImoveis(
      fonteId,
      urls.map((url) => ({
        urlAnuncio: url,
        cidade: fonte.cidade,
        estado: fonte.estado,
      }))
    );
    console.log(`[worker] ✓ ${urls.length} URLs salvas no DB\n`);

    // 5. Enriquecer cada imóvel (scrape + extração)
    const MAX_ENRICH = parseInt(process.env.CRAWL_MAX_ENRICH || "0", 10);
    const urlsToEnrich = MAX_ENRICH > 0 ? urls.slice(0, MAX_ENRICH) : urls;
    if (MAX_ENRICH > 0) {
      console.log(`[worker] ── FASE 3: Enriquecimento (limitado a ${MAX_ENRICH}/${urls.length}) ──\n`);
    } else {
      console.log(`[worker] ── FASE 3: Enriquecimento (${urls.length} imóveis) ──\n`);
    }
    let enriched = 0;
    let failed = 0;
    // CONCURRENCY: quantas páginas abrir em paralelo (ajustável via env)
    const CONCURRENCY = parseInt(process.env.CRAWL_CONCURRENCY || "3", 10);

    for (let i = 0; i < urlsToEnrich.length; i += CONCURRENCY) {
      const batch = urlsToEnrich.slice(i, i + CONCURRENCY);
      const batchNum = Math.floor(i / CONCURRENCY) + 1;
      const totalBatches = Math.ceil(urlsToEnrich.length / CONCURRENCY);

      console.log(
        `\n[worker] batch ${batchNum}/${totalBatches} — ${batch.length} em paralelo`
      );

      // Processar em paralelo com Promise.all
      const results = await Promise.all(
        batch.map(async (url) => {
          try {
            const data = await scrapePropertyPage(url, fonte.cidade, fonte.estado);
            if (data) enriched++;
            else failed++;
            return { url, data };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[worker] ✗ erro ${url}: ${msg}`);
            failed++;
            return { url, data: null };
          }
        })
      );

      // Salvar batch no DB imediatamente (progresso parcial)
      const toSave = results.filter((r) => r.data !== null).map((r) => r.data!);

      if (toSave.length > 0) {
        await upsertImoveis(fonteId, toSave);
        console.log(
          `[worker] ✓ batch ${batchNum}: ${toSave.length} salvos (total: ${enriched}/${urlsToEnrich.length})`
        );
      }

      // sem delay — Railway processa à velocidade natural das páginas
    }

    // 6. Marcar imóveis antigos como indisponíveis
    console.log(`\n[worker] ── FASE 4: Marcando indisponíveis ──\n`);
    await markImoveisIndisponiveis(fonteId, urls);

    // 7. Finalizar
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    await updateFonteStatus(fonteId, "ok");
    await closeBrowser();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[worker] ✓ CRAWL CONCLUÍDO`);
    console.log(`[worker]   fonte: ${fonte.nome}`);
    console.log(`[worker]   URLs: ${urls.length}`);
    console.log(`[worker]   enriquecidos: ${enriched}`);
    console.log(`[worker]   falhas: ${failed}`);
    console.log(`[worker]   tempo: ${elapsed}s`);
    console.log(`${"=".repeat(60)}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ✗ CRAWL FALHOU: ${msg}`);
    await updateFonteStatus(fonteId, "erro", msg).catch(() => {});
    await closeBrowser().catch(() => {});
  }
}

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3001", 10);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n🚀 Worker rodando em http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Crawl:  POST http://localhost:${PORT}/crawl`);
  console.log(`   Secret: ${WORKER_SECRET ? "configurado" : "NENHUM (dev mode)"}\n`);
});
