import * as cheerio from "cheerio";
import type { ImovelInput } from "@/lib/db/queries";
import { normalizePreco, normalizeArea, normalizeInt } from "./utils";

/**
 * Parser para sites na plataforma Tecimob.
 * Seletores baseados no HTML padrão gerado pelo Tecimob CMS.
 */
export function parseTecimob(html: string, baseUrl: string): ImovelInput[] {
  const $ = cheerio.load(html);
  const imoveis: ImovelInput[] = [];

  // Tecimob usa .property-item ou .imovel-item dependendo do template
  const cards = $(".property-item, .imovel-item, [data-property-id], .listing-item");

  cards.each((_, el) => {
    const $el = $(el);

    // URL do anúncio
    const href =
      $el.find("a[href]").first().attr("href") ||
      $el.closest("a").attr("href") ||
      "";
    if (!href) return;

    const urlAnuncio = href.startsWith("http")
      ? href
      : new URL(href, baseUrl).toString();

    // Título / endereço
    const titulo =
      $el.find(".property-title, .imovel-title, h2, h3").first().text().trim() ||
      // fallback: combina tipo + bairro
      `${$el.find(".property-type, .imovel-tipo").text().trim()} ${$el.find(".property-address, .imovel-endereco, .neighborhood").text().trim()}`.trim() ||
      null;

    // Preço
    const precoText = $el
      .find(".property-price, .imovel-preco, .price, [class*='preco'], [class*='price']")
      .first()
      .text();
    const preco = normalizePreco(precoText);

    // Tipo
    const tipoRaw = $el
      .find(".property-type, .imovel-tipo, [class*='tipo'], [class*='type']")
      .first()
      .text()
      .toLowerCase()
      .trim();
    const tipo = normalizeTipo(tipoRaw) || normalizeTipo(titulo || "");

    // Localização
    const enderecoText = $el
      .find(".property-address, .imovel-endereco, address, [class*='address'], [class*='endereco']")
      .first()
      .text()
      .trim();
    const { bairro, cidade, estado } = parseEndereco(enderecoText);

    // Características
    const areaText = $el
      .find("[class*='area'], [class*='m2'], [class*='metros']")
      .first()
      .text();
    const quartosText = $el
      .find("[class*='quarto'], [class*='dorm'], [class*='bedroom']")
      .first()
      .text();
    const banheirosText = $el
      .find("[class*='banheiro'], [class*='bathroom']")
      .first()
      .text();
    const vagasText = $el
      .find("[class*='vaga'], [class*='garagem'], [class*='garage']")
      .first()
      .text();

    // Imagens
    const imagens: string[] = [];
    $el.find("img[src]").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src") || "";
      if (src && !src.includes("placeholder") && !src.includes("loading")) {
        imagens.push(src.startsWith("http") ? src : new URL(src, baseUrl).toString());
      }
    });

    imoveis.push({
      urlAnuncio,
      titulo: titulo || null,
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

  return imoveis;
}

export function normalizeTipo(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("apartamento") || t.includes("apto")) return "apartamento";
  if (t.includes("casa") || t.includes("sobrado")) return "casa";
  if (t.includes("terreno") || t.includes("lote")) return "terreno";
  if (t.includes("comercial") || t.includes("sala") || t.includes("loja") || t.includes("galpão"))
    return "comercial";
  return null;
}

export function parseEndereco(text: string): {
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
} {
  if (!text) return { bairro: null, cidade: null, estado: null };

  // Padrão comum: "Bairro, Cidade/UF" ou "Bairro - Cidade"
  const parts = text
    .split(/[,\-–]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let bairro: string | null = null;
  let cidade: string | null = null;
  let estado: string | null = null;

  for (const part of parts) {
    const siglaMatch = part.match(/^([A-Za-záàâãéèêíóôõúçÁÀÂÃÉÈÊÍÓÔÕÚÇ\s]+)\s*\/\s*([A-Z]{2})$/);
    if (siglaMatch) {
      cidade = siglaMatch[1].trim();
      estado = siglaMatch[2].trim();
    } else if (!cidade && !bairro) {
      bairro = part;
    } else if (!cidade) {
      cidade = part;
    }
  }

  return { bairro, cidade, estado };
}
