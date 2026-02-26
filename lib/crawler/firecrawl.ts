import Firecrawl from "@mendable/firecrawl-js";
import type { ImovelInput } from "@/lib/db/queries";

// ─── Client ──────────────────────────────────────────────────────────────────

let _client: Firecrawl | null = null;

function getClient(): Firecrawl {
  if (!_client) {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) throw new Error("FIRECRAWL_API_KEY não configurada");
    _client = new Firecrawl({ apiKey: key });
  }
  return _client;
}

// ─── Filtros de URL genéricos ────────────────────────────────────────────────

// Páginas que NUNCA são imóveis individuais
const SKIP_URL_PATTERNS = [
  /\/(contato|sobre|blog|faq|politica|termos|privacidade|quem-somos)/i,
  /\/(login|cadastro|admin|painel|area-do-cliente|minha-conta)/i,
  /\/(trabalhe|parceiros|franquia|imprensa|newsletter)/i,
  /\/(listar|comparar|favorit)/i, // páginas de ação, não de detalhe
  /\/#/,
  /\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|webp|mp4|xml)(\?|$)/i,
  /\/(feed|rss|sitemap)/i,
];

// URLs de aluguel — filtrar pois usuário quer só venda
const RENTAL_URL_PATTERNS = [
  /\/alug(ar|uel)/i,
  /\/locac(ao|ão)/i,
  /\/rental/i,
  /\/to-rent/i,
  /[?&]finalidade=alug/i,
  /[?&]tipo_negocio=alug/i,
];

/**
 * Detecta se uma URL é um imóvel individual (detalhe) de VENDA.
 */
function isDetailPageUrl(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    if (u.hostname !== base.hostname) return false;
  } catch {
    return false;
  }

  if (SKIP_URL_PATTERNS.some((p) => p.test(url))) return false;
  if (RENTAL_URL_PATTERNS.some((p) => p.test(url))) return false;

  const path = new URL(url).pathname;
  if (path === "/" || path === "") return false;

  const segments = path.split("/").filter(Boolean);

  // Segmento numérico = detalhe (/imovel/1234)
  if (segments.some((s) => /^\d+$/.test(s))) return true;

  // Slug longo com hífens (/imovel/apartamento-2-quartos-centro)
  if (segments.some((s) => s.length > 15 && s.includes("-"))) return true;

  // 3+ segmentos (/imoveis/venda/apartamento-xyz)
  if (segments.length >= 3) return true;

  // Referência (ref-123, cod-456)
  if (/\b(ref|cod|id)[-_]?\d+/i.test(path)) return true;

  return false;
}

// ─── Schema de extração ──────────────────────────────────────────────────────

const PROPERTY_EXTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    titulo: {
      type: "string",
      description: "Título do anúncio do imóvel",
    },
    tipo: {
      type: "string",
      description:
        "Tipo do imóvel: apartamento, casa, terreno, sala comercial, kitnet, sobrado, cobertura, loft, etc.",
    },
    transacao: {
      type: "string",
      description: "Tipo de transação: venda ou aluguel",
    },
    preco: {
      type: "number",
      description:
        "Preço do imóvel em reais (apenas o número, sem R$ ou pontos).",
    },
    quartos: {
      type: "number",
      description: "Número de quartos/dormitórios",
    },
    banheiros: {
      type: "number",
      description: "Número de banheiros",
    },
    vagas: {
      type: "number",
      description: "Número de vagas de garagem",
    },
    areaM2: {
      type: "number",
      description: "Área total ou útil em metros quadrados",
    },
    bairro: {
      type: "string",
      description: "Bairro onde o imóvel está localizado",
    },
    cidade: {
      type: "string",
      description: "Cidade onde o imóvel está localizado",
    },
    estado: {
      type: "string",
      description: "Estado (sigla UF) onde o imóvel está localizado",
    },
    descricao: {
      type: "string",
      description: "Descrição completa do imóvel (primeiros 500 caracteres)",
    },
    imagens: {
      type: "array",
      items: { type: "string" },
      description: "URLs das fotos do imóvel",
    },
    caracteristicas: {
      type: "object",
      description:
        "Características extras: piscina, churrasqueira, ar condicionado, etc.",
    },
  },
  required: ["titulo"],
};

const PROPERTY_EXTRACT_PROMPT =
  "Extraia todos os dados deste anúncio de imóvel. " +
  "Se a página for um erro 404, página não encontrada, ou não for um anúncio de imóvel, retorne titulo como 'NAO_ENCONTRADO'. " +
  "No campo transacao, informe se é 'venda' ou 'aluguel'. " +
  "Retorne preço como número (sem R$, sem pontos). " +
  "Retorne área em m². " +
  "Inclua todas as URLs de fotos do imóvel que encontrar.";

// ─── Verificação rápida de URL ativa ─────────────────────────────────────────

async function isUrlAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
    });
    return res.ok;
  } catch {
    return true;
  }
}

// ─── Map: descobrir URLs de imóveis com paginação ────────────────────────────

/**
 * Percorre TODAS as páginas da listagem de venda, coletando links de detalhe.
 * Gasta 1 crédito Firecrawl por página de listagem.
 */
