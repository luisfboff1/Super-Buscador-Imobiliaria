import * as cheerio from "cheerio";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import * as z from "zod";

export interface ImobiliariaCRECI {
  nome: string;
  cnpj?: string | null;
  cidade: string;
  estado: string;
  url: string | null;
  creci?: string | null;
}

const FETCH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

// ─── Scraper CRECI-RS ─────────────────────────────────────────────────────────

/**
 * Busca imobiliárias registradas no CRECI-RS para uma determinada cidade.
 * Tenta múltiplas URLs de pesquisa do site do CRECI-RS.
 */
export async function extractCreciRS(
  cidade: string
): Promise<ImobiliariaCRECI[]> {
  const cidadeEncoded = encodeURIComponent(cidade);

  // Possíveis endpoints do CRECI-RS para busca de imobiliárias
  const endpoints = [
    `https://www.creci-rs.gov.br/buscar-imobiliarias?cidade=${cidadeEncoded}`,
    `https://www.creci-rs.gov.br/imobiliarias?cidade=${cidadeEncoded}&estado=RS`,
    `https://www.creci-rs.gov.br/imobiliaria/pesquisar?cidade=${cidadeEncoded}`,
    `https://www.creci-rs.gov.br/pesquisa-imobiliaria?municipio=${cidadeEncoded}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS });
      if (!res.ok) continue;
      const html = await res.text();
      const imobiliarias = parseCreciHTML(html, cidade);
      if (imobiliarias.length > 0) {
        return await enriquecerComURLs(imobiliarias);
      }
    } catch {
      continue;
    }
  }

  // Se não conseguiu scraping direto, usa AI para buscar via web search
  console.log(`[creci] Scraping direto falhou para "${cidade}", usando AI web search`);
  return buscarCreciViaIA(cidade);
}

/**
 * Faz parse do HTML do CRECI para extrair a lista de imobiliárias.
 */
function parseCreciHTML(html: string, cidade: string): ImobiliariaCRECI[] {
  const $ = cheerio.load(html);
  const imobiliarias: ImobiliariaCRECI[] = [];

  // Tenta diferentes padrões de tabelas/listas do CRECI-RS
  // Padrão 1: tabela com colunas de nome, cidade, CRECI
  $("table tr, .resultado-item, .imobiliaria-item, [class*='resultado']").each((_, el) => {
    const $el = $(el);
    const cells = $el.find("td");

    if (cells.length >= 2) {
      const nome = cells.eq(0).text().trim() || cells.eq(1).text().trim();
      if (!nome || nome.length < 3) return;

      // Busca URL — pode estar como link ou texto
      const href = cells.find("a[href]").attr("href") || "";
      const url =
        href.startsWith("http") ? href :
        isWebUrl(cells.text()) ? extractUrl(cells.text()) : null;

      const creci = cells
        .map((_, td) => $(td).text().trim())
        .get()
        .find((t) => /J-\d+/i.test(t)) || null;

      imobiliarias.push({
        nome,
        cidade,
        estado: "RS",
        url,
        creci: typeof creci === "string" ? creci : null,
      });
    }
  });

  return imobiliarias;
}

function isWebUrl(text: string): boolean {
  return /https?:\/\/|\.com\.br|\.com\.br/i.test(text);
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s,;)]+/i);
  return match ? match[0] : null;
}

// ─── Serper.dev (Google Search API) ──────────────────────────────────────────

interface SerperOrganic {
  title: string;
  link: string;
  snippet: string;
}

async function serperSearch(query: string): Promise<SerperOrganic[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "br", hl: "pt", num: 20 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { organic?: SerperOrganic[] };
    return data.organic ?? [];
  } catch {
    return [];
  }
}

// ─── Enriquecer com URLs ───────────────────────────────────────────────────────

/**
 * Para imobiliárias sem URL, usa OpenAI (gpt-4o-mini) para descobrir o site.
 */
async function enriquecerComURLs(
  imobiliarias: ImobiliariaCRECI[]
): Promise<ImobiliariaCRECI[]> {
  const semUrl = imobiliarias.filter((i) => !i.url);
  const comUrl = imobiliarias.filter((i) => !!i.url);

  // Processa em lotes de 5 para não sobrecarregar a API
  const BATCH = 5;
  const enriquecidas: ImobiliariaCRECI[] = [];

  for (let i = 0; i < semUrl.length; i += BATCH) {
    const lote = semUrl.slice(i, i + BATCH);
    const resultados = await Promise.allSettled(
      lote.map((imob) => buscarUrlImobiliaria(imob.nome, imob.cidade))
    );
    resultados.forEach((res, idx) => {
      enriquecidas.push({
        ...lote[idx],
        url: res.status === "fulfilled" ? res.value : null,
      });
    });
  }

  return [...comUrl, ...enriquecidas];
}

/**
 * Descobre o site de uma imobiliária.
 * Estratégia:  1) Serper (Google Search) — resultados reais
 *              2) gpt-4o-mini — conhecimento de treinamento (fallback)
 */
export async function buscarUrlImobiliaria(
  nome: string,
  cidade: string
): Promise<string | null> {
  // 1. Tenta via Serper (Google real)
  const resultados = await serperSearch(`"${nome}" imobiliária ${cidade} RS site oficial`);
  for (const r of resultados) {
    const url = r.link;
    if (!url || url.includes("facebook") || url.includes("instagram") || url.includes("linkedin")) continue;
    // Valida que o site está acessível
    if (await validarUrl(url)) return url;
  }

  // 2. Fallback: gpt-4o-mini (baseado em treinamento — pode não refletir o atual)
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `Qual é o site oficial (URL com https://) da imobiliária "${nome}" em ${cidade}/RS, Brasil? Responda APENAS a URL. Se não souber com certeza, responda "desconhecido".`,
    });
    const url = text.trim();
    if (!url || url === "desconhecido" || !url.startsWith("http")) return null;
    if (await validarUrl(url)) return url;
    return null;
  } catch {
    return null;
  }
}

