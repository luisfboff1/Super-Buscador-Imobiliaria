import { chromium, type Browser, type Page } from "playwright";
import * as cheerio from "cheerio";
import type { ImovelInput } from "./db.js";
import { extractPropertyData } from "./extractor.js";

// ─── Filtros de URL ──────────────────────────────────────────────────────────

const SKIP_URL_PATTERNS = [
  /\/(contato|sobre|blog|faq|politica|termos|privacidade|quem-somos)/i,
  /\/(login|cadastro|admin|painel|area-do-cliente|minha-conta)/i,
  /\/(listar|comparar|favorit)/i,
  /\/(trabalhe|carreiras|equipe|corretor)/i,
  /\/(plantao|atendimento|simulador|financiamento)/i,
  // Páginas de listagem / paginação — nunca são imóveis individuais
  /\/imoveis(\/|$)/i,
  /\/(page|pagina|pag)\/\d+/i,
  /[?&](page|pagina|pag)=\d+/i,
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

// ─── Descoberta de URLs via listagem com paginação paralela ─────────────────

export async function discoverPropertyUrls(
  siteUrl: string,
  onProgress?: (msg: string) => void
): Promise<string[]> {
  const log = onProgress ?? console.log;
  const browser = await getBrowser();
  const baseHostname = new URL(siteUrl).hostname;
  const baseUrl = siteUrl.replace(/\/$/, "");
  const MAX_PAGES = parseInt(process.env.CRAWL_MAX_PAGES || "200", 10);
  const PAGE_CONCURRENCY = parseInt(process.env.CRAWL_PAGE_CONCURRENCY || "5", 10);
  const allDetailUrls = new Set<string>();

  // ─── Helper: cria página Playwright com bloqueio de recursos ─────────────
  async function newFastPage() {
    const p = await browser.newPage();
    await p.route("**/*", (route) => {
      if (["image", "media", "font", "stylesheet"].includes(route.request().resourceType())) {
        route.abort();
      } else {
        route.continue();
      }
    });
    return p;
  }

  // ─── Helper: obtém links de detalhe de um URL de listagem ────────────────
  async function fetchPageLinks(pageUrl: string): Promise<string[]> {
    const p = await newFastPage();
    try {
      const res = await p.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!res || res.status() >= 400) return [];
      await autoScroll(p);
      return await extractDetailLinks(p, baseHostname);
    } catch {
      return [];
    } finally {
      await p.close();
    }
  }

  // ─── 1. Encontrar a melhor URL de listagem ────────────────────────────────
  const listingCandidates = [
    `${baseUrl}/imoveis/venda`,
    `${baseUrl}/imoveis/comprar`,
    `${baseUrl}/comprar`,
    `${baseUrl}/venda`,
    `${baseUrl}/imoveis?finalidade=venda`,
    `${baseUrl}/imoveis?tipo=venda`,
    `${baseUrl}/imoveis`,
    baseUrl,
  ];

  let bestUrl: string | null = null;
  let bestCount = 0;

  {
    const p = await newFastPage();
    try {
      for (const candidate of listingCandidates) {
        log(`[crawler] tentando listagem: ${candidate}`);
        try {
          const res = await p.goto(candidate, { waitUntil: "domcontentloaded", timeout: 20000 });
          if (!res || res.status() >= 400) continue;
          await autoScroll(p);
          const links = await extractDetailLinks(p, baseHostname);
          log(`[crawler]   → ${links.length} imóveis encontrados`);
          if (links.length > bestCount) { bestCount = links.length; bestUrl = candidate; }
          if (links.length >= 30) break;
        } catch { continue; }
      }
    } finally {
      await p.close();
    }
  }

  if (!bestUrl || bestCount < 1) {
    log(`[crawler] nenhuma listagem de venda encontrada`);
    return [];
  }
  log(`[crawler] ✓ melhor listagem: ${bestUrl} (${bestCount} imóveis na pág 1)`);

  // ─── 2. Página 1 + detectar template de paginação ────────────────────────
  let rawPage2Url: string | null = null;
  {
    const p = await newFastPage();
    try {
      await p.goto(bestUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await autoScroll(p);
      for (const link of await extractDetailLinks(p, baseHostname)) allDetailUrls.add(link);

      rawPage2Url = await p.evaluate(() => {
        const page2Selectors = [
          'a[href*="pagina=2"]', 'a[href*="page=2"]', 'a[href*="pag=2"]', 'a[href*="pg=2"]',
          'a[href*="/pagina/2"]', 'a[href*="/page/2"]', 'a[href*="/pag/2"]', 'a[href*="/pg/2"]',
        ];
        for (const sel of page2Selectors) {
          const el = document.querySelector(sel) as HTMLAnchorElement | null;
          if (el?.href) return el.href;
        }
        const navLinks = Array.from(document.querySelectorAll(
          '.pagination a, .paginacao a, [class*="paginat"] a, [class*="pagination"] a'
        )) as HTMLAnchorElement[];
        return navLinks.find((a) => a.textContent?.trim() === "2" && a.href)?.href ?? null;
      });
    } finally {
      await p.close();
    }
  }

  // Converter URL da pág 2 em template com placeholder {N}
  let template: string | null = null;
  if (rawPage2Url) {
    const patternMap: [RegExp, string][] = [
      [/([?&]pagina=)2(&|$)/, "$1{N}$2"],
      [/([?&]page=)2(&|$)/,   "$1{N}$2"],
      [/([?&]pag=)2(&|$)/,    "$1{N}$2"],
      [/([?&]pg=)2(&|$)/,     "$1{N}$2"],
      [/(\/pagina\/)2(\/|$)/, "$1{N}$2"],
      [/(\/page\/)2(\/|$)/,   "$1{N}$2"],
      [/(\/pag\/)2(\/|$)/,    "$1{N}$2"],
      [/(\/pg\/)2(\/|$)/,     "$1{N}$2"],
    ];
    for (const [pat, rep] of patternMap) {
      if (pat.test(rawPage2Url)) { template = rawPage2Url.replace(pat, rep); break; }
    }
  }

  const getPageUrl = (n: number) => template!.replace("{N}", String(n));

  if (!template) {
    // Fallback: paginação sequencial (confiável para sites sem paginação padrão)
    log(`[crawler] ⚠ template não detectado → modo sequencial`);
    let pageNum = 2, emptyPages = 0;
    const p = await newFastPage();
    try {
      while (pageNum <= MAX_PAGES && emptyPages < 2) {
        const nextUrl = await detectNextPageUrl(p, baseHostname, bestUrl, pageNum);
        log(`[crawler] pág ${pageNum}: ${nextUrl}`);
        try {
          const res = await p.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          if (!res || res.status() >= 400) { log(`[crawler] pág ${pageNum} não existe`); break; }
          await autoScroll(p);
          const links = await extractDetailLinks(p, baseHostname);
          const newLinks = links.filter((l) => !allDetailUrls.has(l));
          if (newLinks.length === 0) {
            emptyPages++;
            log(`[crawler] pág ${pageNum}: 0 novos (${emptyPages}/2 vazias)`);
          } else {
            emptyPages = 0;
            for (const l of links) allDetailUrls.add(l);
            log(`[crawler] pág ${pageNum}: +${newLinks.length} (total: ${allDetailUrls.size})`);
          }
        } catch { log(`[crawler] erro na pág ${pageNum}`); break; }
        pageNum++;
      }
    } finally {
      await p.close();
    }
    log(`[crawler] ✓ sequencial: ${allDetailUrls.size} imóveis em ${pageNum - 1} páginas`);
    return [...allDetailUrls];
  }

  log(`[crawler] ✓ template detectado: ${template}`);

  // ─── 3. Probe paralelo para encontrar última página ───────────────────────
  const probePoints = [10, 25, 50, 100, 150, 200].filter((n) => n <= MAX_PAGES);
  const probeResults = await Promise.all(
    probePoints.map(async (n) => ({
      n,
      hasLinks: (await fetchPageLinks(getPageUrl(n))).length > 0,
    }))
  );
  log(`[crawler] probe: ${probeResults.map((r) => `${r.n}=${r.hasLinks ? "✓" : "✗"}`).join(" ")}`);

  const lastGood = [...probeResults].reverse().find((r) => r.hasLinks);
  const firstEmpty = probeResults.find((r) => !r.hasLinks);

  let lastPage: number;
  if (!lastGood) {
    lastPage = 1;
  } else if (!firstEmpty) {
    lastPage = MAX_PAGES;
  } else {
    // Busca binária entre lastGood.n e firstEmpty.n para encontrar a última página exata
    let lo = lastGood.n, hi = firstEmpty.n;
    while (hi - lo > 2) {
      const mid = Math.floor((lo + hi) / 2);
      const links = await fetchPageLinks(getPageUrl(mid));
      if (links.length > 0) lo = mid; else hi = mid;
    }
    lastPage = lo;
  }
  log(`[crawler] ✓ última página: ${lastPage}`);

  // ─── 4. Scraping paralelo de páginas 2..lastPage ──────────────────────────
  const pageNums = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);

  for (let i = 0; i < pageNums.length; i += PAGE_CONCURRENCY) {
    const batch = pageNums.slice(i, i + PAGE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (n) => ({ n, links: await fetchPageLinks(getPageUrl(n)) }))
    );
    let batchNew = 0;
    for (const { links } of results) {
      const before = allDetailUrls.size;
      for (const l of links) allDetailUrls.add(l);
      batchNew += allDetailUrls.size - before;
    }
    log(`[crawler] págs ${batch[0]}-${batch[batch.length - 1]}: +${batchNew} (total: ${allDetailUrls.size})`);
  }

  log(`[crawler] ✓ paginação paralela: ${allDetailUrls.size} imóveis em ${lastPage} páginas`);
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
    // Bloquear recursos desnecessários para carregar mais rápido
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded", // mais rápido que networkidle
      timeout: 20000,
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
      const distance = 800;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 80);
      // Safety timeout reduzido
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 3000);
    });
  });
  // Aguardar renderização pós-scroll
  await page.waitForTimeout(300);
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

