import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchImoveis } from "@/lib/db/queries";

/** Parse a number that may use Brazilian formatting (dot = thousands separator) */
function parseBRNumber(raw: string | null): number | undefined {
  if (!raw) return undefined;
  // Remove dots used as thousands separators, then swap comma for decimal point
  const sanitized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(sanitized);
  return isNaN(n) ? undefined : n;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;

  const filtros = {
    q: searchParams.get("q") ?? undefined,
    tipo: searchParams.get("tipo") ?? undefined,
    transacao: searchParams.get("transacao") ?? undefined,
    cidade: searchParams.get("cidade") ?? undefined,
    bairro: searchParams.get("bairro") ?? undefined,
    precoMin: parseBRNumber(searchParams.get("precoMin")),
    precoMax: parseBRNumber(searchParams.get("precoMax")),
    areaMin: parseBRNumber(searchParams.get("areaMin")),
    areaMax: parseBRNumber(searchParams.get("areaMax")),
    quartosMin: searchParams.get("quartosMin") ? Number(searchParams.get("quartosMin")) : undefined,
    vagasMin: searchParams.get("vagasMin") ? Number(searchParams.get("vagasMin")) : undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    pageSize: 12,
  };

  const result = await searchImoveis(filtros);
  return NextResponse.json(result);
}
