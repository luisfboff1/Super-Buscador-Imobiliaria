import * as cheerio from "cheerio";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import * as z from "zod";
import type { ImovelInput } from "@/lib/db/queries";
import { normalizePreco, normalizeArea, normalizeInt, toAbsoluteUrl } from "./utils";
import { normalizeTipo, parseEndereco } from "./tecimob";

// ─── Seletores de cards ───────────────────────────────────────────────────────

const CARD_SELECTORS = [
  "article",
  "[class*='imovel']",
  "[class*='property']",
  "[class*='listing']",
  "[class*='card']",
  "[class*='resultado']",
  "[class*='anuncio']",
  "[class*='item']",
  "[class*='imobi']",
  "li[class]",
].join(", ");

// Padrões de URL que indicam uma página de detalhe de imóvel
const LISTING_PATH_RE =
  /\/(imovel|property|venda|aluguel|residencial|comercial|casa|apartamento|terreno|lote)[\/-]|\/\d+[\/-]|\/[a-z]+-\d+/i;

// Padrões que indicam URLs inválidas (CDN, Cloudflare challenge, tokens, etc.)
const URL_INVALIDA_RE = [
  /cdn-cgi/,           // Cloudflare CDN/challenge
  /\/challenge/,       // páginas de challenge
  /[?&][^=]+=.{50,}/,  // query params com tokens longos (>50 chars)
  /\/[A-Za-z0-9_-]{40,}$/, // paths com hashes/tokens longos no final
  /logout|login|signin|signup|cadastro|conta|perfil|contato|sobre|blog|politica|privacidade/i,
];

/**
 * Verifica se uma URL parece ser uma página de listagem de imóvel válida.
 * Rejeita URLs de CDN, Cloudflare challenge, tokens de segurança, etc.
 */
function isUrlValida(url: string, baseUrl: string): boolean {
  if (!url || !url.startsWith("http")) return false;
  // Deve ser do mesmo domínio
  try {
    const urlHost = new URL(url).hostname;
    const baseHost = new URL(baseUrl).hostname;
    if (urlHost !== baseHost) return false;
  } catch {
    return false;
  }
  // Não pode ser a homepage nem a própria página de listagem
  const urlPath = new URL(url).pathname;
  if (urlPath === "/" || urlPath === "") return false;
  // Rejeita se for igual à baseUrl (a página de listagem em si)
  try {
    const normUrl = new URL(url);
    const normBase = new URL(baseUrl);
    normUrl.search = "";
    normBase.search = "";
    if (normUrl.pathname === normBase.pathname) return false;
  } catch { /* ignora */ }
  // Não pode ter padrões de URL inválida
  for (const re of URL_INVALIDA_RE) {
    if (re.test(url)) return false;
  }
  return true;
}

// ─── Extração de card HTML (heurístico) ──────────────────────────────────────

/**
 * Usa cheerio para encontrar os elementos que parecem cards de imóveis
 * e retorna o HTML de cada um (limitado a ~1200 chars).
 */
function extrairCardHtmls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  $("script, style, svg, noscript").remove();

  const vistos = new Set<string>();
  const cards: string[] = [];

  // Estratégia 1: seletores por nome de classe
  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!/R\$\s*[\d.,]+/.test(text)) return;
    if (vistos.has(text.slice(0, 80))) return;
    vistos.add(text.slice(0, 80));
    cards.push($.html($el).slice(0, 3000));
  });

  if (cards.length >= 2) {
    console.log(`[parseGeneric] ${cards.length} cards via seletores CSS`);
    return cards;
  }

  // Estratégia 2 (fallback): encontra o menor container DOM que contenha R$
  // mas cujos filhos diretos NÃO contenham R$ — o "leaf" do preço = card.
  // Funciona para qualquer estrutura de classes sem hardcode.
  $("div, li, article, section").each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!/R\$\s*[\d.,]+/.test(text)) return;
    if ($el.find("a[href]").length === 0) return;

    // Não é folha se algum filho direto também tem R$
    let filhoTemPreco = false;
    $el.children().each((_, child) => {
      if (/R\$/.test($(child).text())) {
        filhoTemPreco = true;
        return false as unknown as void;
      }
    });
    if (filhoTemPreco) return;

    const key = text.slice(0, 80);
    if (vistos.has(key)) return;
    vistos.add(key);
    cards.push($.html($el).slice(0, 3000));
  });

  console.log(`[parseGeneric] ${cards.length} cards via fallback R$-container`);
  return cards;
}

// ─── Extração de __NEXT_DATA__ / __NUXT__ ────────────────────────────────────

/**
 * Extrai o JSON de __NEXT_DATA__ (Next.js) ou __NUXT__ (Nuxt.js) do HTML.
 * Esses blobs contêm todos os dados de servidor — incluindo URLs dos imóveis —
 * mesmo quando o DOM renderizado não tem links visíveis.
 */
function extrairJsonIsland(html: string): string | null {
  // __NEXT_DATA__
  const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) return nextMatch[1].trim();
  // __NUXT__ / window.__NUXT__
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i);
  if (nuxtMatch) return nuxtMatch[1].trim();
  return null;
}

/**
 * Extrai do HTML renderizado todos os hrefs que parecem páginas de detalhe de imóvel.
 * Funciona para qualquer site — o DOM sempre tem os links mesmo no SSR.
 */
export function extrairUrlsDetalheDoDOM(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const urls = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || href === "#") return;
    const abs = toAbsoluteUrl(href, baseUrl);
    // Deve ser do mesmo domínio e ter path não-trivial
    if (!abs.startsWith(origin)) return;
    const path = new URL(abs).pathname;
    if (path === "/" || path.length < 4) return;
    // Deve parecer uma página de detalhe: tem número no path ou palavra de imóvel
    if (/\/\d{4,}|\/imovel\/|\/property\/|\/venda\/[^-].*\/\d|\/aluguel\/[^-].*\/\d/.test(path)) {
      urls.add(abs);
    }
  });

  return Array.from(urls);
}

