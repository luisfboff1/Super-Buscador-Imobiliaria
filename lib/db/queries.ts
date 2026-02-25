import { count, eq, desc, and, gte, lte, ilike, sql } from "drizzle-orm";
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
  tipo?: string;
  cidade?: string;
  bairro?: string;
  precoMin?: number;
  precoMax?: number;
  areaMin?: number;
  quartosMin?: number;
  vagas?: number;
};

export async function searchImoveis(filtros: FiltrosImoveis = {}) {
  const conditions = [eq(tenantSchema.imoveis.disponivel, true)];

  if (filtros.tipo)
    conditions.push(ilike(tenantSchema.imoveis.tipo, filtros.tipo));
  if (filtros.cidade)
    conditions.push(ilike(tenantSchema.imoveis.cidade, `%${filtros.cidade}%`));
  if (filtros.bairro)
    conditions.push(ilike(tenantSchema.imoveis.bairro, `%${filtros.bairro}%`));
  if (filtros.precoMin)
    conditions.push(gte(tenantSchema.imoveis.preco, String(filtros.precoMin)));
  if (filtros.precoMax)
    conditions.push(lte(tenantSchema.imoveis.preco, String(filtros.precoMax)));
  if (filtros.areaMin)
    conditions.push(gte(tenantSchema.imoveis.areaM2, String(filtros.areaMin)));
  if (filtros.quartosMin)
    conditions.push(gte(tenantSchema.imoveis.quartos, filtros.quartosMin));

  const imoveis = await db
    .select({
      id: tenantSchema.imoveis.id,
      titulo: tenantSchema.imoveis.titulo,
      tipo: tenantSchema.imoveis.tipo,
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
    .where(and(...conditions))
    .orderBy(desc(tenantSchema.imoveis.createdAt))
    .limit(100);

  return imoveis;
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
