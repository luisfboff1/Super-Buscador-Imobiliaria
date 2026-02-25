import * as cheerio from "cheerio";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import type { ImovelInput } from "@/lib/db/queries";
import { detectarPlataforma } from "./detect";
import { parseTecimob } from "./parsers/tecimob";
import { parseJetimob } from "./parsers/jetimob";
import { parseGeneric } from "./parsers/generic";
import { toAbsoluteUrl, encontrarProximaPagina } from "./parsers/utils";

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
      // Se ainda falhou, HTML pequeno ou sem conteúdo de imóveis → Jina
      if (!withReferer || withReferer.length < 5_000 || !temConteudoImoveis(withReferer)) {
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
    console.log(`[crawler] fetch OK: ${url} (${html.length} chars, tem R$: ${/R\$/.test(html)})`);

    // HTML muito pequeno OU sem conteúdo de imóveis indica CSR (React/Next/Vue sem SSR)
    // Jina renderiza o JS e devolve o HTML completo com as listagens
    const semConteudo = !temConteudoImoveis(html);
    if ((html.length < 5_000 || semConteudo) && !referer) {
      console.log(`[crawler] HTML sem conteúdo de imóveis (${html.length} chars), escalando para Jina: ${url}`);
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
 * Extrai todos os links de navegação da homepage (nav, menu, header).
 * Retorna lista de { texto, url } com URLs absolutas.
 */
function extrairLinksNavegacao(html: string, baseUrl: string): Array<{ texto: string; url: string }> {
  const $ = cheerio.load(html);
  const links: Array<{ texto: string; url: string }> = [];
  const vistos = new Set<string>();

  // Prioriza elementos de navegação
  $("nav a, header a, [class*='menu'] a, [class*='nav'] a, [id*='menu'] a, [id*='nav'] a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const texto = $(el).text().trim();
    if (!href || href === "#" || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const url = toAbsoluteUrl(href, baseUrl);
    // Apenas links do mesmo domínio
    if (!url.includes(new URL(baseUrl).hostname)) return;
    if (vistos.has(url)) return;
    vistos.add(url);
    links.push({ texto, url });
  });

  // Se nav não encontrou nada, pega todos os links da página
  if (links.length === 0) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const texto = $(el).text().trim();
      if (!href || href === "#") return;
      const url = toAbsoluteUrl(href, baseUrl);
      if (!url.includes(new URL(baseUrl).hostname)) return;
      if (vistos.has(url)) return;
      vistos.add(url);
      links.push({ texto, url });
    });
  }

  return links.slice(0, 40); // limita para não estourar o contexto do LLM
}

/**
 * Usa LLM para identificar qual link do menu leva à listagem de imóveis à venda.
 * Recebe a lista de links extraídos do menu e retorna a URL mais provável.
 */
async function identificarUrlListagemViaLLM(
  links: Array<{ texto: string; url: string }>,
  baseUrl: string
): Promise<string | null> {
  if (links.length === 0) return null;

  const linksFormatados = links
    .map((l, i) => `${i + 1}. "${l.texto}" → ${l.url}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `Você é um assistente analisando o menu de navegação de um site de imobiliária brasileira.

Site: ${baseUrl}

Links encontrados no menu/navegação:
${linksFormatados}

Qual URL acima leva à página de LISTAGEM/BUSCA de imóveis à venda?
Responda APENAS com a URL completa, sem explicação. Se nenhum link for claramente uma listagem, responda com a palavra NULL.`,
      maxOutputTokens: 100,
    });

    const url = text.trim();
    if (!url || url === "NULL" || !url.startsWith("http")) return null;
    console.log(`[crawler] LLM identificou URL de listagem: ${url}`);
    return url;
  } catch (err) {
    console.warn(`[crawler] LLM falhou ao identificar URL de listagem:`, err);
    return null;
  }
}

/**
 * Determina a URL de listagem de imóveis de forma inteligente:
 * 1. Busca a homepage (com Jina se necessário)
 * 2. Extrai links de navegação
 * 3. LLM identifica qual link é a listagem
 * 4. Fallback: testa candidatos comuns em paralelo
 */
async function resolverUrlListagem(baseUrl: string): Promise<string> {
  console.log(`[crawler] Detectando URL de listagem para ${baseUrl}`);

  // Passo 1: busca a homepage para ler o menu
  // fetchPage já tem fallback para Jina se o site bloquear
  // Usamos fetchDireto sem Jina aqui para ser rápido; se falhar, usamos Jina explicitamente
  let homepageHtml = await fetchDireto(baseUrl);
  if (!homepageHtml || homepageHtml.length < 3_000) {
    console.log(`[crawler] Homepage bloqueada ou vazia, usando Jina para navegação`);
    homepageHtml = await fetchViaJina(baseUrl);
  }

  if (homepageHtml) {
    // Passo 2: extrai links do menu
    const links = extrairLinksNavegacao(homepageHtml, baseUrl);
    console.log(`[crawler] ${links.length} links de navegação encontrados`);

    // Passo 3: LLM decide qual link é a listagem
    if (links.length > 0) {
      const urlLLM = await identificarUrlListagemViaLLM(links, baseUrl);
      if (urlLLM) return urlLLM;
    }
  }

  // Passo 4: fallback com candidatos comuns em paralelo
  console.log(`[crawler] LLM não identificou URL, testando candidatos comuns`);
  const base = baseUrl.replace(/\/$/, "");
  const candidatos = [
    `${base}/imoveis`,
    `${base}/imoveis-a-venda`,
    `${base}/venda`,
    `${base}/comprar`,
    baseUrl,
  ];

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
