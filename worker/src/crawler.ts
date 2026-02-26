import { chromium, type Browser, type Page } from "playwright";
import * as cheerio from "cheerio";
import type { ImovelInput } from "./db.js";
import { extractPropertyData } from "./extractor.js";

// ─── Filtros de URL ──────────────────────────────────────────────────────────

const SKIP_URL_PATTERNS = [
  /\/(contato|sobre|blog|faq|politica|termos|privacidade|quem-somos)/i,
  /\/(login|cadastro|admin|painel|area-do-cliente|minha-conta)/i,
  /\/(listar|comparar|favorit)/i,
  /\/#/,
  /\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|webp|mp4|xml)(\?|$)/i,
];

const RENTAL_URL_PATTERNS = [
  /\/alug(ar|uel)/i,
  /\/locac(ao|ão)/i,
  /[?&]finalidade=alug/i,
];

function isDetailPageUrl(url: string, baseHostname: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== baseHostname) return false;
  } catch {
    return false;
  }

  if (SKIP_URL_PATTERNS.some((p) => p.test(url))) return false;
  if (RENTAL_URL_PATTERNS.some((p) => p.test(url))) return false;

  const path = new URL(url).pathname;
  if (path === "/" || path === "") return false;

  const segments = path.split("/").filter(Boolean);
  if (segments.some((s) => /^\d+$/.test(s))) return true;
  if (segments.some((s) => s.length > 15 && s.includes("-"))) return true;
  if (segments.length >= 3) return true;
  if (/\b(ref|cod|id)[-_]?\d+/i.test(path)) return true;

  return false;
}

// ─── Browser management ─────────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// ─── Descoberta de URLs via listagem com paginação ───────────────────────────

