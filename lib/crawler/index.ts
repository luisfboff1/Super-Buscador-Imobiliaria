import type { ImovelInput } from "@/lib/db/queries";
import { detectarPlataforma } from "./detect";
import { parseTecimob } from "./parsers/tecimob";
import { parseJetimob } from "./parsers/jetimob";
import { parseGeneric } from "./parsers/generic";
import { encontrarProximaPagina } from "./parsers/utils";

const MAX_PAGES = 20; // limite de paginação por crawl
const FETCH_TIMEOUT_MS = 15_000;

const DEFAULT_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="122", "Chromium";v="122"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  DNT: "1",
};

async function fetchPage(url: string, referer?: string): Promise<string | null> {
  const headers: Record<string, string> = {
    ...(DEFAULT_HEADERS as Record<string, string>),
  };
  if (referer) headers["Referer"] = referer;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);

    // Se 403, tenta uma vez mais com o próprio URL como Referer + pequeno delay
    if (res.status === 403 && !referer) {
      await new Promise((r) => setTimeout(r, 1500));
      return fetchPage(url, url);
    }

    if (!res.ok) {
      console.warn(`[crawler] ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[crawler] Falha ao buscar ${url}:`, err);
    return null;
  }
}

/**
 * Detecta qual URL de listagem de imóveis usar para uma imobiliária.
 * Muitos sites têm a listagem em /imoveis ou /venda, não na raiz.
 */
async function resolverUrlListagem(baseUrl: string): Promise<string> {
  const candidatos = [
    baseUrl,
    `${baseUrl.replace(/\/$/, "")}/imoveis`,
    `${baseUrl.replace(/\/$/, "")}/venda`,
    `${baseUrl.replace(/\/$/, "")}/comprar`,
    `${baseUrl.replace(/\/$/, "")}/imoveis-a-venda`,
  ];

  for (const url of candidatos) {
    const html = await fetchPage(url);
    if (!html) continue;
    // Verifica se a página tem pelo menos alguma referência a imóveis
    if (
      html.toLowerCase().includes("apartamento") ||
      html.toLowerCase().includes("m²") ||
      html.toLowerCase().includes("r$") ||
      html.toLowerCase().includes("imovel") ||
      html.toLowerCase().includes("imóvel")
    ) {
      return url;
    }
  }

  return baseUrl;
}

export async function crawlFonte(
  fonte: { id: string; url: string; cidade?: string | null; estado?: string | null }
): Promise<ImovelInput[]> {
  const todosImoveis: ImovelInput[] = [];
  const urlsVistas = new Set<string>();

  // Resolver URL de listagem real
  const urlListagem = await resolverUrlListagem(fonte.url);
  let paginaAtual: string | null = urlListagem;
  let pagina = 0;

  while (paginaAtual && pagina < MAX_PAGES) {
    if (urlsVistas.has(paginaAtual)) break;
    urlsVistas.add(paginaAtual);
    pagina++;

    console.log(`[crawler] Página ${pagina}: ${paginaAtual}`);

    const html = await fetchPage(paginaAtual);
    if (!html) break;

    // Detecta plataforma na primeira página
    const plataforma = pagina === 1 ? detectarPlataforma(fonte.url, html) : detectarPlataforma(fonte.url, "");

    // Extrai imóveis com o parser correto
    let imoveisPagina: ImovelInput[];
    if (plataforma === "tecimob") {
      imoveisPagina = parseTecimob(html, paginaAtual);
    } else if (plataforma === "jetimob") {
      imoveisPagina = parseJetimob(html, paginaAtual);
    } else {
      imoveisPagina = await parseGeneric(html, paginaAtual);
    }

    if (imoveisPagina.length === 0) {
      console.log(`[crawler] Nenhum imóvel encontrado na página ${pagina} — encerrando paginação`);
      break;
    }

    // Enriquece com cidade/estado da fonte se não preenchidos pelo parser
    const enriquecidos = imoveisPagina.map((item) => ({
      ...item,
      cidade: item.cidade || fonte.cidade || null,
      estado: item.estado || fonte.estado || null,
    }));

    todosImoveis.push(...enriquecidos);
    console.log(`[crawler] +${imoveisPagina.length} imóveis (total: ${todosImoveis.length})`);

    // Encontra próxima página
    paginaAtual = encontrarProximaPagina(html, paginaAtual);
  }

  // Deduplica por URL de anúncio
  const deduplicados = Array.from(
    new Map(todosImoveis.map((i) => [i.urlAnuncio, i])).values()
  );

  console.log(`[crawler] Crawl finalizado: ${deduplicados.length} imóveis únicos de ${fonte.url}`);
  return deduplicados;
}
