import { count, eq, desc, asc, and, gte, ilike, sql, or, inArray } from "drizzle-orm";
import { db, tenantSchema, authSchema } from "@/lib/db";

// ─── STATS ────────────────────────────────────────────────────────────────────

export async function getStats(userId: string) {
  const [imoveisCount] = await db
    .select({ total: count() })
    .from(tenantSchema.imoveis)
    .where(eq(tenantSchema.imoveis.disponivel, true));

  const [fontesCount] = await db
    .select({ total: count() })
    .from(tenantSchema.fontes)
    .where(eq(tenantSchema.fontes.ativa, true));

  const [fontesErro] = await db
    .select({ total: count() })
    .from(tenantSchema.fontes)
    .where(eq(tenantSchema.fontes.status, "erro"));

  const [searchesCount] = await db
    .select({ total: count() })
    .from(tenantSchema.searches)
    .where(eq(tenantSchema.searches.userId, userId));

  const [favoritosCount] = await db
    .select({ total: count() })
    .from(tenantSchema.favoritos)
    .where(eq(tenantSchema.favoritos.userId, userId));

  return {
    imoveis: imoveisCount.total,
    fontes: fontesCount.total,
    fontesErro: fontesErro.total,
    searches: searchesCount.total,
    favoritos: favoritosCount.total,
  };
}

// ─── FONTES ───────────────────────────────────────────────────────────────────

export async function getFontes() {
  return db
    .select()
    .from(tenantSchema.fontes)
    .orderBy(desc(tenantSchema.fontes.createdAt));
}

export async function getFontesComContagem() {
  const fontes = await db
    .select({
      id: tenantSchema.fontes.id,
      nome: tenantSchema.fontes.nome,
      url: tenantSchema.fontes.url,
      cidade: tenantSchema.fontes.cidade,
      estado: tenantSchema.fontes.estado,
      status: tenantSchema.fontes.status,
      ativa: tenantSchema.fontes.ativa,
      lastCrawl: tenantSchema.fontes.lastCrawl,
      crawlErro: tenantSchema.fontes.crawlErro,
      crawlProgress: tenantSchema.fontes.crawlProgress,
      createdAt: tenantSchema.fontes.createdAt,
      totalImoveis: sql<number>`(
        SELECT COUNT(*) FROM imoveis WHERE imoveis.fonte_id = fontes.id
      )`.mapWith(Number),
    })
    .from(tenantSchema.fontes)
    .orderBy(desc(tenantSchema.fontes.createdAt));

  return fontes;
}

export async function createFonte(data: {
  nome: string;
  url: string;
  cidade?: string;
  estado?: string;
}) {
  const [fonte] = await db
    .insert(tenantSchema.fontes)
    .values({
      nome: data.nome,
      url: data.url,
      cidade: data.cidade ?? null,
      estado: data.estado ?? null,
      status: "pendente",
    })
    .returning();
  return fonte;
}

export async function deleteFonte(id: string) {
  await db.delete(tenantSchema.fontes).where(eq(tenantSchema.fontes.id, id));
}

export async function deleteFontes(ids: string[]) {
  if (ids.length === 0) return 0;
  const result = await db
    .delete(tenantSchema.fontes)
    .where(inArray(tenantSchema.fontes.id, ids))
    .returning({ id: tenantSchema.fontes.id });
  return result.length;
}

export async function updateFonteStatus(
  id: string,
  status: string,
  erro?: string
) {
  await db
    .update(tenantSchema.fontes)
    .set({ status, crawlErro: erro ?? null, lastCrawl: new Date() })
    .where(eq(tenantSchema.fontes.id, id));
}

// ─── IMÓVEIS ──────────────────────────────────────────────────────────────────

export type FiltrosImoveis = {
  q?: string;
  tipo?: string;
  transacao?: string;
  cidade?: string;
  bairro?: string;
  precoMin?: number;
  precoMax?: number;
  areaMin?: number;
  areaMax?: number;
  quartosMin?: number;
  vagasMin?: number;
  sortBy?: "relevante" | "preco_asc" | "preco_desc" | "area_desc" | "recentes";
  page?: number;
  pageSize?: number;
};

