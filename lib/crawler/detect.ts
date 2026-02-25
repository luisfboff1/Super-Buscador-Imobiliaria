/**
 * Detecta a plataforma de uma imobiliária com base na URL e no HTML da página.
 */
export type Plataforma = "tecimob" | "jetimob" | "bume" | "imoview" | "generic";

export function detectarPlataforma(url: string, html: string): Plataforma {
  const urlLower = url.toLowerCase();
  const htmlLower = html.toLowerCase();

  // Verificação por domínio da plataforma
  if (urlLower.includes("tecimob.com.br") || htmlLower.includes("tecimob"))
    return "tecimob";
  if (urlLower.includes("jetimob.com") || htmlLower.includes("jetimob"))
    return "jetimob";
  if (urlLower.includes("bume.com.br") || htmlLower.includes("bume.com"))
    return "bume";
  if (urlLower.includes("imoview.com.br") || htmlLower.includes("imoview"))
    return "imoview";

  // Assinaturas no HTML
  if (htmlLower.includes('"generator":"tecimob"') || htmlLower.includes("powered by tecimob"))
    return "tecimob";
  if (htmlLower.includes('"generator":"jetimob"') || htmlLower.includes("powered by jetimob"))
    return "jetimob";

  return "generic";
}
