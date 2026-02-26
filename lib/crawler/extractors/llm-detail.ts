/**
 * Extrator universal de dados de imóveis via LLM (OpenAI gpt-4o-mini).
 *
 * Fluxo:
 * 1. Busca a página via Jina AI em modo Markdown (limpo, sem HTML)
 * 2. Envia o markdown para gpt-4o-mini via AI SDK generateObject()
 * 3. Retorna dados estruturados validados por Zod schema
 *
 * Benefícios vs parseDetailPage (CSS heurístico):
 * - Funciona em qualquer site sem adaptação manual
 * - Entende contexto semântico (ex: "3 dorms" → quartos: 3)
 * - Não quebra com mudanças de layout
 *
 * Custos: gpt-4o-mini (~$0.15/1M input, $0.60/1M output) ≈ R$0,05 por crawl de 200 imóveis
 * Rate limits: 200k TPM, 500 RPM (Tier 1)
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { ImovelInput } from "@/lib/db/queries";
import { parseDetailPage } from "@/lib/crawler/parsers/generic";

// ─── Zod schema para extração estruturada ─────────────────────────────────────
// OpenAI json_schema exige todos os campos como required — usamos nullable sem optional

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
});

// ─── Jina Markdown fetch ───────────────────────────────────────────────────────

const JINA_TIMEOUT_MS = 60_000;

/**
 * Busca página via Jina AI em modo Markdown.
 * Retorna texto Markdown limpo, ideal para LLM (sem HTML/CSS/JS).
 */
async function fetchMarkdownViaJina(url: string): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/markdown",
        "X-Return-Format": "markdown",
        "X-Remove-Selector": "header, footer, nav, script, style, .cookie-banner",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(
        `[llm-extract] Jina markdown falhou: ${url} → HTTP ${res.status}`
      );
      return null;
    }

    const md = await res.text();
    console.log(
      `[llm-extract] Jina markdown OK: ${url} (${md.length} chars)`
    );

    // Limpa markdown excessivo (limita a ~8k chars para economizar tokens)
    return md.length > 8000 ? md.slice(0, 8000) : md;
  } catch (err) {
    console.error(`[llm-extract] Jina markdown erro: ${url}`, err);
    return null;
  }
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um extrator de dados de imóveis do mercado imobiliário brasileiro.
Analise o conteúdo da página de um anúncio de imóvel e extraia os dados estruturados.

Regras:
- Retorne APENAS dados que estejam explicitamente na página. Não invente.
- Se um campo não estiver presente, retorne null.
- Preço deve ser o valor de VENDA (não aluguel/condomínio), apenas número inteiro sem centavos.
- Estado deve ser a sigla de 2 letras (RS, SP, SC, etc).
- Tipo deve ser uma das opções: casa, apartamento, terreno, comercial, rural, cobertura, kitnet, sobrado, flat, loft, galpao, sala, loja, outro.
- Área em m² deve ser número (ex: 120.5).
- Descrição: limite a 500 caracteres, resumindo se necessário.`;

/**
 * Extrai dados de um imóvel via LLM (OpenAI gpt-4o-mini).
 *
 * Fluxo: Jina Markdown → gpt-4o-mini → Zod validated object
 * Fallback: parseDetailPage (heurístico CSS) se LLM falhar
 */
export async function extrairDadosViaLLM(
  url: string,
  htmlFallback?: string
): Promise<Partial<ImovelInput>> {
  // 1. Busca markdown via Jina
  const markdown = await fetchMarkdownViaJina(url);

  if (!markdown || markdown.length < 200) {
    console.warn(
      `[llm-extract] Markdown insuficiente para ${url} (${markdown?.length ?? 0} chars) — pulando LLM`
    );
    if (htmlFallback) {
      return parseDetailPage(htmlFallback, url);
    }
    return {};
  }

  // 2. Extrai via gpt-4o-mini (Chat Completions — /v1/chat/completions)
  try {
    const { object } = await generateObject({
      model: openai.chat("gpt-4o-mini"),
      schema: ImovelSchema,
      system: SYSTEM_PROMPT,
      prompt: `Extraia os dados do imóvel desta página:\n\nURL: ${url}\n\n${markdown}`,
      temperature: 0,
    });

    const result: Partial<ImovelInput> = {};

    if (object.titulo) result.titulo = object.titulo;
    if (object.tipo) result.tipo = object.tipo;
    if (object.cidade) result.cidade = object.cidade;
    if (object.bairro) result.bairro = object.bairro;
    if (object.estado) result.estado = object.estado;
    if (object.preco && object.preco > 1000) result.preco = object.preco;
    if (object.areaM2 && object.areaM2 > 0) result.areaM2 = object.areaM2;
    if (object.quartos && object.quartos > 0) result.quartos = object.quartos;
    if (object.banheiros && object.banheiros > 0)
      result.banheiros = object.banheiros;
    if (object.vagas && object.vagas > 0) result.vagas = object.vagas;
    if (object.descricao) result.descricao = object.descricao;

    const fieldsFound = Object.keys(result).length;
    console.log(
      `[llm-extract] OK: ${url} → ${fieldsFound} campos extraídos`
    );

    return result;
  } catch (err) {
    console.error(`[llm-extract] Falhou para ${url}:`, err);

    if (htmlFallback) {
      console.log(`[llm-extract] Usando fallback heurístico para ${url}`);
      return parseDetailPage(htmlFallback, url);
    }
    return {};
  }
}
