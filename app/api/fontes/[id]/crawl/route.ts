import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFonteById, updateFonteStatus } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import * as tenantSchema from "@/lib/db/schema/tenant";

const CRAWLER_WORKER_URL = process.env.CRAWLER_WORKER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;

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

  if (!CRAWLER_WORKER_URL) {
    return NextResponse.json(
      { error: "CRAWLER_WORKER_URL não configurado" },
      { status: 500 }
    );
  }

  // Dispara crawl no worker (Railway) — retorna imediatamente
  try {
    // Escrever heartbeat inicial ANTES de chamar o worker
    // Garante que há heartbeatAt mesmo se o worker crashar imediatamente
    await db
      .update(tenantSchema.fontes)
      .set({
        crawlProgress: {
          fase: "descoberta",
          message: "Iniciando sincronização...",
          done: 0,
          total: 0,
          pct: 0,
          enriched: 0,
          failed: 0,
          elapsed: "0s",
          logs: [],
          finished: false,
          heartbeatAt: new Date().toISOString(),
        },
      })
      .where(eq(tenantSchema.fontes.id, id));

    const workerRes = await fetch(`${CRAWLER_WORKER_URL}/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(WORKER_SECRET && { Authorization: `Bearer ${WORKER_SECRET}` }),
      },
      body: JSON.stringify({ fonteId: id }),
    });

    if (!workerRes.ok) {
      const errorBody = await workerRes.text();
      console.error(`[crawl] worker respondeu ${workerRes.status}: ${errorBody}`);
      return NextResponse.json(
        { error: `Worker erro: ${workerRes.status}` },
        { status: 502 }
      );
    }

    const result = await workerRes.json();
    console.log(`[crawl] worker aceitou crawl para fonte ${id}:`, result);

    return NextResponse.json({
      status: "started",
      fonteId: id,
      message: "Crawl iniciado no worker. Os imóveis aparecerão progressivamente.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[crawl] falha ao chamar worker:`, msg);
    await updateFonteStatus(id, "erro", `Worker indisponível: ${msg}`);
    return NextResponse.json(
      { error: `Worker indisponível: ${msg}` },
      { status: 503 }
    );
  }
}