async function validarUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Busca via AI/Serper quando scraping CRECI falha ─────────────────────────

/**
 * Quando o scraping CRECI falha:
 *  1) Serper: busca "imobiliárias CRECI {cidade} RS" no Google, extrai nomes+links
 *  2) gpt-4o-mini: usa conhecimento de treinamento para montar lista (fallback)
 */
async function buscarCreciViaIA(cidade: string): Promise<ImobiliariaCRECI[]> {
  // 1. Serper — 3 queries em paralelo para cobrir bem a cidade
  const PORTAIS_BLOQUEADOS = [
    "facebook.com", "instagram.com", "linkedin.com", "twitter.com",
    "olx.com", "vivareal.com", "zapimoveis.com", "imovelweb.com",
    "mercadolivre.com", "imobiliarias.com", "imoveiscaxias.net",
    "creci-rs.gov", "creci.gov", "wikipedia.org", "tiktok.com",
    "youtube.com", "google.com", "yelp.com",
  ];

  // Páginas internas que não são home pages de imobiliárias
  const PATHS_BLOQUEADOS = [
    "/politica", "/privacidade", "/termos", "/contato", "/sobre",
    "/blog", "/noticias", "/imobiliarias?", "/search", "/resultados",
  ];

  const isUrlValida = (url: string) => {
    const lower = url.toLowerCase();
    if (PORTAIS_BLOQUEADOS.some((p) => lower.includes(p))) return false;
    if (PATHS_BLOQUEADOS.some((p) => lower.includes(p))) return false;
    return true;
  };

  const [r1, r2, r3] = await Promise.all([
    serperSearch(`imobiliárias ${cidade} RS`),
    serperSearch(`imobiliária comprar imóvel ${cidade} Rio Grande do Sul`),
    serperSearch(`corretora de imóveis ${cidade} RS`),
  ]);
  const todosResultados = [...r1, ...r2, ...r3];

  if (todosResultados.length > 0) {
    // Deduplica por domínio base
    const dominiosVistos = new Set<string>();
    const imobiliarias: ImobiliariaCRECI[] = [];

    for (const r of todosResultados) {
      if (!isUrlValida(r.link)) continue;
      try {
        const dominio = new URL(r.link).hostname.replace(/^www\./, "");
        if (dominiosVistos.has(dominio)) continue;
        dominiosVistos.add(dominio);

        const nome = r.title
          .replace(/\s*[-–|]\s*(imóveis|imobiliária|imoveis|corretor|RS|Caxias.*)?$/i, "")
          .trim();
        if (nome.length < 3) continue;

        imobiliarias.push({ nome, cidade, estado: "RS", url: r.link, creci: null });
      } catch {
        continue;
      }
    }

    if (imobiliarias.length > 0) {
      console.log(`[creci] Serper retornou ${imobiliarias.length} imobiliárias únicas para "${cidade}"`);
      return imobiliarias;
    }
  }

  // 2. Fallback: gpt-4o-mini (treinamento — pode estar desatualizado)
  if (!process.env.OPENAI_API_KEY) return [];
  console.log(`[creci] Serper sem resultados para "${cidade}", usando gpt-4o-mini (knowledge base)`);

  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `Liste imobiliárias conhecidas em ${cidade}, Rio Grande do Sul, Brasil.
Para cada uma informe nome e site (URL https://). Formato JSON: [{"nome":"...","url":"..."}]
Retorne APENAS o JSON.`,
    });

    // Extrai o JSON da resposta
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      nome?: string;
      url?: string;
      creci?: string;
    }>;

    return parsed
      .filter((i) => i.nome)
      .map((i) => ({
        nome: i.nome!,
        cidade,
        estado: "RS",
        url: i.url?.startsWith("http") ? i.url : null,
        creci: i.creci || null,
      }));
  } catch (err) {
    console.error("[creci] Falha no fallback via IA:", err);
    return [];
  }
}

// ─── Schema de validação ──────────────────────────────────────────────────────

export const ImobiliariaCRECISchema = z.object({
  nome: z.string().min(2),
  cidade: z.string(),
  estado: z.string().default("RS"),
  url: z.string().url().nullable(),
  creci: z.string().nullable().optional(),
});
