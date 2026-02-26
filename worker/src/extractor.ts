/**
 * Extrator de dados de imóveis.
 *
 * Estratégia em cascata:
 * 1. JSON-LD  — dados estruturados embutidos pela própria imobiliária (grátis, perfeito)
 * 2. LLM      — Groq llama-3.1-8b-instant analisa o HTML limpo e extrai tudo
 *
 * Cheerio é usado APENAS para imagens (URLs, não precisa de raciocínio).
 */

import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { ImovelInput } from "./db.js";

// ─── Zod schema para extração estruturada ────────────────────────────────────

const ImovelSchema = z.object({
  titulo: z.string().nullable().describe("Título do anúncio do imóvel"),
  tipo: z
    .enum(["casa", "apartamento", "terreno", "comercial", "rural", "cobertura", "kitnet", "sobrado", "flat", "loft", "galpao", "sala", "loja", "outro"])
    .nullable()
    .describe("Tipo do imóvel"),
  transacao: z
    .enum(["venda", "aluguel", "ambos"])
    .nullable()
    .describe("venda, aluguel ou ambos"),
  cidade: z.string().nullable().describe("Cidade onde o imóvel está localizado"),
  bairro: z.string().nullable().describe("Bairro onde o imóvel está localizado"),
  estado: z.string().nullable().describe("Sigla do estado com 2 letras maiúsculas (ex: RS, SP)"),
  preco: z.number().nullable().describe("Preço de VENDA em reais, apenas número inteiro"),
  areaM2: z.number().nullable().describe("Área total em metros quadrados"),
  quartos: z.number().int().nullable().describe("Número de quartos/dormitórios"),
  banheiros: z.number().int().nullable().describe("Número de banheiros"),
  vagas: z.number().int().nullable().describe("Número de vagas de garagem"),
  descricao: z.string().nullable().describe("Descrição resumida do imóvel, máximo 500 caracteres"),
});

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um extrator de dados de imóveis do mercado imobiliário brasileiro.
Analise o conteúdo da página e extraia os dados do imóvel anunciado.

