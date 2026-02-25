import * as cheerio from "cheerio";
import type { ImovelInput } from "@/lib/db/queries";
import { normalizePreco, normalizeArea, normalizeInt, toAbsoluteUrl } from "./utils";
import { normalizeTipo, parseEndereco } from "./tecimob";

/**
 * Parser para sites na plataforma Jetimob.
 */
export function parseJetimob(html: string, baseUrl: string): ImovelInput[] {
  const $ = cheerio.load(html);
  const imoveis: ImovelInput[] = [];

  // Jetimob usa seletores como .property-block, .listing-property, .card-property
  const cards = $(".property-block, .listing-property, .card-property, .imovel-card, [class*='property-card']");

  cards.each((_, el) => {
    const $el = $(el);

    // URL do anúncio — link principal do card
    const $link = $el.find("a[href]").first();
    const href = $link.attr("href") || $el.closest("a").attr("href") || "";
    if (!href) return;
    const urlAnuncio = toAbsoluteUrl(href, baseUrl);

    // Título
    const titulo =
      $el.find(".property-title, .imovel-titulo, h2, h3, [class*='title']").first().text().trim() ||
      null;

    // Preço
    const precoText = $el
      .find(".property-price, .valor, .preco, [class*='price'], [class*='valor']")
      .first()
      .text();
    const preco = normalizePreco(precoText);

    // Tipo (pode estar no título ou num badge)
    const tipoRaw = $el
      .find(".property-type, .tipo, [class*='type'], [class*='tipo']")
      .first()
      .text()
      .toLowerCase()
      .trim();
    const tipo = normalizeTipo(tipoRaw) || normalizeTipo(titulo || "");

    // Endereço
    const enderecoText = $el
      .find(".property-address, .endereco, address, [class*='address'], [class*='bairro']")
      .first()
      .text()
      .trim();
    const { bairro, cidade, estado } = parseEndereco(enderecoText);

    // Características — Jetimob usa ícones com spans
    const areaText = $el.find("[class*='area'], [class*='m2'], [title*='m²']").first().text();
    const quartosText = $el.find("[class*='quarto'], [class*='dorm'], [title*='quarto'], [title*='dormitório']").first().text();
    const banheirosText = $el.find("[class*='banheiro'], [class*='bath']").first().text();
    const vagasText = $el.find("[class*='vaga'], [class*='garagem'], [class*='garage']").first().text();

    // Imagens
    const imagens: string[] = [];
    $el.find("img").each((_, img) => {
      const src =
        $(img).attr("src") ||
        $(img).attr("data-src") ||
        $(img).attr("data-lazy") ||
        "";
      if (src && src.includes("http") && !src.includes("placeholder")) {
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
  });

  return imoveis;
}
