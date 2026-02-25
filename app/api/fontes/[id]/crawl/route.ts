import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFonteById, updateFonteStatus, upsertImoveis, markImoveisIndisponiveis } from "@/lib/db/queries";
import { inngest } from "@/lib/inngest/client";
import { crawlFonte } from "@/lib/crawler";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  const fonte = await getFonteById(id);
  if (!fonte) {
    return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 });
  }

  // Em produção (Inngest configurado corretamente), usa o job assíncrono
  // Em dev (sem Inngest dev server), executa o crawl sincronamente
  const useInngest = process.env.NODE_ENV === "production" || process.env.INNGEST_DEV === "1";

  if (useInngest) {
    try {
      await inngest.send({
        name: "fontes/crawl.requested",
        data: { fonteId: id },
      });
      return NextResponse.json({ status: "queued", fonteId: id });
    } catch (err) {
      console.warn("[crawl] Inngest falhou, executando sincronamente:", err);
      // cai no crawl síncrono abaixo
    }
  }

  // Crawl síncrono (dev ou fallback)
  try {
    await updateFonteStatus(id, "crawling");
    const imoveis = await crawlFonte({ id: fonte.id, url: fonte.url, cidade: fonte.cidade, estado: fonte.estado });
    await upsertImoveis(id, imoveis);
    await markImoveisIndisponiveis(id, imoveis.map((i) => i.urlAnuncio));
    await updateFonteStatus(id, "ok");
    return NextResponse.json({ status: "done", fonteId: id, imoveisEncontrados: imoveis.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    await updateFonteStatus(id, "erro", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
