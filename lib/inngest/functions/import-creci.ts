import { inngest } from "@/lib/inngest/client";
import { extractCreciRS } from "@/lib/creci/extractor";
import { getImportJob, updateImportJob } from "@/lib/db/queries";

export const importCreciFunction = inngest.createFunction(
  {
    id: "import-creci",
    name: "Importar imobiliárias do CRECI-RS",
    retries: 1,
    concurrency: [{ key: "event.data.jobId", limit: 1 }],
  },
  { event: "creci/import.requested" },
  async ({ event, step }) => {
    const { jobId, cidade } = event.data as { jobId: string; cidade: string };

    // 1. Verifica que o job existe
    const job = await step.run("buscar-job", async () => {
      const j = await getImportJob(jobId);
      if (!j) throw new Error(`Job ${jobId} não encontrado`);
      return j;
    });

    // 2. Marca como running
    await step.run("set-running", async () => {
      await updateImportJob(jobId, {
        status: "running",
        startedAt: new Date(),
      });
    });

    // 3. Roda o extract com progresso ao vivo
    //    Cada batch enriquecido escreve no DB pra que o frontend possa polling
    try {
      const lista = await extractCreciRS(job.cidade, {
        onProgress: async (p) => {
          await updateImportJob(jobId, {
            total: p.total,
            enriched: p.enriched,
            imobiliarias: p.imobiliarias,
          });
        },
      });

      await step.run("set-completed", async () => {
        await updateImportJob(jobId, {
          status: "completed",
          total: lista.length,
          enriched: lista.filter((i) => !!i.url).length,
          imobiliarias: lista,
          completedAt: new Date(),
        });
      });

      return {
        jobId,
        cidade: job.cidade,
        total: lista.length,
        enriched: lista.filter((i) => !!i.url).length,
      };
    } catch (err) {
      await updateImportJob(jobId, {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });
      throw err;
    }
  }
);
