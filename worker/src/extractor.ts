/**
 * Extrator de dados de imóveis via LLM (Groq — Llama 3 70B).
 *
 * Recebe HTML bruto, limpa para texto essencial, e extrai dados estruturados
 * via generateObject() do AI SDK com schema Zod.
 *
 * Groq free tier: 30 RPM, 14.4k tokens/min (Llama 3 70B)
 */

import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { ImovelInput } from "./db.js";

// ─── Zod schema para extração estruturada ─────────────────────────────────────

const ImovelSchema = z.object({
  titulo: z
    .string()
    .nullable()
    .describe("Título ou nome do anúncio do imóvel"),
  tipo: z
    .enum([
      "casa",
      "apartamento",
      "terreno",
      "comercial",
      "rural",
      "cobertura",
      "kitnet",
      "sobrado",
      "flat",
      "loft",
      "galpao",
      "sala",
      "loja",
      "outro",
    ])
    .nullable()
    .describe("Tipo do imóvel"),
  transacao: z
    .enum(["venda", "aluguel", "ambos"])
    .nullable()
    .describe("Tipo de transação: venda, aluguel ou ambos"),
  cidade: z
    .string()
    .nullable()
    .describe("Cidade onde o imóvel está localizado"),
  bairro: z
    .string()
    .nullable()
    .describe("Bairro onde o imóvel está localizado"),
  estado: z
    .string()
    .nullable()
    .describe("Sigla do estado (ex: RS, SP, SC). Sempre 2 letras maiúsculas."),
  preco: z
    .number()
    .nullable()
    .describe(
      "Preço de venda do imóvel em reais (apenas número, sem centavos). Se houver mais de um valor, use o de VENDA."
    ),
  areaM2: z
    .number()
    .nullable()
    .describe("Área do imóvel em metros quadrados"),
  quartos: z
    .number()
    .int()
    .nullable()
    .describe("Número de quartos/dormitórios"),
  banheiros: z
    .number()
    .int()
    .nullable()
    .describe("Número de banheiros"),
  vagas: z
    .number()
    .int()
    .nullable()
    .describe("Número de vagas de garagem/estacionamento"),
  descricao: z
    .string()
    .nullable()
    .describe("Descrição do imóvel (máximo 500 caracteres)"),
  imagens: z
    .array(z.string())
    .describe("URLs das imagens do imóvel encontradas na página"),
});

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um extrator de dados de imóveis do mercado imobiliário brasileiro.
Analise o conteúdo da página de um anúncio de imóvel e extraia os dados estruturados.

Regras:
- Retorne APENAS dados que estejam explicitamente na página. Não invente.
- Se um campo não estiver presente, retorne null.
- Preço deve ser o valor de VENDA (não aluguel/condomínio), apenas número inteiro sem centavos.
- Estado deve ser a sigla de 2 letras (RS, SP, SC, etc).
- Tipo deve ser uma das opções: casa, apartamento, terreno, comercial, rural, cobertura, kitnet, sobrado, flat, loft, galpao, sala, loja, outro.
- Área em m² deve ser número (ex: 120.5).
- Descrição: limite a 500 caracteres, resumindo se necessário.
- transacao: identifique se o imóvel é para "venda", "aluguel" ou "ambos".
- imagens: extraia URLs de imagens do imóvel (não logos, ícones ou banners).`;

// ─── HTML → texto limpo ──────────────────────────────────────────────────────

function htmlToCleanText(html: string): string {
  const $ = cheerio.load(html);

  // Remover elementos desnecessários
  $("script, style, nav, header, footer, .cookie-banner, iframe, noscript").remove();

  // Extrair imagens antes de converter para texto
  const imgUrls: string[] = [];
  $("img").each((_, el) => {
    const src =
      $(el).attr("src") ||
      $(el).attr("data-src") ||
      $(el).attr("data-lazy-src");
    if (
      src &&
      src.startsWith("http") &&
      !src.includes("logo") &&
      !src.includes("icon") &&
      !src.includes("banner")
    ) {
      imgUrls.push(src);
    }
  });

  // OG images
  $('meta[property="og:image"]').each((_, el) => {
    const content = $(el).attr("content");
    if (content && content.startsWith("http")) imgUrls.push(content);
  });

  // Converter para texto
  let text = $("body").text();

  // Limpar whitespace excessivo
  text = text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Adicionar imagens encontradas ao final
  if (imgUrls.length > 0) {
    const uniqueImgs = [...new Set(imgUrls)].slice(0, 20);
    text += "\n\n[IMAGENS ENCONTRADAS]\n" + uniqueImgs.join("\n");
  }

  // Limitar a ~6000 chars para ficar dentro dos limites de tokens do Groq
  if (text.length > 6000) {
    text = text.slice(0, 6000);
  }

  return text;
}

// ─── Extração via LLM ────────────────────────────────────────────────────────

export async function extractPropertyData(
  html: string,
  url: string
): Promise<ImovelInput | null> {
  const cleanText = htmlToCleanText(html);

  if (cleanText.length < 100) {
    console.log(`[extractor] texto muito curto para ${url} (${cleanText.length} chars)`);
    return null;
  }

  try {
    const { object } = await generateObject({
      model: groq("llama-3.1-8b-instant"),
      schema: ImovelSchema,
      system: SYSTEM_PROMPT,
      prompt: `Extraia os dados do imóvel desta página:\n\nURL: ${url}\n\n${cleanText}`,
      temperature: 0,
    });

    // Montar resultado
    const result: ImovelInput = {
      urlAnuncio: url,
      titulo: object.titulo ?? null,
      tipo: object.tipo ?? null,
      cidade: object.cidade ?? null,
      bairro: object.bairro ?? null,
      estado: object.estado ?? null,
      preco: object.preco && object.preco > 1000 ? object.preco : null,
      areaM2: object.areaM2 && object.areaM2 > 0 ? object.areaM2 : null,
      quartos: object.quartos && object.quartos > 0 ? object.quartos : null,
      banheiros:
        object.banheiros && object.banheiros > 0 ? object.banheiros : null,
      vagas: object.vagas && object.vagas > 0 ? object.vagas : null,
      descricao: object.descricao ?? null,
      imagens: object.imagens ?? [],
    };

    // Adicionar transacao como campo extra para filtro de aluguel
    (result as Record<string, unknown>).transacao = object.transacao;

    const fieldsFound = Object.values(result).filter(
      (v) => v !== null && v !== undefined && v !== ""
    ).length;
    console.log(
      `[extractor] ✓ ${url} → ${fieldsFound} campos (transacao: ${object.transacao})`
    );

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[extractor] ✗ ${url}: ${msg}`);
    return null;
  }
}
