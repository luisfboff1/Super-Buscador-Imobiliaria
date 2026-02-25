import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchImoveis } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;

  const filtros = {
    tipo: searchParams.get("tipo") ?? undefined,
    cidade: searchParams.get("cidade") ?? undefined,
    bairro: searchParams.get("bairro") ?? undefined,
    precoMin: searchParams.get("precoMin") ? Number(searchParams.get("precoMin")) : undefined,
    precoMax: searchParams.get("precoMax") ? Number(searchParams.get("precoMax")) : undefined,
    areaMin: searchParams.get("areaMin") ? Number(searchParams.get("areaMin")) : undefined,
    quartosMin: searchParams.get("quartosMin") ? Number(searchParams.get("quartosMin")) : undefined,
  };

  const imoveis = await searchImoveis(filtros);
  return NextResponse.json({ imoveis, total: imoveis.length });
}