// Detecta o URL da próxima página lendo os links de paginação da página atual
async function detectNextPageUrl(
  page: Page,
  baseHostname: string,
  listingUrl: string,
  targetPage: number
): Promise<string> {
  // 1. Tentar encontrar link de paginação na própria página (mais inteligente)
  const paginationUrl = await page.evaluate((target) => {
    // Seletores comuns de paginação
    const selectors = [
      `a[href*="pagina=${target}"]`,
      `a[href*="page=${target}"]`,
      `a[href*="pag=${target}"]`,
      `a[href*="/pagina/${target}"]`,
      `a[href*="/page/${target}"]`,
      `a[href*="/pag/${target}"]`,
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement | null;
      if (el?.href) return el.href;
    }

    // Buscar link "próxima página" / "next"
    const nextSelectors = [
      'a[rel="next"]',
      'a[aria-label*="próxima"]',
      'a[aria-label*="next"]',
      ".pagination a.next",
      ".paginacao a.proximo",
      'a:has(> .next)',
    ];

    for (const sel of nextSelectors) {
      try {
        const el = document.querySelector(sel) as HTMLAnchorElement | null;
        if (el?.href) return el.href;
      } catch {
        // seletor não suportado, ignorar
      }
    }

    // Buscar links numerados de paginação
    const pageLinks = Array.from(
      document.querySelectorAll(".pagination a, .paginacao a, nav a, [class*='paginat'] a")
    ) as HTMLAnchorElement[];

    const targetLink = pageLinks.find(
      (a) => a.textContent?.trim() === String(target) && a.href
    );
    if (targetLink) return targetLink.href;

    return null;
  }, targetPage);

  if (paginationUrl) {
    return paginationUrl;
  }

  // 2. Fallback: tentar múltiplos padrões de URL
  const url = new URL(listingUrl);
  const patterns = [
    // query string variations
    (() => { url.searchParams.set("pagina", String(targetPage)); return url.toString(); })(),
    (() => { url.searchParams.set("page", String(targetPage)); return url.toString(); })(),
    (() => { url.searchParams.set("pag", String(targetPage)); return url.toString(); })(),
    // path segment variations
    `${listingUrl.replace(/\/$/, "")}/pagina/${targetPage}`,
    `${listingUrl.replace(/\/$/, "")}/page/${targetPage}`,
  ];

  return patterns[0]; // default: ?pagina=N
}