export async function searchImoveis(filtros: FiltrosImoveis = {}) {
  const PAGE_SIZE = filtros.pageSize ?? 10;
  const page = Math.max(1, filtros.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [eq(tenantSchema.imoveis.disponivel, true)];

  if (filtros.q) {
    conditions.push(
      or(
        ilike(tenantSchema.imoveis.titulo, `%${filtros.q}%`),
        ilike(tenantSchema.imoveis.bairro, `%${filtros.q}%`),
        ilike(tenantSchema.imoveis.cidade, `%${filtros.q}%`),
      )!
    );
  }

  if (filtros.tipo)
    conditions.push(ilike(tenantSchema.imoveis.tipo, filtros.tipo));
  if (filtros.transacao)
    conditions.push(ilike(tenantSchema.imoveis.transacao, filtros.transacao));
  if (filtros.cidade)
    conditions.push(ilike(tenantSchema.imoveis.cidade, `%${filtros.cidade}%`));
  if (filtros.bairro)
    conditions.push(ilike(tenantSchema.imoveis.bairro, `%${filtros.bairro}%`));
  if (filtros.precoMin)
    conditions.push(sql`${tenantSchema.imoveis.preco}::numeric >= ${filtros.precoMin}`);
  if (filtros.precoMax)
    conditions.push(sql`${tenantSchema.imoveis.preco}::numeric <= ${filtros.precoMax}`);
  if (filtros.areaMin)
    conditions.push(sql`${tenantSchema.imoveis.areaM2}::numeric >= ${filtros.areaMin}`);
  if (filtros.areaMax)
    conditions.push(sql`${tenantSchema.imoveis.areaM2}::numeric <= ${filtros.areaMax}`);
  if (filtros.quartosMin)
    conditions.push(gte(tenantSchema.imoveis.quartos, filtros.quartosMin));
  if (filtros.vagasMin)
    conditions.push(gte(tenantSchema.imoveis.vagas, filtros.vagasMin));

  const whereClause = and(...conditions);
  const orderBy =
    filtros.sortBy === "preco_asc"
      ? [asc(sql`${tenantSchema.imoveis.preco}::numeric`), desc(tenantSchema.imoveis.createdAt)]
      : filtros.sortBy === "preco_desc"
        ? [desc(sql`${tenantSchema.imoveis.preco}::numeric`), desc(tenantSchema.imoveis.createdAt)]
        : filtros.sortBy === "area_desc"
          ? [desc(sql`${tenantSchema.imoveis.areaM2}::numeric`), desc(tenantSchema.imoveis.createdAt)]
          : [desc(tenantSchema.imoveis.createdAt)];

  const [{ total }] = await db
    .select({ total: count() })
    .from(tenantSchema.imoveis)
    .where(whereClause);

  const imoveis = await db
    .select({
      id: tenantSchema.imoveis.id,
      titulo: tenantSchema.imoveis.titulo,
      tipo: tenantSchema.imoveis.tipo,
      transacao: tenantSchema.imoveis.transacao,
      preco: tenantSchema.imoveis.preco,
      bairro: tenantSchema.imoveis.bairro,
      cidade: tenantSchema.imoveis.cidade,
      estado: tenantSchema.imoveis.estado,
      areaM2: tenantSchema.imoveis.areaM2,
      quartos: tenantSchema.imoveis.quartos,
      banheiros: tenantSchema.imoveis.banheiros,
      vagas: tenantSchema.imoveis.vagas,
      urlAnuncio: tenantSchema.imoveis.urlAnuncio,
      imagens: tenantSchema.imoveis.imagens,
      disponivel: tenantSchema.imoveis.disponivel,
      fonteId: tenantSchema.imoveis.fonteId,
      fonteNome: tenantSchema.fontes.nome,
      fonteUrl: tenantSchema.fontes.url,
    })
    .from(tenantSchema.imoveis)
    .leftJoin(
      tenantSchema.fontes,
      eq(tenantSchema.imoveis.fonteId, tenantSchema.fontes.id)
    )
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset(offset);

  return { imoveis, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) };
}

// ─── SEARCHES (HISTÓRICO) ─────────────────────────────────────────────────────

export async function getSearches(userId: string) {
  return db
    .select()
    .from(tenantSchema.searches)
    .where(eq(tenantSchema.searches.userId, userId))
    .orderBy(desc(tenantSchema.searches.createdAt))
    .limit(50);
}

export async function createSearch(data: {
  userId: string;
  titulo?: string;
  filtros?: unknown;
  resultado?: unknown;
}) {
  const [search] = await db
    .insert(tenantSchema.searches)
    .values({
      userId: data.userId,
      titulo: data.titulo ?? null,
      filtros: data.filtros as never ?? null,
      resultado: data.resultado as never ?? null,
    })
    .returning();
  return search;
}

// ─── FAVORITOS ────────────────────────────────────────────────────────────────

export async function getFavoritos(userId: string) {
  return db
    .select({
      id: tenantSchema.favoritos.id,
      nota: tenantSchema.favoritos.nota,
      createdAt: tenantSchema.favoritos.createdAt,
      imovel: {
        id: tenantSchema.imoveis.id,
        titulo: tenantSchema.imoveis.titulo,
        tipo: tenantSchema.imoveis.tipo,
        preco: tenantSchema.imoveis.preco,
        bairro: tenantSchema.imoveis.bairro,
        cidade: tenantSchema.imoveis.cidade,
        areaM2: tenantSchema.imoveis.areaM2,
        quartos: tenantSchema.imoveis.quartos,
        banheiros: tenantSchema.imoveis.banheiros,
        vagas: tenantSchema.imoveis.vagas,
        urlAnuncio: tenantSchema.imoveis.urlAnuncio,
      },
      fonteUrl: tenantSchema.fontes.url,
    })
    .from(tenantSchema.favoritos)
    .innerJoin(
      tenantSchema.imoveis,
      eq(tenantSchema.favoritos.imovelId, tenantSchema.imoveis.id)
    )
    .leftJoin(
      tenantSchema.fontes,
      eq(tenantSchema.imoveis.fonteId, tenantSchema.fontes.id)
    )
    .where(eq(tenantSchema.favoritos.userId, userId))
    .orderBy(desc(tenantSchema.favoritos.createdAt));
}