async function extractAllPagesFromListing(
  siteUrl: string
): Promise<string[]> {
  const client = getClient();
  const baseUrl = siteUrl.replace(/\/$/, "");
  const allDetailLinks = new Set<string>();

  // Descobrir qual URL de listagem funciona
  const listingCandidates = [
    `${baseUrl}/imoveis/venda`,
    `${baseUrl}/venda`,
    `${baseUrl}/imoveis?finalidade=venda`,
    `${baseUrl}/imoveis`,
    baseUrl,
  ];

  let workingListingUrl: string | null = null;

  for (const candidate of listingCandidates) {
    try {
      // Verificar se a URL existe
      const alive = await isUrlAlive(candidate);
      if (!alive) continue;

      console.log(`[firecrawl] tentando listagem: ${candidate}`);
      const result = await client.scrape(candidate, {
        formats: ["links"],
        timeout: 30000,
      });

      const links = result.links ?? [];
      const detailLinks = links.filter((link) =>
        isDetailPageUrl(link, siteUrl)
      );

      if (detailLinks.length >= 3) {
        workingListingUrl = candidate;
        for (const link of detailLinks) allDetailLinks.add(link);
        console.log(
          `[firecrawl] ✓ listagem encontrada: ${candidate} (${detailLinks.length} imóveis na pág 1)`
        );
        break;
      }
    } catch {
      // Próximo candidato
    }
  }

  if (!workingListingUrl) {
    console.log(`[firecrawl] nenhuma listagem de venda encontrada`);
    return [];
  }

  // Percorrer páginas seguintes
  const MAX_PAGES = 100; // segurança
  let page = 2;
  let emptyPages = 0;

  while (page <= MAX_PAGES && emptyPages < 2) {
    // Tentar diferentes padrões de paginação
    const pageUrl = buildPageUrl(workingListingUrl, page);
    console.log(`[firecrawl] listagem pág ${page}: ${pageUrl}`);

    try {
      const alive = await isUrlAlive(pageUrl);
      if (!alive) {
        console.log(`[firecrawl] pág ${page} não existe, parando`);
        break;
      }

      const result = await client.scrape(pageUrl, {
        formats: ["links"],
        timeout: 30000,
      });

      const links = result.links ?? [];
      const detailLinks = links.filter((link) =>
        isDetailPageUrl(link, siteUrl)
      );

      // Contar quantos são novos
      const newLinks = detailLinks.filter((l) => !allDetailLinks.has(l));

      if (newLinks.length === 0) {
        emptyPages++;
        console.log(
          `[firecrawl] pág ${page}: 0 novos imóveis (${emptyPages}/2 páginas vazias)`
        );
      } else {
        emptyPages = 0;
        for (const link of detailLinks) allDetailLinks.add(link);
        console.log(
          `[firecrawl] pág ${page}: +${newLinks.length} novos (total: ${allDetailLinks.size})`
        );
      }
    } catch (err) {
      console.log(`[firecrawl] erro na pág ${page}, parando paginação`);
      break;
    }

    page++;

    // Delay entre páginas para não sobrecarregar
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(
    `[firecrawl] ✓ paginação concluída: ${allDetailLinks.size} imóveis em ${page - 1} páginas`
  );

  return [...allDetailLinks];
}

/**
 * Constrói URL da próxima página baseado no padrão da listagem.
 */
function buildPageUrl(listingUrl: string, page: number): string {
  const url = new URL(listingUrl);

  // Se já tem query params, adicionar/substituir pagina
  if (url.search) {
    url.searchParams.set("pagina", String(page));
    // Tentar também 'page' caso 'pagina' não funcione
    if (!url.searchParams.has("page")) {
      url.searchParams.set("page", String(page));
    }
    return url.toString();
  }

  // Tentar padrão de path: /imoveis/venda/pagina/2
  const base = listingUrl.replace(/\/$/, "");

  // Padrão mais comum em sites BR
  return `${base}?pagina=${page}`;
}

/**
 * Verifica em lote quais URLs estão vivas.
 */
async function filterAliveUrls(
  urls: string[],
  concurrency = 20
): Promise<string[]> {
  const alive: string[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        const ok = await isUrlAlive(url);
        return { url, ok };
      })
    );
    for (const r of results) {
      if (r.ok) alive.push(r.url);
    }
  }

  return alive;
}

export async function mapPropertyUrls(siteUrl: string): Promise<string[]> {
  // Estratégia 1: Percorrer TODAS as páginas da listagem de venda
  console.log(`[firecrawl] buscando imóveis de venda com paginação...`);
  const listingLinks = await extractAllPagesFromListing(siteUrl);

  if (listingLinks.length >= 3) {
    console.log(
      `[firecrawl] ✓ ${listingLinks.length} imóveis de venda encontrados`
    );
    return listingLinks;
  }

  // Estratégia 2: Fallback para /map + filtro de URLs vivas
  console.log(
    `[firecrawl] fallback: /map + verificação de URLs ativas...`
  );
  const client = getClient();

  const result = await client.map(siteUrl, {
    limit: 2000,
    sitemap: "include",
  });

  const allUrls: string[] = result.links?.map((link) => link.url) ?? [];
  const detailUrls = allUrls.filter((url) => isDetailPageUrl(url, siteUrl));

  console.log(
    `[firecrawl] map: ${allUrls.length} URLs → ${detailUrls.length} detalhe`
  );

  if (detailUrls.length === 0) return [];

  console.log(
    `[firecrawl] verificando ${detailUrls.length} URLs ativas...`
  );
  const aliveUrls = await filterAliveUrls(detailUrls);
  console.log(
    `[firecrawl] ✓ ${aliveUrls.length}/${detailUrls.length} URLs ativas`
  );

  return aliveUrls;
}

