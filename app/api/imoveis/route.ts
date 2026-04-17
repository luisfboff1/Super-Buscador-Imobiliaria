import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchImoveis, type FiltrosImoveis } from "@/lib/db/queries";

const SORT_VALUES = new Set([
  "relevante",
  "preco_asc",
  "preco_desc",
  "area_desc",
  "recentes",
] as const);

function parseSortBy(raw: string | null): FiltrosImoveis["sortBy"] {
  return raw && SORT_VALUES.has(raw as never) ? (raw as FiltrosImoveis["sortBy"]) : undefined;
}

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
    sortBy: parseSortBy(searchParams.get("sortBy")),
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    pageSize: 12,
  };

  const result = await searchImoveis(filtros);
  return NextResponse.json(result);
}