export async function toggleFavorito(userId: string, imovelId: string) {
  const [existing] = await db
    .select({ id: tenantSchema.favoritos.id })
    .from(tenantSchema.favoritos)
    .where(
      and(
        eq(tenantSchema.favoritos.userId, userId),
        eq(tenantSchema.favoritos.imovelId, imovelId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .delete(tenantSchema.favoritos)
      .where(eq(tenantSchema.favoritos.id, existing.id));
    return false; // removido
  } else {
    await db.insert(tenantSchema.favoritos).values({ userId, imovelId });
    return true; // adicionado
  }
}

export async function getFavoritosIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ imovelId: tenantSchema.favoritos.imovelId })
    .from(tenantSchema.favoritos)
    .where(eq(tenantSchema.favoritos.userId, userId));
  return rows.map((r) => r.imovelId);
}

// ─── NAV STATS (para a Sidebar) ───────────────────────────────────────────────

export async function getNavStats() {
  const [[fontesCount], [fontesErro]] = await Promise.all([
    db.select({ total: count() }).from(tenantSchema.fontes).where(eq(tenantSchema.fontes.ativa, true)),
    db.select({ total: count() }).from(tenantSchema.fontes).where(eq(tenantSchema.fontes.status, "erro")),
  ]);
  return {
    fontesUsed: fontesCount.total,
    fontesErroCount: fontesErro.total,
  };
}

// ─── CRAWLER HELPERS ──────────────────────────────────────────────────────────

export async function getFonteById(id: string) {
  const [fonte] = await db
    .select()
    .from(tenantSchema.fontes)
    .where(eq(tenantSchema.fontes.id, id))
    .limit(1);
  return fonte ?? null;
}

export type ImovelInput = {
  urlAnuncio: string;
  titulo?: string | null;
  tipo?: string | null;
  cidade?: string | null;
  bairro?: string | null;
  estado?: string | null;
  preco?: number | null;
  areaM2?: number | null;
  quartos?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  descricao?: string | null;
  imagens?: string[];
  caracteristicas?: Record<string, unknown>;
};

export async function upsertImoveis(fonteId: string, items: ImovelInput[]) {
  if (items.length === 0) return;

  const CHUNK = 50;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await db
      .insert(tenantSchema.imoveis)
      .values(
        chunk.map((item) => ({
          fonteId,
          urlAnuncio: item.urlAnuncio,
          titulo: item.titulo ?? null,
          tipo: item.tipo ?? null,
          cidade: item.cidade ?? null,
          bairro: item.bairro ?? null,
          estado: item.estado ?? null,
          preco: item.preco != null ? String(item.preco) : null,
          areaM2: item.areaM2 != null ? String(item.areaM2) : null,
          quartos: item.quartos ?? null,
          banheiros: item.banheiros ?? null,
          vagas: item.vagas ?? null,
          descricao: item.descricao ?? null,
          imagens: item.imagens ?? [],
          caracteristicas: (item.caracteristicas ?? {}) as never,
          disponivel: true,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoUpdate({
        target: tenantSchema.imoveis.urlAnuncio,
        set: {
          titulo: sql`excluded.titulo`,
          tipo: sql`excluded.tipo`,
          cidade: sql`excluded.cidade`,
          bairro: sql`excluded.bairro`,
          estado: sql`excluded.estado`,
          preco: sql`excluded.preco`,
          areaM2: sql`excluded.area_m2`,
          quartos: sql`excluded.quartos`,
          banheiros: sql`excluded.banheiros`,
          vagas: sql`excluded.vagas`,
          descricao: sql`excluded.descricao`,
          imagens: sql`excluded.imagens`,
          caracteristicas: sql`excluded.caracteristicas`,
          disponivel: true,
          updatedAt: new Date(),
        },
      });
  }
}

export async function markImoveisIndisponiveis(fonteId: string, urlsAtivas: string[]) {
  if (urlsAtivas.length === 0) return;
  // Fetch all imoveis for this fonte, mark those NOT in urlsAtivas as unavailable
  const all = await db
    .select({ id: tenantSchema.imoveis.id, urlAnuncio: tenantSchema.imoveis.urlAnuncio })
    .from(tenantSchema.imoveis)
    .where(eq(tenantSchema.imoveis.fonteId, fonteId));

  const activeSet = new Set(urlsAtivas);
  const idsToDisable = all.filter((r) => !activeSet.has(r.urlAnuncio)).map((r) => r.id);

  for (const id of idsToDisable) {
    await db
      .update(tenantSchema.imoveis)
      .set({ disponivel: false, updatedAt: new Date() })
      .where(eq(tenantSchema.imoveis.id, id));
  }
}

export async function deleteImoveisByFonteId(fonteId: string) {
  await db
    .delete(tenantSchema.imoveis)
    .where(eq(tenantSchema.imoveis.fonteId, fonteId));
}
