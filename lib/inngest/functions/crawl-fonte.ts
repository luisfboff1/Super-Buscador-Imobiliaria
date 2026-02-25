import { inngest } from "@/lib/inngest/client";
import { crawlFonte } from "@/lib/crawler";
import {
  getFonteById,
  updateFonteStatus,
  upsertImoveis,
  markImoveisIndisponiveis,
} from "@/lib/db/queries";

export const crawlFonteFunction = inngest.createFunction(
  {
    id: "crawl-fonte",
    name: "Crawl de Fonte (Imobiliária)",
    retries: 2,
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

    // 3. Executa o crawl
    const imoveis = await step.run("crawl", async () => {
      return crawlFonte({
        id: fonte.id,
        url: fonte.url,
        cidade: fonte.cidade,
        estado: fonte.estado,
      });
    });

    // 4. Persiste os imóveis no banco (upsert)
    await step.run("salvar-imoveis", async () => {
      await upsertImoveis(fonteId, imoveis);
    });

    // 5. Marca imóveis que não aparecem mais como indisponíveis
    await step.run("marcar-indisponiveis", async () => {
      const urlsAtivas = imoveis.map((i) => i.urlAnuncio);
      await markImoveisIndisponiveis(fonteId, urlsAtivas);
    });

    // 6. Atualiza status da fonte para "ok"
    await step.run("set-ok", async () => {
      await updateFonteStatus(fonteId, "ok");
    });

    return {
      fonteId,
      imoveisEncontrados: imoveis.length,
    };
  }
);
