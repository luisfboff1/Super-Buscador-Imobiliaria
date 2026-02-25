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
  // Não pode ser a homepage em si
  const urlPath = new URL(url).pathname;
  if (urlPath === "/" || urlPath === "") return false;
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

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Parser genérico para qualquer site de imobiliária.
 *
 * Estratégia:
 * 1. Cheerio isola snippets HTML de cada card candidato.
 * 2. LLM recebe esses snippets em batches → extração estruturada de alta qualidade.
 * 3. Se cheerio não encontrou cards, LLM recebe a página inteira (truncada).
 * 4. Heurístico puro como último fallback (sem LLM).
 */
export async function parseGeneric(
  html: string,
  baseUrl: string
): Promise<ImovelInput[]> {
  const cards = extrairCardHtmls(html, baseUrl);

  if (cards.length > 0) {
    console.log(`[parseGeneric] ${cards.length} cards → LLM`);
    const llmResults = await parseLLMComCards(cards, baseUrl);
    if (llmResults.length > 0) return llmResults;
  }

  // Fallback 1: página inteira via LLM
  console.log(`[parseGeneric] Nenhum card, tentando LLM na página completa`);
  const fullLlm = await parseLLMPaginaCompleta(html, baseUrl);
  if (fullLlm.length > 0) return fullLlm;

  // Fallback 2: heurístico puro
  console.log(`[parseGeneric] LLM falhou, usando heurístico puro`);
  return parseHeuristico(html, baseUrl);
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

    const titulo =
      $el.find("h1, h2, h3, [class*='title'], [class*='titulo']").first().text().trim() || null;
    const tipoRaw = $el
      .find("[class*='tipo'], [class*='type'], [class*='categoria']")
      .first()
      .text()
      .toLowerCase();
    const tipo = normalizeTipo(tipoRaw) || normalizeTipo(titulo || "");
    const enderecoText = $el
      .find("[class*='endereco'], [class*='address'], [class*='bairro'], [class*='location']")
      .first()
      .text()
      .trim();
    const { bairro, cidade, estado } = parseEndereco(enderecoText);
    const preco = normalizePreco(precoMatch[0]);
    const areaText = $el.find("[class*='area'], [class*='m2'], [class*='metros']").first().text();
    const quartosText = $el
      .find("[class*='quarto'], [class*='dorm'], [class*='bedroom']")
      .first()
      .text();
    const banheirosText = $el.find("[class*='banheiro'], [class*='bath']").first().text();
    const vagasText = $el
      .find("[class*='vaga'], [class*='garagem'], [class*='garage']")
      .first()
      .text();

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
        model: openai("gpt-4o-mini"),
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
      model: openai("gpt-4o-mini"),
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


