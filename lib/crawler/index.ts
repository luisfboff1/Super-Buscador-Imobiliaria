import type { ImovelInput } from "@/lib/db/queries";
import { detectarPlataforma } from "./detect";
import { parseTecimob } from "./parsers/tecimob";
import { parseJetimob } from "./parsers/jetimob";
import { parseGeneric } from "./parsers/generic";
import { encontrarProximaPagina } from "./parsers/utils";

const MAX_PAGES = 20; // limite de paginação por crawl
const FETCH_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000; // timeout curto para probing de URL (sem Jina)

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

/** Fallback via Jina AI Reader: roda Chrome real, bypassa Cloudflare/CSR, grátis */
async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // Jina pode demorar até 60s
    const res = await fetch(jinaUrl, {
      headers: {
        "Accept": "text/html",
        "X-Return-Format": "html",    // devolve HTML, não Markdown
        "X-Remove-Selector": "header, footer, nav, script, style", // HTML mais limpo
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[crawler] Jina ${url} → HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    console.log(`[crawler] Jina OK: ${url} (${html.length} chars)`);
    return html;
  } catch (err) {
    console.error(`[crawler] Jina falhou para ${url}:`, err);
    return null;
  }
}

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

    // Se 403 sem referer, tenta com Referer próprio primeiro
    if (res.status === 403 && !referer) {
      await new Promise((r) => setTimeout(r, 1000));
      const withReferer = await fetchPage(url, url);
      // Se ainda falhou (null) ou veio HTML menor que 5kb (provavelmente CSR/bloqueado), escalona para Jina
      if (!withReferer || withReferer.length < 5_000) {
        console.log(`[crawler] Escalando para Jina: ${url}`);
        return fetchViaJina(url);
      }
      return withReferer;
    }

    if (!res.ok) {
      console.warn(`[crawler] ${url} → HTTP ${res.status}`);
      // Qualquer outro erro (ex: 503, 429) também tenta Jina
      if (!referer) return fetchViaJina(url);
      return null;
    }

    const html = await res.text();

    // HTML muito pequeno indica provavelmente CSR (React/Next/Vue sem SSR)
    // Jina renderiza o JS e devolve o HTML completo
    if (html.length < 5_000 && !referer) {
      console.log(`[crawler] HTML muito pequeno (${html.length} chars), escalando para Jina: ${url}`);
      return fetchViaJina(url);
    }

    return html;
  } catch (err) {
    console.error(`[crawler] Falha ao buscar ${url}:`, err);
    // Em caso de erro de rede (ECONNRESET etc.), tenta Jina
    if (!referer) return fetchViaJina(url);
    return null;
  }
}

/**
 * Fetch direto sem fallback Jina — usado apenas para probing rápido de URLs.
 * Timeout curto (5s) para não bloquear a fase de detecção.
 */
async function fetchDireto(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS as Record<string, string>,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const IMOVEL_KEYWORDS = ["apartamento", "m²", "r$", "imovel", "imóvel", "venda", "aluguel"];

function temConteudoImoveis(html: string): boolean {
  const lower = html.toLowerCase();
  return IMOVEL_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Detecta qual URL de listagem de imóveis usar.
 * Testa todos os candidatos em PARALELO para evitar timeouts sequenciais.
 * Não usa Jina aqui — se o site bloquear o fetch direto, o crawl principal
 * já tem Jina como fallback na fase de extração.
 */
async function resolverUrlListagem(baseUrl: string): Promise<string> {
  const base = baseUrl.replace(/\/$/, "");
  const candidatos = [
    `${base}/imoveis`,
    `${base}/imoveis-a-venda`,
    `${base}/venda`,
    `${base}/comprar`,
    baseUrl,
  ];

  // Testa todos em paralelo, retorna o primeiro que tiver conteúdo de imóveis
  const resultados = await Promise.allSettled(
    candidatos.map(async (url) => {
      const html = await fetchDireto(url);
      if (html && temConteudoImoveis(html)) return url;
      throw new Error("sem conteúdo");
    })
  );

  for (const r of resultados) {
    if (r.status === "fulfilled") return r.value;
  }

  // Nenhum candidato funcionou via fetch direto — usa baseUrl e deixa Jina agir no crawl
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
