import { inngest } from "@/lib/inngest/client";
import { mapPropertyUrls } from "@/lib/crawler/firecrawl";
import {
  getFonteById,
  updateFonteStatus,
  upsertImoveis,
  markImoveisIndisponiveis,
} from "@/lib/db/queries";
import type { ImovelInput } from "@/lib/db/queries";

const BATCH_SIZE = 10; // URLs por batch de enriquecimento

export const crawlFonteFunction = inngest.createFunction(
  {
    id: "crawl-fonte",
    name: "Crawl de Fonte (Imobiliária)",
    retries: 2,
    concurrency: [{ limit: 2 }], // máx 2 fontes crawling ao mesmo tempo
  },
  { event: "fontes/crawl.requested" },
  async ({ event, step }) => {
    const { fonteId } = event.data as { fonteId: string };

    // 1. Busca a fonte no banco
    const fonte = await step.run("buscar-fonte", async () => {
      const f = await getFonteById(fonteId);
      if (!f) throw new Error(`Fonte ${fonteId} não encontrada`);
      return f;
    });

    // 2. Marca como "crawling"
    await step.run("set-crawling", async () => {
      await updateFonteStatus(fonteId, "crawling");
    });

    // 3. Descobre URLs de imóveis via Firecrawl /map
    const propertyUrls = await step.run("map-site", async () => {
      return mapPropertyUrls(fonte.url);
    });

    if (propertyUrls.length === 0) {
      await step.run("set-ok-vazio", async () => {
        await updateFonteStatus(fonteId, "ok");
      });
      return { fonteId, imoveisEncontrados: 0, batchesDispatched: 0 };
    }

    // 4. Salvar URLs base no DB (antes do enriquecimento — nunca perde dados)
    const baseImoveis: ImovelInput[] = propertyUrls.map((url) => ({
      urlAnuncio: url,
      cidade: fonte.cidade,
      estado: fonte.estado,
    }));

    await step.run("salvar-urls-base", async () => {
      await upsertImoveis(fonteId, baseImoveis);
    });

    // 5. Criar batches e disparar fan-out
    const batches: string[][] = [];
    for (let i = 0; i < propertyUrls.length; i += BATCH_SIZE) {
      batches.push(propertyUrls.slice(i, i + BATCH_SIZE));
    }

    await step.sendEvent(
      "dispatch-enrich-batches",
      batches.map((batch, idx) => ({
        name: "fontes/enrich-batch.requested" as const,
        data: {
          fonteId,
          batchIndex: idx,
          urls: batch,
          cidade: fonte.cidade,
          estado: fonte.estado,
        },
      }))
    );

    // 6. Aguardar tempo estimado para batches completarem
    // Cada batch de 10 URLs com 2s de delay ≈ 3 min. Com concurrency 3, ~ceil(N/3) * 3 min.
    const estimatedWaitS = Math.min(Math.ceil(batches.length / 3) * 180, 900);
    await step.sleep("wait-for-enrichment", `${estimatedWaitS}s`);

    // 7. Marcar imóveis que não aparecem mais como indisponíveis
    await step.run("marcar-indisponiveis", async () => {
      await markImoveisIndisponiveis(fonteId, propertyUrls);
    });

    // 8. Atualizar status da fonte para "ok"
    await step.run("set-ok", async () => {
      await updateFonteStatus(fonteId, "ok");
    });

    return {
      fonteId,
      imoveisEncontrados: propertyUrls.length,
      batchesDispatched: batches.length,
    };
  }
);
