import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractCreciRS } from "@/lib/creci/extractor";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cidade = searchParams.get("cidade")?.trim();

  if (!cidade) {
    return NextResponse.json(
      { error: "Parâmetro 'cidade' é obrigatório" },
      { status: 400 }
    );
  }

  try {
    const imobiliarias = await extractCreciRS(cidade);
    return NextResponse.json({ cidade, total: imobiliarias.length, imobiliarias });
  } catch (err) {
    console.error("[api/creci/extract]", err);
    return NextResponse.json(
      { error: "Falha ao buscar imobiliárias no CRECI" },
      { status: 500 }
    );
  }
}
