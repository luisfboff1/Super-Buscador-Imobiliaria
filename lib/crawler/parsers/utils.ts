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
  const patterns = [
    // Link rel="next"
    /<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i,
    // Botão/link "Próxima" ou ">"
    /href=["']([^"']+)["'][^>]*>(?:\s*(?:próxima?|next|avançar|&gt;|›|»|>)\s*)</i,
    // Parâmetro de paginação
    /href=["']([^"']*[?&](?:pagina|page|pg|p)=(\d+)[^"']*)["']/gi,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const href = match[1];
      return toAbsoluteUrl(href, baseUrl);
    }
  }

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