/**
 * Detecta o padrão de URL de detalhe do site cruzando IDs do JSON com hrefs do DOM.
 *
 * Estratégia universal — funciona para qualquer site SSR:
 * 1. Coleta todas as URLs de detalhe que aparecem no DOM renderizado
 * 2. Para cada item do JSON, procura um ID/codigo no valor dos campos
 * 3. Procura qual URL do DOM contém esse ID → mapeia item → URL
 * 4. A partir de 2+ pares (id → url), detecta o template: substitui o id por "{ID}"
 * 5. Aplica o template para os itens sem URL encontrada
 *
 * Exemplo para antonellaimoveis:
 *   JSON item: { id: 2439717, ... }
 *   DOM url:   /imoveis/venda/caxias-do-sul/interlagos/-/casa/7762/imovel/2439717
 *   Template:  /imoveis/venda/{CITY}/{HOOD}/-/{TYPE}/{REF}/imovel/{ID}
 *   → mas como cidade/bairro variam, a parte fixa é: "*\/imovel/{ID}"
 */
function detectarPadraoUrlEMapear(
  items: Record<string, unknown>[],
  domUrls: string[],
  baseUrl: string
): Map<Record<string, unknown>, string> {
  const result = new Map<Record<string, unknown>, string>();
  if (domUrls.length === 0) return result;

  // Para cada item, tenta encontrar URL no DOM que contenha o seu id/codigo
  const unmapped: Record<string, unknown>[] = [];

  for (const item of items) {
    const rawId = getField(item, FIELD_ID);
    if (rawId === null) { unmapped.push(item); continue; }
    const idStr = String(rawId);

    // Busca URL no DOM que contenha esse id
    const matched = domUrls.find(u => {
      const path = new URL(u).pathname;
      // O id deve aparecer como segmento completo (entre / ou no final)
      return new RegExp(`(^|\/|=)${idStr}($|\/|\?|#)`).test(path);
    });

    if (matched) {
      result.set(item, matched);
    } else {
      unmapped.push(item);
    }
  }

  console.log(`[parseJSON] Mapeados por ID: ${result.size}/${items.length}`);

  // Fallback posicional: se não mapeou nenhum por ID mas temos DOM URLs suficientes,
  // assume que os primeiros N dom URLs correspondem aos N itens JSON em ordem.
  // Aceita até 2× o número de itens no DOM (header/footer podem ter links extras).
  if (result.size === 0 && domUrls.length >= items.length && domUrls.length <= items.length * 2) {
    console.log(`[parseJSON] Mapeamento posicional: ${items.length} items, ${domUrls.length} DOM URLs → usando primeiros ${items.length}`);
    items.forEach((item, i) => result.set(item, domUrls[i]));
    return result;
  }

  if (unmapped.length === 0 || result.size === 0) return result;

  // Tenta derivar um template a partir dos pares encontrados
  // Verifica se todos os matches têm o id no final do path → padrão simples
  const pairs = Array.from(result.entries());
  const allEndWithId = pairs.every(([item]) => {
    const id = String(getField(item, FIELD_ID));
    const url = result.get(item)!;
    return new URL(url).pathname.endsWith(`/${id}`) || new URL(url).pathname.endsWith(`/${id}/`);
  });

  if (allEndWithId && pairs.length >= 1) {
    // Pega o prefix antes do id da primeira URL mapeada como template fixo
    const [sampleItem, sampleUrl] = pairs[0];
    const sampleId = String(getField(sampleItem, FIELD_ID));
    const samplePath = new URL(sampleUrl).pathname;
    const prefix = samplePath.slice(0, samplePath.lastIndexOf(`/${sampleId}`));
    const origin = new URL(baseUrl).origin;

    console.log(`[parseJSON] Template detectado: ${origin}${prefix}/{ID}`);

    for (const item of unmapped) {
      const rawId = getField(item, FIELD_ID);
      if (rawId !== null) {
        result.set(item, `${origin}${prefix}/${rawId}`);
      }
    }
  }

  return result;
}

function logJsonIslandStructure(jsonText: string): void {
  try {
    const json = JSON.parse(jsonText);
    function findArrays(obj: unknown, path: string, results: { path: string; len: number; keys: string[]; firstItem: unknown }[]): void {
      if (Array.isArray(obj)) {
        if (obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
          results.push({ path, len: obj.length, keys: Object.keys(obj[0] as object), firstItem: obj[0] });
        }
        // Só desce nos arrays de objetos (não em arrays de arrays dentro de arrays grandes)
        if (obj.length <= 50) obj.forEach((item, i) => findArrays(item, `${path}[${i}]`, results));
      } else if (obj && typeof obj === "object") {
        Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => findArrays(v, `${path}.${k}`, results));
      }
    }
    const arrays: { path: string; len: number; keys: string[]; firstItem: unknown; score: number }[] = [];
    const raw: { path: string; len: number; keys: string[]; firstItem: unknown }[] = [];
    findArrays(json, "", raw);

    for (const a of raw) {
      const score = scoreArray(a.keys);
      arrays.push({ ...a, score });
    }
    // Ordena por score desc, depois tamanho desc
    arrays.sort((a, b) => b.score - a.score || b.len - a.len);

    // Mostra todos os arrays com score ≥ 1 ou len ≥ 10 (até 8)
    const interessantes = arrays.filter(a => a.score >= 1 || a.len >= 10).slice(0, 8);
    console.log(`[parseLLM] __NEXT_DATA__ arrays (score≥1 ou len≥10):`);
    interessantes.forEach(a =>
      console.log(`  [score=${a.score}] ${a.path} (${a.len} items) → keys: ${a.keys.slice(0, 15).join(", ")}`)
    );
    // Imprime o primeiro item dos 3 melhores para ver valores reais
    interessantes.slice(0, 3).forEach(a => {
      console.log(`[parseLLM] Primeiro item de ${a.path}:`, JSON.stringify(a.firstItem).slice(0, 500));
    });
  } catch {
    console.log(`[parseLLM] Não foi possível parsear JSON island para log`);
  }
}

