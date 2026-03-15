import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import * as tenantSchema from "@/lib/db/schema/tenant";

// Se o heartbeat do worker tem mais de 90s, consideramos morto
const HEARTBEAT_STALE_MS = 90 * 1000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  const [fonte] = await db
    .select({
      status: tenantSchema.fontes.status,
      crawlProgress: tenantSchema.fontes.crawlProgress,
      crawlErro: tenantSchema.fontes.crawlErro,
      lastCrawl: tenantSchema.fontes.lastCrawl,
    })
    .from(tenantSchema.fontes)
    .where(eq(tenantSchema.fontes.id, id))
    .limit(1);

  if (!fonte) {
    return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 });
  }

  // Detecção de heartbeat velho: se status='crawling' mas worker parou de atualizar
  if (fonte.status === "crawling") {
    const progress = fonte.crawlProgress as Record<string, unknown> | null;
    const heartbeatAt = progress?.heartbeatAt as string | undefined;

    let isStale = false;
    if (!progress || !heartbeatAt) {
      // Sem heartbeat = estado legado ou worker nunca respondeu
      isStale = true;
    } else {
      const age = Date.now() - new Date(heartbeatAt).getTime();
      isStale = age > HEARTBEAT_STALE_MS;
    }

    if (isStale) {
      // Corrigir no DB — assim o F5 também vê o estado correto
      const erroMsg = "Worker parou de responder. Tente sincronizar novamente.";
      const finishedProgress = {
        ...(progress ?? {}),
        finished: true,
        heartbeatAt: new Date().toISOString(),
      };

      await db
        .update(tenantSchema.fontes)
        .set({
          status: "erro",
          crawlErro: erroMsg,
          crawlProgress: finishedProgress,
        })
        .where(eq(tenantSchema.fontes.id, id));

      return NextResponse.json({
        status: "erro",
        progress: finishedProgress,
        erro: erroMsg,
        lastCrawl: fonte.lastCrawl,
      });
    }
  }

  return NextResponse.json({
    status: fonte.status,
    progress: fonte.crawlProgress,
    erro: fonte.crawlErro,
    lastCrawl: fonte.lastCrawl,
  });
}