Regras:
- Retorne APENAS dados explicitamente presentes na página. Não invente valores.
- Se um campo não estiver na página, retorne null.
- Preço deve ser o valor de VENDA (ignorar valores de aluguel/condomínio/IPTU).
- Estado deve ser a sigla com 2 letras (RS, SP, SC, MG, etc).
- Descrição: máximo 500 caracteres, resumindo o texto principal do anúncio.
- transacao: "venda" se está sendo vendido, "aluguel" se está sendo alugado, "ambos" se tiver os dois.`;

// ─── 1. Extração de imagens via Cheerio ──────────────────────────────────────

export function extractImages(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();

  // Imagens do conteúdo principal
  $("img").each((_, el) => {
    const src =
      $(el).attr("src") ||
      $(el).attr("data-src") ||
      $(el).attr("data-lazy-src") ||
      $(el).attr("data-original");
    if (src && src.startsWith("http") && !src.match(/logo|icon|banner|avatar|sprite/i)) {
      urls.add(src);
    }
  });

  // Open Graph
  $('meta[property="og:image"]').each((_, el) => {
    const content = $(el).attr("content");
    if (content?.startsWith("http")) urls.add(content);
  });

  return [...urls].slice(0, 30);
}

// ─── 2. Extração via JSON-LD (grátis, sem LLM) ───────────────────────────────

export function extractFromJsonLd(html: string, url: string): ImovelInput | null {
  const $ = cheerio.load(html);
  const results: ImovelInput[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const data = JSON.parse(raw);

      // Pode ser array ou objeto único
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const type = (item["@type"] || "").toLowerCase();
        if (!type.includes("realestate") && !type.includes("residence") &&
            !type.includes("house") && !type.includes("apartment") &&
            !type.includes("property") && !type.includes("product")) continue;

        const preco =
          item.offers?.price ??
          item.price ??
          item.offers?.lowPrice ??
          null;

        const result: ImovelInput = {
          urlAnuncio: url,
          titulo: item.name ?? item.headline ?? null,
          descricao: item.description?.slice(0, 500) ?? null,
          cidade:
            item.address?.addressLocality ??
            item.locationCreated?.addressLocality ??
            null,
          bairro:
            item.address?.addressRegion?.split(",")[0]?.trim() ??
            item.address?.streetAddress ??
            null,
          estado:
            item.address?.addressRegion?.slice(-2).toUpperCase() ??
            null,
          preco: preco ? parseFloat(String(preco)) || null : null,
          areaM2: item.floorSize?.value ?? item.floorSize ?? null,
          quartos: item.numberOfRooms ?? item.numberOfBedrooms ?? null,
          banheiros: item.numberOfBathroomsTotal ?? item.numberOfBathrooms ?? null,
          vagas: item.numberOfParkingSpaces ?? null,
          imagens: [],
        };

        if (result.titulo || result.preco) results.push(result);
      }
    } catch {
      // JSON inválido, ignorar
    }
  });

  return results[0] ?? null;
}

// ─── 3. HTML → texto limpo para o LLM ────────────────────────────────────────

function htmlToCleanText(html: string): string {
  const $ = cheerio.load(html);

  // Remover ruído que não ajuda o LLM
  $("script, style, iframe, noscript, svg, [class*='cookie'], [class*='popup'], [id*='modal']").remove();
  $("nav, header, footer").remove();

  // Converter para texto mantendo estrutura semântica mínima
  let text = $("body").text();
  text = text.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Limitar tokens (~6000 chars ≈ 1500 tokens para modelo 8B)
  if (text.length > 6000) text = text.slice(0, 6000);

  return text;
}

// Guia do schema em texto para incluir no prompt
const SCHEMA_GUIDE = `{
  "titulo": "string|null — título do anúncio",
  "tipo": "casa|apartamento|terreno|comercial|rural|cobertura|kitnet|sobrado|flat|loft|galpao|sala|loja|outro|null",
  "transacao": "venda|aluguel|ambos|null",
  "cidade": "string|null",
  "bairro": "string|null",
  "estado": "string|null — sigla 2 letras maiúsculas (RS, SP, SC...)",
  "preco": "number|null — valor de VENDA em reais, sem centavos",
  "areaM2": "number|null",
  "quartos": "integer|null",
  "banheiros": "integer|null",
  "vagas": "integer|null",
  "descricao": "string|null — máximo 500 caracteres"
}`;

// ─── 4. Extração via LLM ─────────────────────────────────────────────────────

export async function extractPropertyData(
  html: string,
  url: string
): Promise<ImovelInput | null> {
  const cleanText = htmlToCleanText(html);

  if (cleanText.length < 100) {
    console.log(`[extractor] texto muito curto para ${url}`);
    return null;
  }

  try {
    // generateText com instrução de JSON — funciona em 100% dos modelos Groq
    const { text } = await generateText({
      model: groq("llama-3.1-8b-instant"),
      system: SYSTEM_PROMPT + `\n\nResponda APENAS com um objeto JSON válido seguindo este schema:\n${SCHEMA_GUIDE}\nNenhum texto antes ou depois do JSON.`,
      prompt: `URL: ${url}\n\n${cleanText}`,
      temperature: 0,
    });

    // Extrair JSON da resposta (pode vir com ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[extractor] ✗ sem JSON na resposta — ${url}`);
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]);
    const parsed = ImovelSchema.safeParse(raw);
    const data = parsed.success ? parsed.data : raw;

    const result: ImovelInput = {
      urlAnuncio: url,
      titulo: data.titulo ?? null,
      tipo: data.tipo ?? null,
      cidade: data.cidade ?? null,
      bairro: data.bairro ?? null,
      estado: data.estado ?? null,
      preco: data.preco && data.preco > 1000 ? data.preco : null,
      areaM2: data.areaM2 && data.areaM2 > 0 ? data.areaM2 : null,
      quartos: data.quartos && data.quartos > 0 ? data.quartos : null,
      banheiros: data.banheiros && data.banheiros > 0 ? data.banheiros : null,
      vagas: data.vagas && data.vagas > 0 ? data.vagas : null,
      descricao: data.descricao ?? null,
      imagens: [],
    };

    // Campo extra para filtro de aluguel em scrapePropertyPage
    (result as Record<string, unknown>).transacao = data.transacao ?? null;

    console.log(`[extractor] ✓ [llm] ${result.titulo ?? url} — R$${result.preco?.toLocaleString("pt-BR") ?? "?"} — ${result.bairro ?? "?"}`);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[extractor] ✗ ${url}: ${msg}`);
    return null;
  }
}