// Campos conhecidos por categoria — usados na extração programática
const FIELD_URL    = ["slug", "url", "link", "href", "path", "canonical", "detalhe", "permalink", "url_amigavel", "friendly_url", "link_detalhe"];
const FIELD_PRICE  = ["preco", "price", "valor", "valor_venda", "preco_venda", "preco_total", "venda_valor"];
const FIELD_TYPE   = ["tipo", "type", "categoria", "category", "tipo_imovel"];
const FIELD_ROOMS  = ["dormitorios", "quartos", "bedrooms", "dorms", "suites", "dormitorio", "quarto"];
const FIELD_AREA   = ["area", "aream2", "area_total", "area_util", "area_terreno", "metragem", "m2"];
const FIELD_CITY   = ["cidade", "city", "municipio"];
const FIELD_HOOD   = ["bairro", "neighborhood", "bairro_nome", "district"];
const FIELD_STATE  = ["estado", "state", "uf", "estado_sigla"];
const FIELD_TITLE  = ["titulo", "title", "nome", "name", "empreendimento", "descricao_curta", "titulo_completo"];
const FIELD_PHOTOS = ["fotos", "photos", "imagens", "images", "foto", "photo", "midia", "galeria", "thumbnail", "imagem_principal"];
const FIELD_ID     = ["id", "codigo", "code", "imovel_id", "ref", "referencia"];

function getField(obj: Record<string, unknown>, fields: string[]): unknown {
  for (const f of fields) {
    if (obj[f] !== undefined && obj[f] !== null && obj[f] !== "") return obj[f];
    // tenta camelCase e snake_case parcial
    const found = Object.keys(obj).find(k => k.toLowerCase() === f.toLowerCase());
    if (found && obj[found] !== undefined && obj[found] !== null && obj[found] !== "") return obj[found];
  }
  return null;
}

/** Converte string para slug ASCII sem acentos, ex: "São Luiz" → "sao-luiz" */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Constrói URL sintética de filtro a partir dos campos disponíveis.
 * DEPRECATED: não mais usada — URLs sintéticas não trazem dados reais.
 * Mantida só como referência histórica.
 */
// function construirUrlSintetica(...) { ... } // REMOVIDO

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return v > 0 ? Math.round(v) : null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
    return isNaN(n) || n <= 0 ? null : Math.round(n);
  }
  return null;
}

function coerceStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const src = obj["url"] ?? obj["src"] ?? obj["thumb"] ?? obj["medium"] ?? obj["large"] ?? obj["original"];
        return typeof src === "string" ? src : "";
      }
      return "";
    }).filter(s => s.startsWith("http"));
  }
  if (typeof v === "string" && v.startsWith("http")) return [v];
  return [];
}

/** Pontuação de quão "imobiliária" é um array: conta campos reconhecidos por nome */
function scoreArray(keys: string[]): number {
  const all = [...FIELD_URL, ...FIELD_PRICE, ...FIELD_ROOMS, ...FIELD_AREA, ...FIELD_CITY, ...FIELD_PHOTOS];
  const lower = keys.map(k => k.toLowerCase());
  return all.filter(f => lower.includes(f.toLowerCase())).length;
}

/**
 * Versão ampliada: score por nome + bônus por VALORES do primeiro item.
 * Se um campo tem valor que parece URL (/imovel/, https://, slug), +5.
 */
function scoreArrayWithValues(arr: Record<string, unknown>[]): number {
  if (arr.length === 0) return -1;
  const first = arr[0];
  let score = scoreArray(Object.keys(first));
  // Bônus por valores que parecem URLs de imóvel
  for (const v of Object.values(first)) {
    if (typeof v === "string" && v.length > 3) {
      if (/\/imovel\/|\/property\/|\/listing\/|\/venda\/[a-z]/.test(v)) { score += 8; break; }
      if (/^https?:\/\//i.test(v) && /imovel|property|listing|venda|aluguel/i.test(v)) { score += 6; break; }
      if (/^\/[a-z]/.test(v) && v.length > 10) { score += 2; break; } // path-like slug
    }
    if (typeof v === "number" && v > 100_000) score += 1; // large number → likely price
  }
  return score;
}

/** Encontra recursivamente todos os arrays de objetos no JSON */
function findObjectArrays(obj: unknown, path = ""): { path: string; arr: Record<string, unknown>[] }[] {
  const results: { path: string; arr: Record<string, unknown>[] }[] = [];
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj[0] && typeof obj[0] === "object" && !Array.isArray(obj[0])) {
      results.push({ path, arr: obj as Record<string, unknown>[] });
    }
    obj.slice(0, 3).forEach((item, i) => results.push(...findObjectArrays(item, `${path}[${i}]`)));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      results.push(...findObjectArrays(v, `${path}.${k}`));
    }
  }
  return results;
}

/**
 * Extração PROGRAMÁTICA do JSON island — sem LLM, sem custo, sem falhas de quota.
 * 1. Mapeia campos pelo nome (multi-idioma) — preco, quartos, bairro, fotos, etc.
 * 2. Para URLs: campo direto → cross-reference ID↔DOM href → template → /imovel/{id}
 */
