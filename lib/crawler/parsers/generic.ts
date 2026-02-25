import * as cheerio from "cheerio";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import * as z from "zod";
import type { ImovelInput } from "@/lib/db/queries";
import { normalizePreco, normalizeArea, normalizeInt, toAbsoluteUrl } from "./utils";
import { normalizeTipo, parseEndereco } from "./tecimob";

// ─── Heurísticas HTML ─────────────────────────────────────────────────────────

/**
 * Parser genérico: tenta extrair imóveis de qualquer site via heurísticas.
 * Se a heurística retornar < 3 imóveis, escala para extração via LLM.
 */
export async function parseGeneric(
  html: string,
  baseUrl: string
): Promise<ImovelInput[]> {
  const heuristic = parseHeuristico(html, baseUrl);
  if (heuristic.length >= 3) return heuristic;

  // Fallback: LLM analisa o HTML (truncado para economizar tokens)
  const llmResults = await parseLLM(html, baseUrl);
  return llmResults.length > 0 ? llmResults : heuristic;
}

export function parseHeuristico(html: string, baseUrl: string): ImovelInput[] {
  const $ = cheerio.load(html);
  const imoveis: ImovelInput[] = [];

  // Tenta seletores genéricos comuns em CMS de imobiliárias brasileiras
  const possiveisCards = [
    "article",
    "[class*='imovel']",
    "[class*='property']",
    "[class*='listing']",
    "[class*='card']",
    ".resultado",
    ".item-resultado",
  ].join(", ");

  const allCandidates = $(possiveisCards).toArray();

  for (const el of allCandidates) {
    const $el = $(el);
    const text = $el.text();

    // Precisa ter padrão de preço para ser considerado card de imóvel
    const precoMatch = text.match(/R\$\s*[\d.,]+/i);
    if (!precoMatch) continue;

    const $link = $el.find("a[href]").first();
    const href = $link.attr("href") || "";
    if (!href) continue;

    const urlAnuncio = toAbsoluteUrl(href, baseUrl);

    const titulo =
      $el.find("h1, h2, h3, [class*='title'], [class*='titulo']").first().text().trim() ||
      null;

    const tipoRaw =
      $el.find("[class*='tipo'], [class*='type'], [class*='categoria']").first().text().toLowerCase() ||
      "";
    const tipo = normalizeTipo(tipoRaw) || normalizeTipo(titulo || "");

    const enderecoText =
      $el.find("[class*='endereco'], [class*='address'], [class*='bairro']").first().text().trim() ||
      "";
    const { bairro, cidade, estado } = parseEndereco(enderecoText);

    const preco = normalizePreco(precoMatch[0]);

    const areaText = $el.find("[class*='area'], [class*='m2']").first().text();
    const quartosText = $el.find("[class*='quarto'], [class*='dorm'], [class*='bedroom']").first().text();
    const banheirosText = $el.find("[class*='banheiro'], [class*='bath']").first().text();
    const vagasText = $el.find("[class*='vaga'], [class*='garagem']").first().text();

    const imagens: string[] = [];
    $el.find("img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src") || "";
      if (src.includes("http") && !src.includes("placeholder")) {
        imagens.push(src);
      }
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
  }

  // Deduplica por URL
  return Array.from(new Map(imoveis.map((i) => [i.urlAnuncio, i])).values());
}

// ─── Fallback LLM ─────────────────────────────────────────────────────────────

const ImovelSchema = z.object({
  imoveis: z.array(
    z.object({
      urlAnuncio: z.string(),
      titulo: z.string().optional(),
      tipo: z.enum(["apartamento", "casa", "terreno", "comercial"]).optional(),
      cidade: z.string().optional(),
      bairro: z.string().optional(),
      estado: z.string().optional(),
      preco: z.number().optional(),
      areaM2: z.number().optional(),
      quartos: z.number().optional(),
      banheiros: z.number().optional(),
      vagas: z.number().optional(),
    })
  ),
});

async function parseLLM(html: string, baseUrl: string): Promise<ImovelInput[]> {
  // Extrai apenas o texto e links relevantes para reduzir tokens
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  const reducedHtml = $.html().slice(0, 15_000); // max ~15k chars

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: ImovelSchema,
      prompt: `Você é um extrator de dados de sites de imobiliárias brasileiras.
Analise o HTML abaixo e extraia todos os imóveis listados.
Para cada imóvel, extraia: URL do anúncio (absoluta, use "${baseUrl}" como base para URLs relativas), título, tipo (apartamento/casa/terreno/comercial), cidade, bairro, estado, preço (apenas o número), área em m², quartos, banheiros e vagas de garagem.

HTML:
${reducedHtml}`,
    });

    return object.imoveis.map((item) => ({
      urlAnuncio: toAbsoluteUrl(item.urlAnuncio, baseUrl),
      titulo: item.titulo || null,
      tipo: item.tipo || null,
      cidade: item.cidade || null,
      bairro: item.bairro || null,
      estado: item.estado || null,
      preco: item.preco || null,
      areaM2: item.areaM2 || null,
      quartos: item.quartos || null,
      banheiros: item.banheiros || null,
      vagas: item.vagas || null,
    }));
  } catch (err) {
    console.error("[parseLLM] Falha na extração via LLM:", err);
    return [];
  }
}
