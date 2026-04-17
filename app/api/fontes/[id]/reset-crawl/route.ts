import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteImoveisByFonteId, getFonteById, updateFonteStatus } from "@/lib/db/queries";

export async function POST(
  _req: Request,
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

  if (fonte.status === "crawling") {
    return NextResponse.json(
      { error: "A fonte já está sincronizando" },
      { status: 409 }
    );
  }

  try {
    await deleteImoveisByFonteId(id);
    await updateFonteStatus(id, "pendente");

    const origin = new URL(_req.url).origin;
    const crawlRes = await fetch(`${origin}/api/fontes/${id}/crawl`, {
      method: "POST",
      headers: {
        cookie: _req.headers.get("cookie") ?? "",
      },
    });

    if (!crawlRes.ok) {
      const data = await crawlRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: data.error ?? "Erro ao reiniciar crawl" },
        { status: crawlRes.status }
      );
    }

    const data = await crawlRes.json();
    return NextResponse.json({
      ...data,
      reset: true,
      message: "Imóveis apagados e nova busca iniciada.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