function extrairImoveisDoJsonProgramaticamente(jsonText: string, html: string, baseUrl: string): ImovelInput[] {
  let json: unknown;
  try { json = JSON.parse(jsonText); } catch { return []; }

  const origin = new URL(baseUrl).origin;

  const candidates = findObjectArrays(json);
  candidates.sort((a, b) => {
    const sB = scoreArrayWithValues(b.arr);
    const sA = scoreArrayWithValues(a.arr);
    return sB - sA || b.arr.length - a.arr.length;
  });

  if (candidates.length === 0) return [];

  const best = candidates[0];
  const bestScore = scoreArrayWithValues(best.arr);
  console.log(`[parseJSON] Array escolhido: ${best.path} (${best.arr.length} items, score ${bestScore})`);
  console.log(`[parseJSON] Campos: ${Object.keys(best.arr[0] || {}).join(", ")}`);
  console.log(`[parseJSON] Primeiro item: ${JSON.stringify(best.arr[0]).slice(0, 400)}`);

  // Score mínimo: se < 4 o array provavelmente não é listagem de imóveis
  // (ex: rodapé SEO do Sobressai tem score ~2 com só cidade/bairro/tipo)
  if (bestScore < 4) {
    console.log(`[parseJSON] Score ${bestScore} < 4 → JSON island descartado (dados insuficientes para listagem)`);
    return [];
  }

  // Extrai URLs de detalhe do DOM renderizado para cross-reference
  const domUrls = extrairUrlsDetalheDoDOM(html, baseUrl);
  console.log(`[parseJSON] URLs de detalhe no DOM: ${domUrls.length}`);
  if (domUrls.length === 0) {
    // Debug: mostra primeiros hrefs para diagnosticar por que não achou links
    const allHrefs = Array.from(html.matchAll(/href=["']([^"'#][^"']{3,})["']/gi))
      .map(m => m[1]).filter(h => h.startsWith("/") || h.startsWith("http")).slice(0, 20);
    console.log(`[parseJSON] Primeiros hrefs no HTML (debug): ${allHrefs.join(" | ")}`);
  } else {
    console.log(`[parseJSON] Primeiras URLs: ${domUrls.slice(0, 3).join(" | ")}`);
  }

  // Separa itens com URL direta dos que precisam de inferência
  const semUrlDireta = best.arr.filter(item => !getField(item, FIELD_URL));
  const urlMap = detectarPadraoUrlEMapear(semUrlDireta, domUrls, baseUrl);

  const results: ImovelInput[] = [];

  for (const item of best.arr) {
    let urlAnuncio = "";

    const rawUrl = getField(item, FIELD_URL);
    if (typeof rawUrl === "string" && rawUrl) {
      urlAnuncio = toAbsoluteUrl(rawUrl, baseUrl);
    } else {
      urlAnuncio = urlMap.get(item) ?? "";
      if (!urlAnuncio) {
        const rawId = getField(item, FIELD_ID);
        if (rawId !== null) urlAnuncio = `${origin}/imovel/${rawId}`;
      }
    }

    if (!urlAnuncio || !isUrlValida(urlAnuncio, baseUrl)) {
      // Sem URL válida — impossível salvar este item (DB requer URL única)
      continue;
    }

    let preco = coerceNumber(getField(item, FIELD_PRICE));
    if (!preco) {
      const v = item["venda"] ?? item["valor_venda"];
      const n = coerceNumber(v);
      if (n && n > 1000) preco = n;
    }

    const tipo = normalizeTipo(String(getField(item, FIELD_TYPE) ?? "")) || null;
    const cidade = (getField(item, FIELD_CITY) as string) || null;
    const bairro = (getField(item, FIELD_HOOD) as string) || null;
    const estado = (getField(item, FIELD_STATE) as string) || null;
    const titulo = (getField(item, FIELD_TITLE) as string) || null;
    const areaM2 = coerceNumber(getField(item, FIELD_AREA));
    const quartos = coerceNumber(getField(item, FIELD_ROOMS));
    const banheiros = coerceNumber(getField(item, ["banheiros", "bathrooms", "banheiro", "wc"]));
    const vagas = coerceNumber(getField(item, ["vagas", "garagem", "garage", "parking", "estacionamento"]));
    const imagens = coerceStringArray(getField(item, FIELD_PHOTOS)).slice(0, 5);

    results.push({ urlAnuncio, titulo, tipo, cidade, bairro, estado, preco, areaM2, quartos, banheiros, vagas, imagens });
  }

  return Array.from(new Map(results.map(i => [i.urlAnuncio, i])).values());
}

async function parseLLMComJsonIsland(jsonText: string, html: string, baseUrl: string, renderedHtml?: string): Promise<ImovelInput[]> {
  logJsonIslandStructure(jsonText);

  // Extração programática — sem LLM, sem quota.
  // Usa renderedHtml (Jina) para extração de links do DOM se disponível.
  const programatico = extrairImoveisDoJsonProgramaticamente(jsonText, renderedHtml ?? html, baseUrl);
  if (programatico.length > 0) {
    console.log(`[parseJSON] Extração programática: ${programatico.length} imóveis`);
    return programatico;
  }

  // Programático não encontrou dados úteis no JSON island — descarta e retorna [].
  // parseGeneric vai cair no extrator de cards/heurístico.
  console.log(`[parseJSON] JSON island sem dados de listagem detectáveis — descartando, tentando cards`);
  return [];
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Parser genérico para qualquer site de imobiliária.
 *
 * Estratégia:
 * 0. Se a página tem __NEXT_DATA__ / __NUXT__, usa o JSON direto (mais preciso).
 * 1. Cheerio isola snippets HTML de cada card candidato → LLM.
 * 2. Se cheerio não encontrou cards, LLM recebe a página inteira em chunks.
 * 3. Heurístico puro como último fallback (sem LLM).
 */
export async function parseGeneric(
  html: string,
  baseUrl: string,
  renderedHtml?: string
): Promise<ImovelInput[]> {
  // Passo 0: tenta JSON island (Next.js / Nuxt) — mais preciso que DOM parsing
  const jsonIsland = extrairJsonIsland(html);
  if (jsonIsland) {
    console.log(`[parseGeneric] __NEXT_DATA__ encontrado (${jsonIsland.length} chars) → extração programática`);
    const jsonResults = await parseLLMComJsonIsland(jsonIsland, html, baseUrl, renderedHtml);
    if (jsonResults.length > 0) {
      console.log(`[parseGeneric] JSON island: ${jsonResults.length} imóveis`);
      return jsonResults;
    }
    console.log(`[parseGeneric] JSON island sem listagem útil — tentando extração de cards`);
  }

  // Passo 1: heurístico rápido (sem LLM, sem custo) — funciona bem para SSR
  const heuristicoResults = parseHeuristico(html, baseUrl);
  if (heuristicoResults.length >= 3) {
    console.log(`[parseGeneric] Heurístico: ${heuristicoResults.length} imóveis (sem LLM)`);
    return heuristicoResults;
  }

  // Passo 2: cards CSS → LLM (só quando heurístico não bastou)
  const cards = extrairCardHtmls(html, baseUrl);

  if (cards.length > 0) {
    console.log(`[parseGeneric] Heurístico retornou ${heuristicoResults.length} — tentando ${cards.length} cards → LLM`);
    const llmResults = await parseLLMComCards(cards, baseUrl);
    if (llmResults.length > 0) return llmResults;
  }

  // Fallback 1: página inteira via LLM
  console.log(`[parseGeneric] Nenhum card, tentando LLM na página completa`);
  const fullLlm = await parseLLMPaginaCompleta(html, baseUrl);
  if (fullLlm.length > 0) return fullLlm;

  // Fallback 2: retorna o que o heurístico conseguiu (mesmo que < 3)
  if (heuristicoResults.length > 0) {
    console.log(`[parseGeneric] LLM falhou, retornando ${heuristicoResults.length} do heurístico`);
    return heuristicoResults;
  }

  console.log(`[parseGeneric] Nenhum método extraiu imóveis`);
  return [];
}

// ─── Heurístico rápido (sem LLM) ─────────────────────────────────────────────

export function parseHeuristico(html: string, baseUrl: string): ImovelInput[] {
  const $ = cheerio.load(html);
  const imoveis: ImovelInput[] = [];
  const urlsVistas = new Set<string>();

  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    const text = $el.text();

    const precoMatch = text.match(/R\$\s*[\d.,]+/i);
    if (!precoMatch) return;

    // Prefere links com path de listagem
    let urlAnuncio = "";
    $el.find("a[href]").each((_, a) => {
      const href = $(a).attr("href") || "";
      if (!href || href === "#") return;
      const abs = toAbsoluteUrl(href, baseUrl);
      if (LISTING_PATH_RE.test(abs) && !urlsVistas.has(abs)) {
        urlAnuncio = abs;
        return false; // break
      }
    });
    if (!urlAnuncio) {
      const href = $el.find("a[href]").first().attr("href") || "";
      urlAnuncio = href ? toAbsoluteUrl(href, baseUrl) : "";
    }
    if (!urlAnuncio || urlsVistas.has(urlAnuncio)) return;
    urlsVistas.add(urlAnuncio);

    const tituloRaw =
      $el.find("h1, h2, h3, [class*='title'], [class*='titulo']").first().text();
    const titulo = tituloRaw
      ? tituloRaw.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s*C[oó]digo\s*:.*$/i, '').trim() || null
      : null;
    const tipoRaw = $el
      .find("[class*='tipo'], [class*='type'], [class*='categoria']")
      .first()
      .text()
      .toLowerCase();
    const tipo = normalizeTipo(tipoRaw) || normalizeTipo(titulo || "");

    // Endereço: colapsa whitespace e extrai bairro/cidade
    const cleanCardText = text.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ');
    let enderecoText = $el
      .find("[class*='endereco'], [class*='enderec'], [class*='address'], [class*='bairro'], [class*='location'], [class*='local']")
      .first()
      .text()
      .replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // Se o texto é muito longo, é o card inteiro — descartar
    if (enderecoText.length > 200) enderecoText = '';
    let bairro: string | null = null;
    let cidade: string | null = null;
    let estado: string | null = null;

    // Estratégia 1: labels "Bairro:" / "Cidade:" no texto do card (ex: attuale)
    const bairroLabelMatch = cleanCardText.match(/Bairro\s*:\s*([^,\n]+?)(?=\s{2,}|Cidade\s*:|$)/i);
    const cidadeLabelMatch = cleanCardText.match(/Cidade\s*:\s*([^,\n]+?)(?=\s{2,}|Bairro\s*:|$)/i);
    if (bairroLabelMatch) bairro = bairroLabelMatch[1].trim();
    if (cidadeLabelMatch) cidade = cidadeLabelMatch[1].trim();

    // Estratégia 2: parseEndereco no enderecoText do CSS (se não achou labels)
    if (!bairro && !cidade && enderecoText) {
      ({ bairro, cidade, estado } = parseEndereco(enderecoText));
    }

    // Estratégia 3: padrão "Bairro - Cidade" ou "Bairro, Cidade" no texto
    if (!bairro && !cidade) {
      const locMatch = cleanCardText.match(/([A-ZÀ-Ú][a-záàãâéêíóôõú\s]+(?:\s[Dd][aeo]s?\s[A-ZÀ-Ú][a-záàãâéêíóôõú]+)?)\s*[-–,]\s*([A-ZÀ-Ú][a-záàãâéêíóôõú\s]+)/);
      if (locMatch) {
        ({ bairro, cidade, estado } = parseEndereco(`${locMatch[1]} - ${locMatch[2]}`));
      }
    }
    const preco = normalizePreco(precoMatch[0]);

    // Área e quartos: tenta CSS class primeiro, fallback para ícone, depois regex
    let areaText = $el.find("[class*='area'], [class*='m2'], [class*='metros']").first().text();
    let quartosText = $el
      .find("[class*='quarto'], [class*='dorm'], [class*='bedroom'], [class*='room']")
      .first()
      .text();
    let banheirosText = $el.find("[class*='banheiro'], [class*='bath']").first().text();
    let vagasText = $el
      .find("[class*='vaga'], [class*='garagem'], [class*='garage'], [class*='parking']")
      .first()
      .text();

    // Fallback: ident por ícone (ex: attuale usa <img src='/images/icons/quartos.png'>)
    if (!normalizeInt(quartosText) || !normalizeInt(banheirosText) || !normalizeArea(areaText)) {
      $el.find("li, [class*='item']").each((_, li) => {
        const $li = $(li);
        const iconSrc = $li.find("img").attr("src") || $li.find("img").attr("alt") || "";
        const liText = $li.text().trim();
        if (!liText) return;

        if (/quartos?|dorm/i.test(iconSrc) && !normalizeInt(quartosText)) {
          quartosText = liText;
        } else if (/banheiro/i.test(iconSrc) && !normalizeInt(banheirosText)) {
          banheirosText = liText;
        } else if (/area|\bm2\b|metros/i.test(iconSrc) && !normalizeArea(areaText)) {
          areaText = liText;
        } else if (/vaga|garage/i.test(iconSrc) && !normalizeInt(vagasText)) {
          vagasText = liText;
        }
      });
    }

    // Fallbacks via regex no texto do card
    if (!normalizeArea(areaText)) {
      const m = text.match(/([\d.,]+)\s*m[²2]/i);
      if (m) areaText = `${m[1]} m²`;
    }
    if (!normalizeInt(quartosText)) {
      const m = text.match(/(\d+)\s*(?:dormit[oó]rios?|quartos?|dorms?)/i)
        || text.match(/(?:dormit[oó]rios?|quartos?|dorms?)\s*[:\s]\s*(\d+)/i);
      if (m) quartosText = m[1] || m[0];
    }
    if (!normalizeInt(banheirosText)) {
      const m = text.match(/(\d+)\s*(?:banheiros?|wc)/i)
        || text.match(/(?:banheiros?)\s*[:\s]\s*(\d+)/i);
      if (m) banheirosText = m[1] || m[0];
    }
    if (!normalizeInt(vagasText)) {
      const m = text.match(/(\d+)\s*(?:vagas?|garagem)/i)
        || text.match(/(?:vagas?|garagem)\s*[:\s]\s*(\d+)/i);
      if (m) vagasText = m[1] || m[0];
    }

    const imagens: string[] = [];
    $el.find("img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src") || "";
      if (src && src.startsWith("http") && !src.includes("placeholder")) imagens.push(src);
    });

    imoveis.push({
      urlAnuncio,
      titulo,
      tipo: tipo || null,
      bairro: bairro || null,
      cidade: cidade || null,
      estado: estado || null,
      preco: preco || null,
      areaM2: normalizeArea(areaText) || null,
      quartos: normalizeInt(quartosText) || null,
      banheiros: normalizeInt(banheirosText) || null,
      vagas: normalizeInt(vagasText) || null,
      imagens: imagens.slice(0, 5),
    });
  });

  return Array.from(new Map(imoveis.map((i) => [i.urlAnuncio, i])).values());
}