export async function discoverPropertyUrls(
  siteUrl: string,
  onProgress?: (msg: string) => void
): Promise<string[]> {
  const log = onProgress ?? console.log;
  const browser = await getBrowser();
  const page = await browser.newPage();
  const baseHostname = new URL(siteUrl).hostname;
  const baseUrl = siteUrl.replace(/\/$/, "");
  const allDetailUrls = new Set<string>();

  try {
    // Tentar diferentes URLs de listagem de venda
    const listingCandidates = [
      `${baseUrl}/imoveis/venda`,
      `${baseUrl}/venda`,
      `${baseUrl}/imoveis?finalidade=venda`,
      `${baseUrl}/imoveis`,
      baseUrl,
    ];

    let workingUrl: string | null = null;

    for (const candidate of listingCandidates) {
      log(`[crawler] tentando listagem: ${candidate}`);
      try {
        const response = await page.goto(candidate, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        if (!response || response.status() >= 400) continue;

        // Scroll para ativar lazy loading
        await autoScroll(page);

        const links = await extractDetailLinks(page, baseHostname);
        if (links.length >= 3) {
          workingUrl = candidate;
          for (const link of links) allDetailUrls.add(link);
          log(
            `[crawler] ✓ listagem encontrada: ${candidate} (${links.length} imóveis na pág 1)`
          );
          break;
        }
      } catch {
        continue;
      }
    }

    if (!workingUrl) {
      log(`[crawler] nenhuma listagem de venda encontrada`);
      await page.close();
      return [];
    }

    // Percorrer TODAS as páginas
    let pageNum = 2;
    let emptyPages = 0;
    const MAX_PAGES = 200;

    while (pageNum <= MAX_PAGES && emptyPages < 2) {
      const pageUrl = buildPageUrl(workingUrl, pageNum);
      log(`[crawler] pág ${pageNum}: ${pageUrl}`);

      try {
        const response = await page.goto(pageUrl, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        if (!response || response.status() >= 400) {
          log(`[crawler] pág ${pageNum} não existe, parando`);
          break;
        }

        await autoScroll(page);
        const links = await extractDetailLinks(page, baseHostname);
        const newLinks = links.filter((l) => !allDetailUrls.has(l));

        if (newLinks.length === 0) {
          emptyPages++;
          log(
            `[crawler] pág ${pageNum}: 0 novos (${emptyPages}/2 páginas vazias)`
          );
        } else {
          emptyPages = 0;
          for (const link of links) allDetailUrls.add(link);
          log(
            `[crawler] pág ${pageNum}: +${newLinks.length} novos (total: ${allDetailUrls.size})`
          );
        }
      } catch {
        log(`[crawler] erro na pág ${pageNum}, parando`);
        break;
      }

      pageNum++;
      // Delay entre páginas
      await new Promise((r) => setTimeout(r, 1500));
    }

    log(
      `[crawler] ✓ paginação concluída: ${allDetailUrls.size} imóveis em ${pageNum - 1} páginas`
    );
  } finally {
    await page.close();
  }

  return [...allDetailUrls];
}

// ─── Extração de dados de uma página de detalhe ──────────────────────────────

export async function scrapePropertyPage(
  url: string,
  fallbackCidade?: string | null,
  fallbackEstado?: string | null
): Promise<ImovelInput | null> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    if (!response || response.status() >= 400) {
      console.log(`[crawler] ✗ HTTP ${response?.status()} — ${url}`);
      return null;
    }

    // Scroll para ativar lazy loading de imagens
    await autoScroll(page);

    const html = await page.content();
    const pageTitle = await page.title();

    // Detectar 404 soft (página existe mas conteúdo é "não encontrado")
    const titleLower = pageTitle.toLowerCase();
    if (
      titleLower.includes("404") ||
      titleLower.includes("não encontrad") ||
      titleLower.includes("not found")
    ) {
      console.log(`[crawler] ✗ 404 soft — ${url}`);
      return null;
    }

    // Tentar extração via cheerio primeiro (rápido, sem LLM)
    const cheerioResult = extractWithCheerio(html, url);

    // Se cheerio pegou dados suficientes, usa direto
    if (
      cheerioResult &&
      cheerioResult.preco &&
      (cheerioResult.quartos || cheerioResult.bairro)
    ) {
      cheerioResult.cidade = cheerioResult.cidade || fallbackCidade || null;
      cheerioResult.estado = cheerioResult.estado || fallbackEstado || null;
      console.log(
        `[crawler] ✓ [cheerio] ${cheerioResult.titulo} — R$ ${cheerioResult.preco?.toLocaleString("pt-BR")} — ${cheerioResult.bairro || "?"}`
      );
      return cheerioResult;
    }

    // Fallback: extração via LLM (Groq)
    const llmResult = await extractPropertyData(html, url);
    if (llmResult) {
      llmResult.cidade = llmResult.cidade || fallbackCidade || null;
      llmResult.estado = llmResult.estado || fallbackEstado || null;

      // Filtrar aluguel
      const transacao = (llmResult as Record<string, unknown>).transacao;
      if (typeof transacao === "string" && /alug/i.test(transacao)) {
        console.log(`[crawler] ✗ aluguel (ignorado) — ${url}`);
        return null;
      }

      console.log(
        `[crawler] ✓ [llm] ${llmResult.titulo} — R$ ${llmResult.preco?.toLocaleString("pt-BR") || "?"} — ${llmResult.bairro || "?"}`
      );
      return llmResult;
    }

    // Cheerio parcial é melhor que nada
    if (cheerioResult) {
      cheerioResult.cidade = cheerioResult.cidade || fallbackCidade || null;
      cheerioResult.estado = cheerioResult.estado || fallbackEstado || null;
      console.log(
        `[crawler] ✓ [parcial] ${cheerioResult.titulo} — ${url}`
      );
      return cheerioResult;
    }

    console.log(`[crawler] ✗ sem dados extraíveis — ${url}`);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[crawler] ✗ erro ${url}: ${msg}`);
    return null;
  } finally {
    await page.close();
  }
}

// ─── Cheerio: extração heurística (rápida, sem LLM) ─────────────────────────

function extractWithCheerio(
  html: string,
  url: string
): ImovelInput | null {
  const $ = cheerio.load(html);

  // Título
  const titulo =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().trim() ||
    null;

  if (!titulo) return null;

  // Preço — buscar padrão R$ XXX.XXX
  let preco: number | null = null;
  const precoText =
    $('[class*="preco"], [class*="price"], [class*="valor"]')
      .first()
      .text() || $("body").text();
  const precoMatch = precoText.match(
    /R\$\s*([\d.,]+)/
  );
  if (precoMatch) {
    const cleaned = precoMatch[1]
      .replace(/\./g, "")
      .replace(",", ".");
    preco = parseFloat(cleaned) || null;
  }

  // Quartos
  let quartos: number | null = null;
  const quartosMatch = $("body")
    .text()
    .match(/(\d+)\s*(?:quartos?|dormit|dorm|suítes?)/i);
  if (quartosMatch) quartos = parseInt(quartosMatch[1]);

  // Banheiros
  let banheiros: number | null = null;
  const banheirosMatch = $("body")
    .text()
    .match(/(\d+)\s*(?:banheiros?|WC|lavabo)/i);
  if (banheirosMatch) banheiros = parseInt(banheirosMatch[1]);

  // Vagas
  let vagas: number | null = null;
  const vagasMatch = $("body")
    .text()
    .match(/(\d+)\s*(?:vagas?|garagem)/i);
  if (vagasMatch) vagas = parseInt(vagasMatch[1]);

  // Área
  let areaM2: number | null = null;
  const areaMatch = $("body")
    .text()
    .match(/([\d.,]+)\s*m²/i);
  if (areaMatch) {
    areaM2 = parseFloat(areaMatch[1].replace(",", ".")) || null;
  }

  // Imagens
  const imagens: string[] = [];
  $(
    'img[src*="imovel"], img[src*="property"], img[src*="foto"], img[data-src]'
  ).each((_, el) => {
    const src =
      $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
    if (src && src.startsWith("http") && !src.includes("logo") && !src.includes("icon")) {
      imagens.push(src);
    }
  });

  // OG images como fallback
  $('meta[property="og:image"]').each((_, el) => {
    const content = $(el).attr("content");
    if (content && content.startsWith("http")) imagens.push(content);
  });

  // Tipo
  let tipo: string | null = null;
  const tipoPatterns = [
    "apartamento",
    "casa",
    "terreno",
    "sobrado",
    "kitnet",
    "cobertura",
    "sala comercial",
    "loft",
    "pavilhão",
    "galpão",
    "loja",
  ];
  const tituloLower = (titulo || "").toLowerCase();
  for (const t of tipoPatterns) {
    if (tituloLower.includes(t)) {
      tipo = t;
      break;
    }
  }

  // Bairro — tentar extrair de breadcrumb ou meta
  const bairro =
    $('[class*="bairro"], [class*="neighborhood"], [class*="endereco"] span')
      .first()
      .text()
      .trim() || null;

  return {
    urlAnuncio: url,
    titulo,
    tipo,
    preco,
    quartos,
    banheiros,
    vagas,
    areaM2,
    bairro,
    cidade: null,
    estado: null,
    descricao: $('meta[name="description"]').attr("content")?.trim() || null,
    imagens: [...new Set(imagens)],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
      // Safety timeout
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 5000);
    });
  });
  // Aguardar lazy loading
  await page.waitForTimeout(1000);
}

async function extractDetailLinks(
  page: Page,
  baseHostname: string
): Promise<string[]> {
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) =>
      (a as HTMLAnchorElement).href
    )
  );

  return [
    ...new Set(links.filter((link) => isDetailPageUrl(link, baseHostname))),
  ];
}

function buildPageUrl(listingUrl: string, page: number): string {
  const url = new URL(listingUrl);

  if (url.search) {
    url.searchParams.set("pagina", String(page));
    return url.toString();
  }

  return `${listingUrl.replace(/\/$/, "")}?pagina=${page}`;
}