// ─── Scrape: extrair dados de uma página de imóvel ───────────────────────────

export async function scrapeProperty(
  url: string,
  fallbackCidade?: string | null,
  fallbackEstado?: string | null
): Promise<ImovelInput | null> {
  const alive = await isUrlAlive(url);
  if (!alive) {
    console.log(`[firecrawl] ✗ URL morta — ${url}`);
    return null;
  }

  const client = getClient();

  try {
    const result = await client.scrape(url, {
      formats: [
        {
          type: "json",
          schema: PROPERTY_EXTRACT_SCHEMA,
          prompt: PROPERTY_EXTRACT_PROMPT,
        },
      ],
      timeout: 60000,
    });

    const data = result.json as Record<string, unknown> | undefined;

    if (!data) {
      console.warn(`[firecrawl] ✗ sem dados JSON — ${url}`);
      return null;
    }

    const titulo = (data.titulo as string) || null;
    const tipo = (data.tipo as string) || null;
    const transacao = (data.transacao as string) || null;
    const preco = typeof data.preco === "number" ? data.preco : null;
    const quartos = typeof data.quartos === "number" ? data.quartos : null;
    const bairro = (data.bairro as string) || null;
    const imagens = Array.isArray(data.imagens)
      ? (data.imagens as string[]).filter(
          (u) => typeof u === "string" && u.startsWith("http")
        )
      : [];

    // Detectar página inválida
    const tituloLower = (titulo || "").toLowerCase();
    const isInvalid =
      tituloLower.includes("nao_encontrado") ||
      tituloLower.includes("não encontrad") ||
      tituloLower.includes("not found") ||
      tituloLower.includes("404") ||
      tituloLower === "n/a" ||
      tituloLower === "";

    if (isInvalid) {
      console.log(`[firecrawl] ✗ não é anúncio válido — ${url}`);
      return null;
    }

    // Filtrar aluguel (usuário quer só venda)
    if (transacao && /alug/i.test(transacao)) {
      console.log(`[firecrawl] ✗ aluguel (ignorado) — ${url}`);
      return null;
    }

    // Precisa ter pelo menos UM dado útil além do título
    if (!preco && !quartos && !bairro && imagens.length === 0 && !tipo) {
      console.log(`[firecrawl] ✗ sem dados úteis — ${url}`);
      return null;
    }

    // Log detalhado
    const precoStr = preco
      ? `R$ ${preco.toLocaleString("pt-BR")}`
      : "sem preço";
    const quartosStr = quartos ? `${quartos}q` : "";
    const bairroStr = bairro || "sem bairro";
    console.log(
      `[firecrawl] ✓ ${titulo} — ${tipo || "?"} — ${precoStr} ${quartosStr} — ${bairroStr} — ${imagens.length} fotos`
    );

    return {
      urlAnuncio: url,
      titulo,
      tipo,
      preco,
      quartos,
      banheiros: typeof data.banheiros === "number" ? data.banheiros : null,
      vagas: typeof data.vagas === "number" ? data.vagas : null,
      areaM2: typeof data.areaM2 === "number" ? data.areaM2 : null,
      bairro,
      cidade: (data.cidade as string) || fallbackCidade || null,
      estado: (data.estado as string) || fallbackEstado || null,
      descricao: (data.descricao as string) || null,
      imagens,
      caracteristicas:
        typeof data.caracteristicas === "object" && data.caracteristicas
          ? (data.caracteristicas as Record<string, unknown>)
          : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[firecrawl] ✗ erro ${url}: ${msg}`);
    return null;
  }
}

// ─── Scrape batch ────────────────────────────────────────────────────────────

export async function scrapePropertyBatch(
  urls: string[],
  fallbackCidade?: string | null,
  fallbackEstado?: string | null,
  delayMs = 2000
): Promise<ImovelInput[]> {
  const results: ImovelInput[] = [];
  console.log(
    `[firecrawl] batch: enriquecendo ${urls.length} imóveis (delay ${delayMs}ms)...`
  );

  for (let i = 0; i < urls.length; i++) {
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    console.log(`[firecrawl] enrich ${i + 1}/${urls.length} — ${urls[i]}`);
    const result = await scrapeProperty(urls[i], fallbackCidade, fallbackEstado);
    if (result) {
      results.push(result);
    }
  }

  console.log(
    `[firecrawl] batch concluído: ${results.length}/${urls.length} extraídos com sucesso`
  );
  return results;
}