// ─── Schema LLM ──────────────────────────────────────────────────────────────

// ─── Detail page parser (enriquecimento) ──────────────────────────────────────

/**
 * Extrai dados estruturados de uma página de DETALHE de imóvel.
 * Funciona para qualquer plataforma — tenta __NEXT_DATA__ JSON, depois text/regex.
 * Retorna campos parciais (só o que encontrou) para merge com dados existentes.
 */
export function parseDetailPage(html: string, baseUrl: string): Partial<ImovelInput> {
  const result: Partial<ImovelInput> = {};

  // ─── Estratégia 1: __NEXT_DATA__ (Next.js) ───
  const jsonIsland = extrairJsonIsland(html);
  if (jsonIsland) {
    try {
      const json = JSON.parse(jsonIsland);
      // Procura recursivamente o objeto do imóvel (o que tem preço + tipo + quartos)
      const propertyObj = findPropertyObject(json);
      if (propertyObj) {
        const preco = coerceNumber(getField(propertyObj, FIELD_PRICE));
        if (preco && preco > 1000) result.preco = preco;
        if (!result.preco) {
          const v = propertyObj["venda"] ?? propertyObj["valor_venda"] ?? propertyObj["preco_venda"];
          const n = coerceNumber(v);
          if (n && n > 1000) result.preco = n;
        }
        const tipo = normalizeTipo(String(getField(propertyObj, FIELD_TYPE) ?? ""));
        if (tipo) result.tipo = tipo;
        const quartos = coerceNumber(getField(propertyObj, FIELD_ROOMS));
        if (quartos) result.quartos = quartos;
        const banheiros = coerceNumber(getField(propertyObj, ["banheiros", "bathrooms", "banheiro", "wc"]));
        if (banheiros) result.banheiros = banheiros;
        const vagas = coerceNumber(getField(propertyObj, ["vagas", "garagem", "garage", "parking"]));
        if (vagas) result.vagas = vagas;
        const area = coerceNumber(getField(propertyObj, FIELD_AREA));
        if (area) result.areaM2 = area;
        const titulo = getField(propertyObj, FIELD_TITLE);
        if (typeof titulo === "string" && titulo.length > 3) result.titulo = titulo;
        const cidade = getField(propertyObj, FIELD_CITY);
        if (typeof cidade === "string" && cidade.length > 1) result.cidade = cidade;
        const bairro = getField(propertyObj, FIELD_HOOD);
        if (typeof bairro === "string" && bairro.length > 1) result.bairro = bairro;
        const estado = getField(propertyObj, FIELD_STATE);
        if (typeof estado === "string") result.estado = estado;
        const fotos = coerceStringArray(getField(propertyObj, FIELD_PHOTOS));
        if (fotos.length > 0) result.imagens = fotos.slice(0, 10);

        if (result.preco || result.quartos) {
          return result; // JSON deu dados bons, retorna
        }
      }
    } catch { /* ignora parsing errors */ }
  }

  // ─── Estratégia 2: Cheerio + regex no texto renderizado ───
  const $ = cheerio.load(html);
  const fullText = $("body").text();

  // Preço: "R$ 440.000,00" ou "Venda: R$ 440.000,00"
  if (!result.preco) {
    const precoMatch = fullText.match(/(?:venda|pre[cç]o|valor)[:\s]*R\$\s*([\d.,]+)/i)
      || fullText.match(/R\$\s*([\d.,]+)/i);
    if (precoMatch) {
      const p = normalizePreco(`R$ ${precoMatch[1]}`);
      if (p && p > 1000) result.preco = p;
    }
  }

  // Título: h1
  if (!result.titulo) {
    const h1 = $("h1").first().text().trim();
    if (h1 && h1.length > 5) result.titulo = h1;
  }

  // Características: "Dormitórios: 2", "Banheiros: 1", "Vagas: 2", etc.
  // Padrão key-value em tabelas de características
  if (!result.quartos) {
    const m = fullText.match(/(?:dormit[oó]rios?|quartos?|dorms?)\s*[:\s]\s*(\d+)/i);
    if (m) result.quartos = normalizeInt(m[1]);
  }
  if (!result.banheiros) {
    const m = fullText.match(/(?:banheiros?|wc|lavabos?)\s*[:\s]\s*(\d+)/i);
    if (m) result.banheiros = normalizeInt(m[1]);
  }
  if (!result.vagas) {
    const m = fullText.match(/(?:vagas?|garagem|estacionamento)\s*[:\s]\s*(\d+)/i);
    if (m) result.vagas = normalizeInt(m[1]);
  }
  if (!result.areaM2) {
    const m = fullText.match(/(?:[aá]rea\s*(?:privativa|total|[uú]til)?)\s*[:\s]\s*([\d.,]+)\s*m[²2]/i);
    if (m) result.areaM2 = normalizeArea(`${m[1]} m²`);
  }

  // Tipo do imóvel: "Tipo do Imóvel: Casa" ou do título
  if (!result.tipo) {
    const tipoMatch = fullText.match(/tipo\s*(?:do\s*)?im[oó]vel\s*[:\s]*([a-záàãâéêíóôõú\s]+)/i);
    if (tipoMatch) {
      const t = normalizeTipo(tipoMatch[1].trim());
      if (t) result.tipo = t;
    }
    if (!result.tipo && result.titulo) {
      const t = normalizeTipo(result.titulo);
      if (t) result.tipo = t;
    }
  }

  // Endereço: breadcrumb ou texto com bairro/cidade
  if (!result.bairro || !result.cidade) {
    // Tenta breadcrumb: "Home > Imóveis > Venda > Caxias do Sul > Bela Vista > Casa"
    const breadcrumb = $("nav, [class*='breadcrumb'], [class*='caminho']").first().text();
    if (breadcrumb) {
      const parts = breadcrumb.split(/[>›»/|]/).map(s => s.trim()).filter(s => s.length > 1);
      // Padrão: ..., Cidade, Bairro, Tipo, Código
      const vendaIdx = parts.findIndex(p => /venda|aluguel|comprar/i.test(p));
      if (vendaIdx >= 0 && parts.length > vendaIdx + 2) {
        if (!result.cidade) result.cidade = parts[vendaIdx + 1] || null;
        if (!result.bairro && parts.length > vendaIdx + 2) result.bairro = parts[vendaIdx + 2] || null;
      }
    }

    // Fallback: texto com padrão "Bairro - Cidade"
    if (!result.bairro) {
      const locMatch = fullText.match(/([A-ZÀ-Ú][a-záàãâéêíóôõú\s]+)\s*[-–]\s*([A-ZÀ-Ú][a-záàãâéêíóôõú\s]+)/);
      if (locMatch) {
        const loc = parseEndereco(`${locMatch[1]} - ${locMatch[2]}`);
        if (loc.bairro && !result.bairro) result.bairro = loc.bairro;
        if (loc.cidade && !result.cidade) result.cidade = loc.cidade;
      }
    }
  }

  return result;
}

