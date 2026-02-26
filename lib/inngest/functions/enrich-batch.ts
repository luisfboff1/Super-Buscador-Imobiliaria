import { inngest } from "@/lib/inngest/client";
import { scrapeProperty } from "@/lib/crawler/firecrawl";
import { upsertImoveis } from "@/lib/db/queries";

const CHUNK_SIZE = 3; // URLs por step.run (3 URLs x ~15s = ~45s, bem dentro de 300s)

export const enrichBatchFunction = inngest.createFunction(
  {
    id: "crawl-fonte-enrich-batch",
    name: "Enriquecer Batch de Imóveis",
    retries: 2,
    concurrency: [{ limit: 3 }], // máx 3 batches em paralelo
  },
  { event: "fontes/enrich-batch.requested" },
  async ({ event, step }) => {
    const { fonteId, batchIndex, urls, cidade, estado } = event.data as {
      fonteId: string;
      batchIndex: number;
      urls: string[];
      cidade?: string | null;
      estado?: string | null;
    };

    let enriched = 0;

    // Processar URLs em chunks de 3 para minimizar steps mas ficar dentro de 300s
    for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
      const chunk = urls.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);

      // Rate limiting durável entre chunks
      if (i > 0) {
        await step.sleep(`delay-${batchIndex}-${chunkIndex}`, "3s");
      }

      const results = await step.run(
        `enrich-${batchIndex}-chunk-${chunkIndex}`,
        async () => {
          const out: Array<{
            url: string;
            data: Record<string, unknown> | null;
          }> = [];

          for (let j = 0; j < chunk.length; j++) {
            // Delay entre items dentro do mesmo step
            if (j > 0) {
              await new Promise((r) => setTimeout(r, 2000));
            }

            const result = await scrapeProperty(chunk[j], cidade, estado);
            out.push({
              url: chunk[j],
              data: result as Record<string, unknown> | null,
            });
          }

          return out;
        }
      );

      // Salvar chunk no DB imediatamente (progresso parcial nunca perde)
      const toSave = results
        .filter((r) => r.data !== null)
        .map((r) => ({
          urlAnuncio: r.url,
          ...r.data,
          // Garantir que imagens é array de strings
          imagens: Array.isArray(r.data?.imagens)
            ? (r.data.imagens as string[])
            : [],
        }));

      if (toSave.length > 0) {
        await step.run(
          `save-${batchIndex}-chunk-${chunkIndex}`,
          async () => {
            await upsertImoveis(fonteId, toSave);
          }
        );
        enriched += toSave.length;
      }
    }

    return { fonteId, batchIndex, enriched, total: urls.length };
  }
);
