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
  "[class*='card-imovel']",
  "[class*='card-property']",
  "[class*='resultado']",
  "[class*='item-']",
  "[class*='-item']",
].join(", ");

// Padrões de URL que indicam uma página de detalhe de imóvel
const LISTING_PATH_RE =
  /\/(imovel|property|venda|aluguel|residencial|comercial|casa|apartamento|terreno|lote)[\/-]|\/\d+[\/-]|\/[a-z]+-\d+/i;

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

  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();

    if (!/R\$\s*[\d.,]+/.test(text)) return;
    // Evita duplicar cards (pai contendo filho já adicionado)
    if (vistos.has(text.slice(0, 80))) return;
    vistos.add(text.slice(0, 80));

    const snippet = $.html($el).slice(0, 1200);
    cards.push(snippet);
  });

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

const ImovelSchema = z.object({
  imoveis: z.array(
    z.object({
      urlAnuncio: z
        .string()
        .describe(
          "URL absoluta do anúncio individual. NUNCA use a URL da homepage."
        ),
      titulo: z.string().optional(),
      tipo: z.enum(["apartamento", "casa", "terreno", "comercial", "outro"]).optional(),
      cidade: z.string().optional(),
      bairro: z.string().optional(),
      estado: z.string().optional().describe("Sigla do estado, ex: RS, SP"),
      preco: z.number().optional().describe("Apenas o número inteiro, sem R$"),
      areaM2: z.number().optional().describe("Apenas o número, sem m²"),
      quartos: z.number().int().optional(),
      banheiros: z.number().int().optional(),
      vagas: z.number().int().optional(),
      imagens: z.array(z.string()).optional(),
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
- urlAnuncio: URL absoluta do link individual do imóvel (ex: /imovel/123 → ${baseUrl}imovel/123). NUNCA use "${baseUrl}" sozinho
- preco: apenas o número inteiro (450000, NÃO "R$ 450.000")
- areaM2: apenas o número (120, NÃO "120 m²")
- quartos/banheiros/vagas: apenas o número inteiro
- imagens: URLs absolutas das imagens (src ou data-src de <img>)
- Omita campos não encontrados

HTML DOS CARDS:
${cardsHtml}`,
      });

      const mapped = object.imoveis
        .filter(
          (item) =>
            item.urlAnuncio &&
            item.urlAnuncio !== baseUrl &&
            item.urlAnuncio !== baseUrl.replace(/\/$/, "")
        )
        .map((item) => ({
          urlAnuncio: toAbsoluteUrl(item.urlAnuncio, baseUrl),
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

async function parseLLMPaginaCompleta(html: string, baseUrl: string): Promise<ImovelInput[]> {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, svg, noscript").remove();
  const reducedHtml = $.html().slice(0, 18_000);

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: ImovelSchema,
      prompt: `Você é um extrator de dados de sites de imobiliárias brasileiras.
Analise o HTML abaixo e extraia TODOS os imóveis listados na página do site ${baseUrl}.

REGRAS:
- urlAnuncio: URL absoluta do link individual (NUNCA "${baseUrl}" sozinho)
- preco: apenas o número inteiro (450000, NÃO "R$ 450.000")
- areaM2: apenas o número em m²
- Omita campos não encontrados

HTML:
${reducedHtml}`,
    });

    return object.imoveis
      .filter((item) => item.urlAnuncio && item.urlAnuncio !== baseUrl)
      .map((item) => ({
        urlAnuncio: toAbsoluteUrl(item.urlAnuncio, baseUrl),
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
    console.error("[parseLLM] Falha na extração da página completa:", err);
    return [];
  }
}