/**
 * Procura recursivamente no JSON o objeto que representa um imóvel individual.
 * Heurística: objeto com ≥3 campos reconhecidos (preço, tipo, quartos, área, etc.)
 */
function findPropertyObject(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 10) return null;
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    // Não procura em arrays (queremos o objeto único do detalhe, não listas)
    if (obj.length > 20) return null;
    for (const item of obj.slice(0, 5)) {
      const found = findPropertyObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);

  // Pontua: quantos campos reconhecidos este objeto tem?
  const allFields = [...FIELD_PRICE, ...FIELD_ROOMS, ...FIELD_AREA, ...FIELD_TYPE, ...FIELD_CITY, ...FIELD_PHOTOS];
  const lowerKeys = keys.map(k => k.toLowerCase());
  const hits = allFields.filter(f => lowerKeys.includes(f.toLowerCase())).length;

  if (hits >= 3) return record;

  // Recursa em sub-objetos
  for (const v of Object.values(record)) {
    const found = findPropertyObject(v, depth + 1);
    if (found) return found;
  }
  return null;
}

// ─── Schema LLM ──────────────────────────────────────────────────────────────

// OpenAI structured outputs (strict mode) exige que TODOS os campos estejam em
// `required`. Por isso usamos .nullable() em vez de .optional() — o campo é
// obrigatório no schema mas pode ter valor null quando não encontrado.
const ImovelSchema = z.object({
  imoveis: z.array(
    z.object({
      urlAnuncio: z
        .string()
        .describe("URL absoluta do anúncio individual. NUNCA use a URL da homepage."),
      titulo: z.string().nullable().describe("Título do imóvel, ou null"),
      tipo: z
        .enum(["apartamento", "casa", "terreno", "comercial", "outro"])
        .nullable()
        .describe("Tipo do imóvel, ou null se não identificado"),
      cidade: z.string().nullable(),
      bairro: z.string().nullable(),
      estado: z.string().nullable().describe("Sigla do estado, ex: RS, SP, ou null"),
      preco: z.number().nullable().describe("Apenas o número inteiro sem R$, ou null"),
      areaM2: z.number().nullable().describe("Apenas o número em m², ou null"),
      quartos: z.number().int().nullable(),
      banheiros: z.number().int().nullable(),
      vagas: z.number().int().nullable().describe("Vagas de garagem, ou null"),
      imagens: z.array(z.string()).nullable().describe("URLs das imagens, ou null"),
    })
  ),
});

