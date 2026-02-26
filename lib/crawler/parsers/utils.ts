/**
 * Funções utilitárias de normalização de dados extraídos do HTML.
 */

/** Extrai valor numérico de strings de preço em reais: "R$ 450.000" → 450000 */
export function normalizePreco(text: string): number | null {
  if (!text) return null;
  // Remove R$, pontos de milhar e preserva vírgula como decimal
  const cleaned = text
    .replace(/R\$\s*/gi, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) || num <= 0 ? null : num;
}

/** Extrai m² de string: "120 m²" → 120 */
export function normalizeArea(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.,]+)\s*m[²2]/i);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/\./g, "").replace(",", "."));
  return isNaN(num) || num <= 0 ? null : num;
}

/** Extrai primeiro número inteiro de uma string */
export function normalizeInt(text: string): number | null {
  if (!text) return null;
  const match = text.match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return isNaN(num) || num <= 0 ? null : num;
}

/** Constrói URL absoluta a partir de href relativo */
export function toAbsoluteUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/** Detecta próxima página de paginação no HTML */
export function encontrarProximaPagina(html: string, baseUrl: string): string | null {
  // 1. <link rel="next"> (SEO canonical, mais confiável)
  const relNext =
    html.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']next["']/i);
  if (relNext) return toAbsoluteUrl(relNext[1], baseUrl);

  // 2. Botão/link "Próxima" ou seta
  const nextBtn = html.match(
    /href=["']([^"']+)["'][^>]*>\s*(?:próxima?|next|avançar|&gt;|›|»|>)\s*</i
  );
  if (nextBtn) return toAbsoluteUrl(nextBtn[1], baseUrl);

  // 3. Parâmetro de paginação — usa exec() (não .match() com flag g, que perde grupos de captura)
  // Encontra a página imediatamente seguinte à atual (currentPage + 1)
  const currentPageMatch = baseUrl.match(/[?&](?:pagina|page|pg|p|start|offset)=(\d+)/i);
  const currentPage = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;

  const pageRe = /href=["']([^"']*[?&](?:pagina|page|pg|p|start|offset)=(\d+)[^"']*)["']/gi;
  let bestHref: string | null = null;
  let bestDist = Infinity;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(html)) !== null) {
    const pageNum = parseInt(m[2], 10);
    if (pageNum > currentPage && pageNum - currentPage < bestDist) {
      bestDist = pageNum - currentPage;
      bestHref = m[1];
    }
  }
  if (bestHref) return toAbsoluteUrl(bestHref, baseUrl);

  return null;
}

/** Garante que uma URL de listagem aponte para a página de listagem, não para a home */
export function normalizeUrlListagem(url: string): string {
  const urlObj = new URL(url);
  // Se a URL não tem path além de "/", tenta common listing paths
  if (urlObj.pathname === "/" || urlObj.pathname === "") {
    // Retorna a URL como está — o parser generic vai tentar encontrar a listagem
    return url;
  }
  return url;
}
