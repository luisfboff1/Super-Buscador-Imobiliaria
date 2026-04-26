import * as cheerio from "cheerio";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import * as z from "zod";

export interface ImobiliariaCRECI {
  nome: string;
  nomeFantasia?: string | null;
  cnpj?: string | null;
  cidade: string;
  estado: string;
  url: string | null;
  creci?: string | null;
  situacao?: string | null;
}

const CRECI_BASE = "https://www.creci-rs.gov.br/siteNovo/pesquisaInscrito.php";

const FETCH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

// ─── Mapa cidade → ID (cache em memória) ─────────────────────────────────────

let cidadesCache: Record<string, string> | null = null;
let cidadesCachePromise: Promise<Record<string, string>> | null = null;

function normalizeCidade(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function loadCidadesMap(): Promise<Record<string, string>> {
  if (cidadesCache) return cidadesCache;
  if (cidadesCachePromise) return cidadesCachePromise;

  cidadesCachePromise = (async () => {
    const res = await fetch(CRECI_BASE, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      cidadesCachePromise = null;
      throw new Error(`CRECI page returned ${res.status}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const map: Record<string, string> = {};
    $("#cd_cidade option").each((_, el) => {
      const value = $(el).attr("value");
      const label = $(el).text().trim();
      if (!value || value === "0" || !label) return;
      map[normalizeCidade(label)] = value;
    });
    cidadesCache = map;
    return map;
  })();

  return cidadesCachePromise;
}

async function resolverCidadeId(cidade: string): Promise<string | null> {
  const map = await loadCidadesMap();
  const key = normalizeCidade(cidade);
  if (map[key]) return map[key];
  // Tenta variações: "Caxias do Sul" → "caxias", "Caxias" → "caxias do sul"
  const partialMatch = Object.keys(map).find(
    (k) => k.startsWith(key) || k === key.replace(/\s+do\s+sul$/, "")
  );
  return partialMatch ? map[partialMatch] : null;
}

// ─── Scraper CRECI-RS ─────────────────────────────────────────────────────────

export interface ExtractProgress {
  total: number;
  enriched: number;
  imobiliarias: ImobiliariaCRECI[];
}

/**
 * Busca imobiliárias (Pessoa Jurídica) registradas no CRECI-RS para uma cidade.
 * Por padrão retorna apenas as ativas.
 *
 * Opções:
 * - incluirInativas: inclui PJ inativas no resultado.
 * - onProgress: callback chamado a cada batch enriquecido (pra UI/job tracking).
 */
export async function extractCreciRS(
  cidade: string,
  opts: {
    incluirInativas?: boolean;
    onProgress?: (p: ExtractProgress) => void | Promise<void>;
  } = {}
): Promise<ImobiliariaCRECI[]> {
  const cidadeId = await resolverCidadeId(cidade);
  if (!cidadeId) {
    console.warn(`[creci] Cidade "${cidade}" não encontrada no select do CRECI-RS`);
    return [];
  }

  const body = new URLSearchParams({
    acao: "pesquisar",
    busca: "",
    fg_tipo_pessoa: "2", // Pessoa Jurídica
    cd_cidade: cidadeId,
  });

  const res = await fetch(CRECI_BASE, {
    method: "POST",
    headers: {
      ...FETCH_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: CRECI_BASE,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`CRECI search returned ${res.status}`);
  }

  const html = await res.text();
  let imobiliarias = parseCreciTable(html, cidade);

  if (!opts.incluirInativas) {
    imobiliarias = imobiliarias.filter(
      (i) => (i.situacao ?? "").toLowerCase() === "ativo"
    );
  }

  // Emite progresso inicial: encontrou todas mas nenhuma enriquecida
  if (opts.onProgress) {
    await opts.onProgress({
      total: imobiliarias.length,
      enriched: 0,
      imobiliarias,
    });
  }

  return enriquecerComURLs(imobiliarias, opts.onProgress);
}

/**
 * Parser específico da tabela de resultados: <table class="table table-striped">
 * Colunas: Inscrição | Nome (razão social) | Nome Fantasia | Situação | Cidade
 */
function parseCreciTable(html: string, cidade: string): ImobiliariaCRECI[] {
  const $ = cheerio.load(html);
  const out: ImobiliariaCRECI[] = [];

  $("table.table-striped tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 5) return;

    const creci = tds.eq(0).text().trim();
    const nome = tds.eq(1).text().trim();
    const fantasia = tds.eq(2).text().trim();
    const situacao = tds.eq(3).text().trim();
    const cidadeUf = tds.eq(4).text().trim();

    if (!nome || nome.length < 3) return;
    if (!/J/i.test(creci)) return; // só PJ (inscrição termina com "J")

    out.push({
      nome,
      nomeFantasia: fantasia || null,
      creci,
      situacao,
      cidade: cidadeUf.split("/")[0]?.trim() || cidade,
      estado: cidadeUf.split("/")[1]?.trim() || "RS",
      url: null,
    });
  });

  return out;
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
      body: JSON.stringify({ q: query, gl: "br", hl: "pt", num: 10 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { organic?: SerperOrganic[] };
    return data.organic ?? [];
  } catch {
    return [];
  }
}

// ─── Enriquecer com URLs ───────────────────────────────────────────────────────

const PORTAIS_BLOQUEADOS = [
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "olx.com", "vivareal.com", "zapimoveis.com", "imovelweb.com",
  "mercadolivre.com", "imobiliarias.com", "imoveiscaxias.net",
  "creci-rs.gov", "creci.gov", "wikipedia.org", "tiktok.com",
  "youtube.com", "google.com", "yelp.com", "cnpj.biz", "econodata.com",
  "consultacnpj.com", "applocal.com.br", "assimobcaxias.com.br",
  "bolsadeimoveiscaxias.com.br", "olimoveis.com.br",
];

const PATHS_BLOQUEADOS = [
  "/politica", "/privacidade", "/termos", "/contato", "/sobre",
  "/blog", "/noticias", "/imobiliarias?", "/search", "/resultados",
];

function isUrlValida(url: string): boolean {
  const lower = url.toLowerCase();
  if (PORTAIS_BLOQUEADOS.some((p) => lower.includes(p))) return false;
  if (PATHS_BLOQUEADOS.some((p) => lower.includes(p))) return false;
  return true;
}

/**
 * Tokeniza o nome em palavras significativas (ignora termos genéricos).
 */
function nomeTokens(nome: string): string[] {
  const STOPWORDS = new Set([
    "ltda", "me", "epp", "eireli", "sa", "s/a", "imoveis", "imóveis",
    "imobiliaria", "imobiliária", "imobiliarios", "imobiliários",
    "negocios", "negócios", "investimentos", "investimento",
    "empreendimentos", "empreendimento", "administracao", "administração",
    "corretagem", "consultoria", "assessoria", "gestao", "gestão",
    "de", "do", "da", "dos", "das", "e", "&",
  ]);
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Score de quão provável a URL é o site oficial daquela imobiliária.
 * Maior = melhor.
 */
function scoreUrl(url: string, tokens: string[]): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const dominio = host.split(".")[0]; // só o nome principal
    let score = 0;
    for (const t of tokens) {
      if (host.includes(t)) score += 3;
      if (dominio === t) score += 5;
    }
    // Penaliza domínios muito longos com path complexo
    if (url.split("/").length > 5) score -= 1;
    // Bônus pra .com.br
    if (host.endsWith(".com.br")) score += 1;
    return score;
  } catch {
    return -100;
  }
}

async function validarUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(8_000),
      redirect: "follow",
    });
    if (res.ok) return true;
    // Alguns sites bloqueiam HEAD; tenta GET leve
    if (res.status === 405 || res.status === 403) {
      const r2 = await fetch(url, {
        method: "GET",
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(8_000),
      });
      return r2.ok;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Para cada imobiliária, faz múltiplas buscas (razão social, nome fantasia, CRECI),
 * agrega resultados, scorea por similaridade de domínio e valida.
 */
async function enriquecerComURLs(
  imobiliarias: ImobiliariaCRECI[],
  onProgress?: (p: ExtractProgress) => void | Promise<void>
): Promise<ImobiliariaCRECI[]> {
  const semUrl = imobiliarias.filter((i) => !i.url);
  const comUrl = imobiliarias.filter((i) => !!i.url);
  const total = imobiliarias.length;

  const BATCH = 5;
  const enriquecidas: ImobiliariaCRECI[] = [];

  for (let i = 0; i < semUrl.length; i += BATCH) {
    const lote = semUrl.slice(i, i + BATCH);
    const resultados = await Promise.allSettled(
      lote.map((imob) => buscarUrlImobiliaria(imob))
    );
    resultados.forEach((res, idx) => {
      enriquecidas.push({
        ...lote[idx],
        url: res.status === "fulfilled" ? res.value : null,
      });
    });

    if (onProgress) {
      const parcial = [...comUrl, ...enriquecidas];
      await onProgress({
        total,
        enriched: parcial.filter((x) => !!x.url).length,
        imobiliarias: parcial,
      });
    }
  }

  return [...comUrl, ...enriquecidas];
}

/**
 * Estratégia de descoberta de URL:
 *  1) Faz até 3 queries no Serper (nome fantasia + razão social + variantes).
 *  2) Agrega/dedupa resultados, calcula score por similaridade com tokens do nome.
 *  3) Valida o melhor candidato com HTTP HEAD.
 *  4) Fallback gpt-4o-mini se Serper não retornar nada útil.
 */
export async function buscarUrlImobiliaria(
  imob: ImobiliariaCRECI | { nome: string; nomeFantasia?: string | null; cidade: string; creci?: string | null }
): Promise<string | null> {
  const { nome, cidade } = imob;
  const fantasia = (imob as ImobiliariaCRECI).nomeFantasia ?? null;
  const creci = (imob as ImobiliariaCRECI).creci ?? null;

  // Tokens a partir de fantasia (preferencial) ou razão social
  const tokens = nomeTokens(fantasia || nome);
  if (tokens.length === 0) return null;

  const queries: string[] = [];
  if (fantasia) queries.push(`"${fantasia}" imobiliária ${cidade} RS`);
  queries.push(`"${nome}" imobiliária ${cidade} RS site oficial`);
  if (creci) queries.push(`"CRECI ${creci.replace(/\s+/g, "")}" ${cidade}`);

  // Roda em paralelo
  const grupos = await Promise.all(queries.map((q) => serperSearch(q)));
  const todos = grupos.flat();

  // Agrega por domínio único, mantendo o link com melhor score
  const porDominio = new Map<string, { url: string; score: number }>();
  for (const r of todos) {
    if (!r.link || !isUrlValida(r.link)) continue;
    let host: string;
    try {
      host = new URL(r.link).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const score = scoreUrl(r.link, tokens);
    if (score <= 0) continue;
    const existing = porDominio.get(host);
    // Prefere root url do domínio (path mais curto)
    const rootUrl = `https://${host}`;
    const candidate = r.link.replace(/\/$/, "").length > rootUrl.length + 5 ? rootUrl : r.link;
    if (!existing || score > existing.score) {
      porDominio.set(host, { url: candidate, score });
    }
  }

  const ordenados = [...porDominio.values()].sort((a, b) => b.score - a.score);
  for (const c of ordenados.slice(0, 3)) {
    if (await validarUrl(c.url)) return c.url;
  }

  // Fallback: gpt-4o-mini (knowledge base)
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `Qual é o site oficial (URL com https://) da imobiliária${
        fantasia ? ` "${fantasia}"` : ""
      } "${nome}" em ${cidade}/RS, Brasil${
        creci ? ` (CRECI ${creci})` : ""
      }? Responda APENAS a URL. Se não souber com certeza, responda "desconhecido".`,
    });
    const url = text.trim();
    if (!url || url === "desconhecido" || !url.startsWith("http")) return null;
    if (!isUrlValida(url)) return null;
    if (await validarUrl(url)) return url;
    return null;
  } catch {
    return null;
  }
}

// ─── Schema de validação ──────────────────────────────────────────────────────

export const ImobiliariaCRECISchema = z.object({
  nome: z.string().min(2),
  nomeFantasia: z.string().nullable().optional(),
  cidade: z.string(),
  estado: z.string().default("RS"),
  url: z.string().url().nullable(),
  creci: z.string().nullable().optional(),
  situacao: z.string().nullable().optional(),
});