// ─── LLM com batches de cards ────────────────────────────────────────────────

async function parseLLMComCards(cards: string[], baseUrl: string): Promise<ImovelInput[]> {
  const BATCH = 15;
  const resultados: ImovelInput[] = [];

  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    const cardsHtml = batch
      .map((c, idx) => `<!-- CARD ${i + idx + 1} -->\n${c}`)
      .join("\n\n");

    try {
      const { object } = await generateObject({
        model: openai.chat("gpt-4o-mini"),
        schema: ImovelSchema,
        prompt: `Você é um extrator de dados de sites de imobiliárias brasileiras.
Abaixo estão fragmentos HTML de cards de listagem do site ${baseUrl}.

REGRAS:
- urlAnuncio: URL absoluta do link individual do imóvel — use EXATAMENTE o href encontrado no HTML do card (ex: href="/imovel/1296982/nome" → ${new URL(baseUrl).origin}/imovel/1296982/nome)
- Se o href do card não existir ou for ambiguo, use null para urlAnuncio (NÃO invente URLs)
- urlAnuncio: IGNORE links de CDN (cdn-cgi), Cloudflare challenge, rastreadores, login, contato, ou qualquer URL que não seja a página do imóvel
- preco: apenas o número inteiro (450000, NÃO "R$ 450.000")
- areaM2: apenas o número (120, NÃO "120 m²")
- quartos/banheiros/vagas: apenas o número inteiro
- imagens: URLs absolutas das imagens (src ou data-src de <img>)
- Omita campos não encontrados

HTML DOS CARDS:
${cardsHtml}`,
      });

      const mapped = object.imoveis
        .map((item) => ({
          ...item,
          urlAnuncio: toAbsoluteUrl(item.urlAnuncio, baseUrl),
        }))
        .filter((item) => isUrlValida(item.urlAnuncio, baseUrl))
        .map((item) => ({
          urlAnuncio: item.urlAnuncio,
          titulo: item.titulo || null,
          tipo: item.tipo === "outro" ? null : (item.tipo || null),
          cidade: item.cidade || null,
          bairro: item.bairro || null,
          estado: item.estado || null,
          preco: item.preco || null,
          areaM2: item.areaM2 || null,
          quartos: item.quartos || null,
          banheiros: item.banheiros || null,
          vagas: item.vagas || null,
          imagens: (item.imagens || []).slice(0, 5),
        }));

      resultados.push(...mapped);
    } catch (err) {
      console.error(`[parseLLM] Falha no batch ${Math.floor(i / BATCH) + 1}:`, err);
    }
  }

  return Array.from(new Map(resultados.map((i) => [i.urlAnuncio, i])).values());
}

