import * as cheerio from "cheerio";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import type { ImovelInput } from "@/lib/db/queries";
import { detectarPlataforma } from "./detect";
import { parseTecimob } from "./parsers/tecimob";
import { parseJetimob } from "./parsers/jetimob";
import { parseGeneric, extrairUrlsDetalheDoDOM, parseHeuristico, parseDetailPage } from "./parsers/generic";
import { toAbsoluteUrl, encontrarProximaPagina } from "./parsers/utils";
import { extrairDadosViaLLM } from "./extractors/llm-detail";

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

/**
 * Jina em modo "renderizado completo" — preserva todos os elementos (sem X-Remove-Selector)
 * e espera até um link de imóvel aparecer no DOM (React lazy-fetches the listing data).
 */
async function fetchViaJinaRendered(url: string, waitForSelector?: string): Promise<string | null> {
  const selector = waitForSelector ?? 'a[href*="imovel"], a[href*="property"], a[href*="/venda/"]';
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const res = await fetch(jinaUrl, {
      headers: {
        "Accept": "text/html",
        "X-Return-Format": "html",
        // Sem X-Remove-Selector para capturar todos os <a>
        "X-Wait-For-Selector": selector,  // aguarda cards React renderizarem
        "X-Timeout": "25",                // 25s para a página carregar os dados
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[crawler] JinaRendered ${url} → HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    // Log primeiros hrefs para ajudar debug
    const hrefSamples = Array.from(html.matchAll(/href=["']([^"'#][^"']*)["']/gi))
      .map(m => m[1]).filter(h => h.startsWith("/") || h.startsWith("http")).slice(0, 15);
    console.log(`[crawler] JinaRendered OK: ${url} (${html.length} chars)`);
    console.log(`[crawler] Primeiros hrefs (Jina): ${hrefSamples.join(" | ")}`);
    return html;
  } catch (err) {
    console.error(`[crawler] JinaRendered falhou para ${url}:`, err);
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

// ─── Sitemap parser ──────────────────────────────────────────────────────────

interface SitemapEntry {
  url: string;
  imagem?: string;
}

/**
 * Extrai URLs de imóveis do sitemap.xml do site.
 * Estratégia universal:
 * 1. Busca /sitemap.xml
 * 2. Se é sitemap index → procura child sitemap com keyword de imóvel
 * 3. Parseia o child sitemap → extrai <loc> + <image:loc>
 * Retorna lista de URLs + imagem principal. Retorna [] se sitemap não existir.
 */
/**
 * Fetch robusto para sitemaps — timeout generoso (15s) + fallback Jina.
 * Diferente de fetchDireto (5s, sem fallback) que era insuficiente para XMLs grandes.
 */
async function fetchSitemap(url: string): Promise<string | null> {
  // Tenta fetch direto com timeout mais generoso (30s para XMLs grandes)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS as Record<string, string>,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (text.length > 50) return text;
    }
    console.log(`[sitemap] Fetch direto falhou (${res.status}), tentando Jina: ${url}`);
  } catch {
    console.log(`[sitemap] Fetch direto timeout/erro, tentando Jina: ${url}`);
  }
  // Fallback: Jina SEM X-Remove-Selector (que é para HTML, não XML — causa 422 em XML)
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(jinaUrl, {
      headers: { "Accept": "text/xml, application/xml, text/html", "X-Return-Format": "html" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[sitemap] Jina ${url} → HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    console.log(`[sitemap] Jina OK: ${url} (${text.length} chars)`);
    return text;
  } catch {
    console.warn(`[sitemap] Jina falhou para ${url}`);
    return null;
  }
}

async function extrairUrlsDeSitemap(baseUrl: string): Promise<SitemapEntry[]> {
  const origin = new URL(baseUrl).origin;
  console.log(`[sitemap] Buscando sitemap de ${origin}`);

  // Passo 1: buscar /sitemap.xml
  const sitemapXml = await fetchSitemap(`${origin}/sitemap.xml`);
  if (!sitemapXml || sitemapXml.length < 100) {
    console.log(`[sitemap] Nenhum sitemap encontrado`);
    return [];
  }

  // Passo 2: verificar se é sitemap index (tem <sitemapindex>)
  const isSitemapIndex = /<sitemapindex/i.test(sitemapXml);
  if (isSitemapIndex) {
    // Encontra child sitemaps com keywords de imóvel
    const SITEMAP_KEYWORDS = /imovel|imoveis|property|properties|listing|listings|anuncio|anuncios/i;
    const childLocs = Array.from(sitemapXml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi))
      .map(m => m[1].trim())
      .filter(loc => SITEMAP_KEYWORDS.test(loc));

    if (childLocs.length === 0) {
      // Fallback: tenta todos os child sitemaps que não sejam claramente off-topic
      const allLocs = Array.from(sitemapXml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi))
        .map(m => m[1].trim())
        .filter(loc => !/blog|noticia|news|page|categoria|tag/i.test(loc));
      childLocs.push(...allLocs.slice(0, 3));
    }

    console.log(`[sitemap] Sitemap index: ${childLocs.length} child sitemaps relevantes`);

    // Busca cada child sitemap e extrai entradas
    const entries: SitemapEntry[] = [];
    for (const childUrl of childLocs.slice(0, 5)) {
      const childXml = await fetchSitemap(childUrl);
      if (!childXml) continue;
      const childEntries = parseSitemapUrlset(childXml, origin);
      entries.push(...childEntries);
      console.log(`[sitemap] ${childUrl}: ${childEntries.length} URLs`);
      if (entries.length > 2000) break; // safety limit
    }
    return entries;
  }

  // Sitemap direto (não é index)
  const entries = parseSitemapUrlset(sitemapXml, origin);
  console.log(`[sitemap] Sitemap direto: ${entries.length} URLs`);
  return entries;
}

/**
 * Extrai metadados (cidade, bairro, tipo) diretamente do path da URL.
 * Funciona para padrões comuns como:
 *   /imoveis/venda/caxias-do-sul/madureira/-/apartamento/6392/imovel/1103545
 *   /imovel/apartamento-2-quartos-centro-florianopolis/12345
 *   /venda/casa/bairro-centro/cidade-curitiba
 */
function extrairMetadadosDeUrl(url: string): { cidade?: string; bairro?: string; tipo?: string } {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const segments = path.split("/").filter(Boolean);

    const TIPOS = [
      "apartamento", "casa", "terreno", "sobrado", "cobertura", "kitnet",
      "loft", "flat", "sala", "loja", "galpao", "galp\u00e3o", "chacara", "ch\u00e1cara",
      "sitio", "s\u00edtio", "fazenda", "imovel-comercial", "comercial", "rural",
      "studio", "duplex", "triplex", "garden", "lote", "barrac\u00e3o", "barracao",
    ];

    let cidade: string | undefined;
    let bairro: string | undefined;
    let tipo: string | undefined;

    // Padr\u00e3o Sobressai/comum: /imoveis/venda/{cidade}/{bairro}/-/{tipo}/{code}/imovel/{id}
    const vendaIdx = segments.indexOf("venda");
    const aluguelIdx = segments.indexOf("aluguel");
    const transIdx = vendaIdx >= 0 ? vendaIdx : aluguelIdx;

    if (transIdx >= 0 && segments.length > transIdx + 2) {
      const cidadeSlug = segments[transIdx + 1];
      if (cidadeSlug && cidadeSlug !== "-" && cidadeSlug.length > 1) {
        cidade = deslugify(cidadeSlug);
      }
      const bairroSlug = segments[transIdx + 2];
      if (bairroSlug && bairroSlug !== "-" && bairroSlug.length > 1) {
        bairro = deslugify(bairroSlug);
      }
    }

    // Tipo: encontra segmento que corresponde a um tipo de im\u00f3vel
    for (const seg of segments) {
      if (TIPOS.includes(seg)) {
        tipo = deslugify(seg);
        break;
      }
    }

    // Se n\u00e3o achou tipo no segmento puro, tenta no slug composto
    if (!tipo) {
      for (const seg of segments) {
        for (const t of TIPOS) {
          if (seg.startsWith(t + "-") || seg.startsWith(t + "_")) {
            tipo = deslugify(t);
            break;
          }
        }
        if (tipo) break;
      }
    }

    return { cidade, bairro, tipo };
  } catch {
    return {};
  }
}

/** Converte slug-case para Title Case: "caxias-do-sul" → "Caxias Do Sul" */
function deslugify(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Parseia um <urlset> sitemap XML e extrai <loc> + <image:loc> */
function parseSitemapUrlset(xml: string, origin: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  // Divide por <url> blocks
  const urlBlocks = xml.split(/<url>/i).slice(1); // skip preamble

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/i);
    if (!locMatch) continue;
    const url = locMatch[1].trim();

    // Filtra: só URLs do mesmo domínio + com path de detalhe
    try {
      const parsed = new URL(url);
      if (!parsed.origin.includes(new URL(origin).hostname)) continue;
      const path = parsed.pathname;
      // Deve ter path significativo (não homepage, não /imoveis/ listagem pura)
      if (path === "/" || path.length < 10) continue;
      // Deve parecer uma página de detalhe (tem número, ou /imovel/, ou slug longo)
      if (!/\/\d{2,}|imovel|property|listing|\d+-[a-z]/.test(path)) continue;
    } catch { continue; }

    // Extrai imagem se disponível
    const imgMatch = block.match(/<image:loc>\s*(.*?)\s*<\/image:loc>/i);
    const imagem = imgMatch ? imgMatch[1].trim() : undefined;

    entries.push({ url, imagem });
  }

  return entries;
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
 * Identifica a URL de listagem de imóveis à venda de forma PROGRAMÁTICA.
 * Pontua cada link do menu por palavras-chave no path e no texto.
 * Não usa LLM — funciona mesmo com quota zerada.
 */
function identificarUrlListagemProgramaticamente(
  links: Array<{ texto: string; url: string }>,
  baseUrl: string
): string | null {
  if (links.length === 0) return null;

  // Palavras-chave no PATH — maior peso
  const PATH_KEYWORDS: [RegExp, number][] = [
    [/\/imoveis\/venda/i, 10],
    [/\/imoveis\/comprar/i, 10],
    [/\/imoveis-a-venda/i, 10],
    [/\/imoveis\/para-venda/i, 10],
    [/\/comprar\//i, 8],
    [/\/venda\//i, 8],
    [/\/imoveis/i, 6],
    [/\/residencial/i, 4],
    [/\/busca/i, 3],
    [/\/buscar/i, 3],
    [/\/search/i, 2],
    [/\/listing/i, 2],
    [/\/properties/i, 2],
  ];
  // Palavras-chave no TEXTO do link
  const TEXT_KEYWORDS: [RegExp, number][] = [
    [/comprar|à venda|a venda/i, 6],
    [/imóveis|imoveis/i, 4],
    [/venda/i, 3],
    [/buscar|busca/i, 2],
    [/residencial/i, 2],
  ];
  // Penalizar links claramente off-topic
  const NEGATIVE: RegExp[] = [
    /\/blog|\/noticias|\/sobre|\/contato|\/equipe|\/parceiros|\/trabalhe|\/login|\/cadastro/i,
  ];

  let bestUrl: string | null = null;
  let bestScore = -1;

  for (const { texto, url } of links) {
    let score = 0;
    let path = "";
    try { path = new URL(url).pathname; } catch { continue; }

    for (const [re, pts] of PATH_KEYWORDS) if (re.test(path)) score += pts;
    for (const [re, pts] of TEXT_KEYWORDS) if (re.test(texto)) score += pts;
    for (const re of NEGATIVE) if (re.test(path)) score -= 10;

    if (score > bestScore) { bestScore = score; bestUrl = url; }
  }

  if (bestScore >= 4) {
    console.log(`[crawler] Programático identificou URL de listagem (score ${bestScore}): ${bestUrl}`);
    return bestUrl;
  }
  return null;
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

    // Passo 3a: heurística programática (sem LLM) — rápida e sem custo
    if (links.length > 0) {
      const urlProg = identificarUrlListagemProgramaticamente(links, baseUrl);
      if (urlProg) {
        console.log(`[crawler] Programático identificou URL de listagem: ${urlProg}`);
        return urlProg;
      }
    }

    // Passo 3b: LLM como fallback se heurística não encontrou
    if (links.length > 0) {
      const urlLLM = await identificarUrlListagemViaLLM(links, baseUrl).catch(() => null);
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

// ─── Enriquecimento via páginas de detalhe ───────────────────────────────────

// Gemini Flash: 15 RPM free tier → 5 concurrent para margem de segurança
const LLM_CONCURRENCY = 5;
const DETAIL_TIMEOUT_MS = 10_000;
const DETAIL_MAX_TIME_MS = 240_000; // 4 min budget para enriquecimento

/**
 * Enriquece imóveis buscando suas páginas de detalhe.
 *
 * Estratégia em 2 camadas:
 * 1. LLM (Jina Markdown → Gemini Flash) — universal, entende qualquer site
 * 2. Fallback: parseDetailPage (CSS heurístico) — se LLM falhar ou env var ausente
 *
 * Concurrency limitada a 5 para respeitar Gemini Flash free tier (15 RPM).
 */
async function enriquecerComDetalhes(imoveis: ImovelInput[]): Promise<void> {
  // Filtra itens que precisam de enriquecimento (sem preço OU sem quartos OU sem bairro)
  const precisam = imoveis.filter(i => !i.preco || !i.quartos || !i.bairro);
  if (precisam.length === 0) {
    console.log(`[enrich] Todos os imóveis já têm preço/quartos/bairro — pulando enriquecimento`);
    return;
  }

  const usarLLM = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!usarLLM) {
    console.warn(`[enrich] GOOGLE_GENERATIVE_AI_API_KEY não configurada — usando apenas fallback heurístico`);
  }

  // Limita a 200 itens para não demorar demais
  const aEnriquecer = precisam.slice(0, 200);
  console.log(`[enrich] ${aEnriquecer.length}/${imoveis.length} imóveis incompletos — modo: ${usarLLM ? 'LLM (Gemini Flash)' : 'heurístico'}`);
  const startTime = Date.now();
  let enriched = 0;
  let processed = 0;
  let errors = 0;
  const concurrency = usarLLM ? LLM_CONCURRENCY : 10;

  // Processa em batches
  for (let i = 0; i < aEnriquecer.length; i += concurrency) {
    // Verifica time budget
    if (Date.now() - startTime > DETAIL_MAX_TIME_MS) {
      console.log(`[enrich] Time budget esgotado (${Math.round((Date.now() - startTime) / 1000)}s) — ${processed} processados, ${enriched} enriquecidos`);
      break;
    }

    const batch = aEnriquecer.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        try {
          let details: Partial<ImovelInput>;

          if (usarLLM) {
            // Camada 1: LLM (Jina Markdown → Gemini Flash)
            details = await extrairDadosViaLLM(item.urlAnuncio);
          } else {
            // Fallback: fetch direto + parseDetailPage heurístico
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
            const res = await fetch(item.urlAnuncio, {
              headers: DEFAULT_HEADERS as Record<string, string>,
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            const html = await res.text();
            details = parseDetailPage(html, item.urlAnuncio);
          }

          return { item, details };
        } catch {
          return null;
        }
      })
    );

    for (const r of results) {
      processed++;
      if (r.status !== "fulfilled" || !r.value) { errors++; continue; }
      const { item, details } = r.value;

      // Merge: só preenche campos que estão null/vazios
      if (details.preco && !item.preco) item.preco = details.preco;
      if (details.titulo && !item.titulo) item.titulo = details.titulo;
      if (details.tipo && !item.tipo) item.tipo = details.tipo;
      if (details.quartos && !item.quartos) item.quartos = details.quartos;
      if (details.banheiros && !item.banheiros) item.banheiros = details.banheiros;
      if (details.vagas && !item.vagas) item.vagas = details.vagas;
      if (details.areaM2 && !item.areaM2) item.areaM2 = details.areaM2;
      if (details.cidade && !item.cidade) item.cidade = details.cidade;
      if (details.bairro && !item.bairro) item.bairro = details.bairro;
      if (details.estado && !item.estado) item.estado = details.estado;
      if (details.descricao && !item.descricao) {
        (item as Record<string, unknown>).descricao = details.descricao;
      }
      if (details.imagens && details.imagens.length > (item.imagens?.length || 0)) {
        item.imagens = details.imagens;
      }

      if (details.preco || details.quartos || details.bairro) enriched++;
    }

    // Log de progresso
    if (processed % 20 === 0 || i + concurrency >= aEnriquecer.length) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[enrich] Progresso: ${processed}/${aEnriquecer.length} processados, ${enriched} enriquecidos, ${errors} erros (${elapsed}s)`);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[enrich] Finalizado: ${enriched}/${processed} enriquecidos em ${elapsed}s`);
}

export async function crawlFonte(
  fonte: { id: string; url: string; cidade?: string | null; estado?: string | null }
): Promise<ImovelInput[]> {
  const todosImoveis: ImovelInput[] = [];
  const urlsVistas = new Set<string>();

  // ─── Estratégia 1: Sitemap (mais confiável para sites Next.js/React CSR) ───
  const sitemapEntries = await extrairUrlsDeSitemap(fonte.url);
  if (sitemapEntries.length >= 5) {
    console.log(`[crawler] Sitemap: ${sitemapEntries.length} imóveis encontrados — usando sitemap como fonte`);
    for (const entry of sitemapEntries) {
      const meta = extrairMetadadosDeUrl(entry.url);
      todosImoveis.push({
        urlAnuncio: entry.url,
        titulo: null,
        tipo: meta.tipo || null,
        cidade: meta.cidade || fonte.cidade || null,
        bairro: meta.bairro || null,
        estado: fonte.estado || null,
        preco: null,
        areaM2: null,
        quartos: null,
        banheiros: null,
        vagas: null,
        imagens: entry.imagem ? [entry.imagem] : [],
      });
    }

    // Enriquece com dados da listing page (preço, quartos, etc. se houver cards SSR)
    try {
      const urlListagem = await resolverUrlListagem(fonte.url);
      const listingHtml = await fetchPage(urlListagem);
      if (listingHtml) {
        const listingItems = parseHeuristico(listingHtml, urlListagem);
        if (listingItems.length > 0) {
          const enrichMap = new Map(listingItems.map(i => [i.urlAnuncio, i]));
          console.log(`[crawler] Enriquecendo sitemap com ${enrichMap.size} items da listing page`);
          for (let i = 0; i < todosImoveis.length; i++) {
            const enriched = enrichMap.get(todosImoveis[i].urlAnuncio);
            if (enriched) {
              todosImoveis[i] = {
                ...todosImoveis[i],
                titulo: enriched.titulo || todosImoveis[i].titulo,
                tipo: enriched.tipo || todosImoveis[i].tipo,
                bairro: enriched.bairro || todosImoveis[i].bairro,
                cidade: enriched.cidade || todosImoveis[i].cidade,
                estado: enriched.estado || todosImoveis[i].estado,
                preco: enriched.preco || todosImoveis[i].preco,
                areaM2: enriched.areaM2 || todosImoveis[i].areaM2,
                quartos: enriched.quartos || todosImoveis[i].quartos,
                banheiros: enriched.banheiros || todosImoveis[i].banheiros,
                vagas: enriched.vagas || todosImoveis[i].vagas,
                imagens: enriched.imagens?.length ? enriched.imagens : todosImoveis[i].imagens,
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[crawler] Falha ao enriquecer sitemap com listing:`, err);
    }

    const deduplicados = Array.from(
      new Map(todosImoveis.map((i) => [i.urlAnuncio, i])).values()
    );

    // Enriquece com páginas de detalhe (preço, quartos, etc.)
    await enriquecerComDetalhes(deduplicados);

    console.log(`[crawler] Crawl finalizado (sitemap): ${deduplicados.length} imóveis únicos de ${fonte.url}`);
    return deduplicados;
  }

  // ─── Estratégia 2: Listing page loop (padrão para sites SSR) ───
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

    // Para páginas Next.js/Nuxt, os <a> dos cards são injetados client-side pelo React.
    // Se o SSR HTML não tem links de detalhe, busca a versão renderizada via Jina.
    let renderedHtml: string | undefined;
    if (/__NEXT_DATA__|__NUXT__/.test(html)) {
      const domLinks = extrairUrlsDetalheDoDOM(html, paginaAtual);
      if (domLinks.length === 0) {
        console.log(`[crawler] Next.js sem links no DOM — buscando versão renderizada via Jina`);
        renderedHtml = await fetchViaJinaRendered(paginaAtual) ?? undefined;
        console.log(`[crawler] renderedHtml: ${renderedHtml ? renderedHtml.length + " chars" : "falhou"}`);
      }
    }

    // Detecta plataforma na primeira página
    const plataforma = pagina === 1 ? detectarPlataforma(fonte.url, html) : detectarPlataforma(fonte.url, "");

    // Extrai imóveis com o parser correto
    let imoveisPagina: ImovelInput[];
    if (plataforma === "tecimob") {
      imoveisPagina = parseTecimob(html, paginaAtual);
    } else if (plataforma === "jetimob") {
      imoveisPagina = parseJetimob(html, paginaAtual);
    } else {
      imoveisPagina = await parseGeneric(html, paginaAtual, renderedHtml);
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

  // Enriquece com páginas de detalhe (preço, quartos, etc.)
  await enriquecerComDetalhes(deduplicados);

  console.log(`[crawler] Crawl finalizado: ${deduplicados.length} imóveis únicos de ${fonte.url}`);
  return deduplicados;
}