// ─── LLM com página completa ─────────────────────────────────────────────────

const CHUNK_SIZE = 32_000;

function normalizarHtmlParaLLM(html: string): string {
  const $ = cheerio.load(html);
  // Remove scripts externos e inline JS (mas PRESERVA <script type="application/json">
  // e scripts com __NEXT_DATA__ / __NUXT__ que contêm os dados dos imóveis)
  $("script").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") || "").toLowerCase();
    const id = $el.attr("id") || "";
    const content = $el.html() || "";
    const isDataIsland =
      type === "application/json" ||
      type === "application/ld+json" ||
      id === "__NEXT_DATA__" ||
      content.includes("__NUXT__");
    if (!isDataIsland) $el.remove();
  });
  $("style, nav, footer, header, svg, noscript, iframe, video, audio").remove();
  // Remove atributos prolixos
  $("[style]").removeAttr("style");
  $("*").each((_, el) => {
    const attrs = Object.keys(("attribs" in el ? el.attribs : null) || {});
    attrs.forEach((attr) => {
      if (attr.startsWith("data-v-") || attr === "data-reactid" || attr === "data-gatsby")
        $(el).removeAttr(attr);
    });
  });
  // Remove data: URIs das imagens
  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src.startsWith("data:")) $(el).removeAttr("src");
  });
  return $.html();
}

async function parseLLMChunk(chunk: string, baseUrl: string): Promise<ImovelInput[]> {
  try {
    const { object } = await generateObject({
      model: openai.chat("gpt-4o-mini"),
      schema: ImovelSchema,
      prompt: `Você é um extrator de dados de sites de imobiliárias brasileiras.
Analise o HTML abaixo e extraia TODOS os imóveis listados na página do site ${baseUrl}.

REGRAS:
- urlAnuncio: use EXATAMENTE o href do link do imóvel encontrado no HTML — NÃO invente URLs nem use "${baseUrl}" sozinho
- urlAnuncio: IGNORE cdn-cgi, Cloudflare challenge, rastreadores, login, contato; se não encontrar URL real use null
- preco: apenas o número inteiro (450000, NÃO "R$ 450.000")
- areaM2: apenas o número em m²
- Se os dados estiverem em JSON (ex: __NEXT_DATA__), extraia desses campos JSON
- Omita campos não encontrados

HTML:
${chunk}`,
    });

    return object.imoveis
      .map((item) => ({
        ...item,
        urlAnuncio: toAbsoluteUrl(item.urlAnuncio, baseUrl),
      }))
      .filter((item) => isUrlValida(item.urlAnuncio, baseUrl))
      .map((item) => ({
        urlAnuncio: item.urlAnuncio,
        titulo: item.titulo || null,
        tipo: item.tipo === "outro" ? null : (item.tipo || null),
        cidade: item.cidade || null,
        bairro: item.bairro || null,
        estado: item.estado || null,
        preco: item.preco || null,
        areaM2: item.areaM2 || null,
        quartos: item.quartos || null,
        banheiros: item.banheiros || null,
        vagas: item.vagas || null,
        imagens: (item.imagens || []).slice(0, 5),
      }));
  } catch (err) {
    console.error("[parseLLM] Falha no chunk:", err);
    return [];
  }
}

async function parseLLMPaginaCompleta(html: string, baseUrl: string): Promise<ImovelInput[]> {
  const cleanHtml = normalizarHtmlParaLLM(html);
  console.log(`[parseLLM] HTML limpo: ${cleanHtml.length} chars`);

  // Se cabe num chunk só, faz uma chamada
  if (cleanHtml.length <= CHUNK_SIZE) {
    return parseLLMChunk(cleanHtml, baseUrl);
  }

  // Divide em chunks quebrando em tag-boundary (próximo \n ou </) sem cortar tags
  const chunks: string[] = [];
  let pos = 0;
  while (pos < cleanHtml.length) {
    let end = Math.min(pos + CHUNK_SIZE, cleanHtml.length);
    // Recua até a próxima quebra de tag para não cortar no meio
    if (end < cleanHtml.length) {
      const tagBreak = cleanHtml.lastIndexOf("</", end);
      if (tagBreak > pos) end = tagBreak;
    }
    chunks.push(cleanHtml.slice(pos, end));
    pos = end;
  }

  console.log(`[parseLLM] HTML grande (${cleanHtml.length} chars) → ${chunks.length} chunks em paralelo`);

  const resultsPorChunk = await Promise.all(chunks.map((c) => parseLLMChunk(c, baseUrl)));
  const todos = resultsPorChunk.flat();
  return Array.from(new Map(todos.map((i) => [i.urlAnuncio, i])).values());
}


