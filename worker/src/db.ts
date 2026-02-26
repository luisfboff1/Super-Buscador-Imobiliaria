import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";

// ─── Schema (espelho do schema do app principal) ─────────────────────────────

export const fontes = pgTable("fontes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  url: text("url").notNull(),
  cidade: text("cidade"),
  estado: text("estado"),
  status: text("status").default("pendente"),
  ativa: boolean("ativa").default(true),
  lastCrawl: timestamp("last_crawl"),
  crawlErro: text("crawl_erro"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const imoveis = pgTable("imoveis", {
  id: uuid("id").primaryKey().defaultRandom(),
  fonteId: uuid("fonte_id").notNull(),
  urlAnuncio: text("url_anuncio").notNull().unique(),
  titulo: text("titulo"),
  tipo: text("tipo"),
  cidade: text("cidade"),
  bairro: text("bairro"),
  estado: text("estado"),
  preco: numeric("preco"),
  areaM2: numeric("area_m2"),
  quartos: integer("quartos"),
  banheiros: integer("banheiros"),
  vagas: integer("vagas"),
  descricao: text("descricao"),
  imagens: jsonb("imagens").default([]),
  caracteristicas: jsonb("caracteristicas").default({}),
  disponivel: boolean("disponivel").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Conexão ─────────────────────────────────────────────────────────────────

const client = postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {}, // silencia notices
});
export const db = drizzle(client);

// Teste de conexão no startup
client`SELECT 1`.then(() => {
  console.log("[db] ✓ Conectado ao Neon PostgreSQL via postgres-js");
}).catch((err: unknown) => {
  console.error("[db] ✗ ERRO de conexão:", err);
});

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getFonteById(id: string) {
  const [fonte] = await db.select().from(fontes).where(eq(fontes.id, id));
  return fonte ?? null;
}

export async function updateFonteStatus(
  id: string,
  status: string,
  erro?: string
) {
  await db
    .update(fontes)
    .set({
      status,
      crawlErro: erro ?? null,
      lastCrawl: status === "ok" ? new Date() : undefined,
    })
    .where(eq(fontes.id, id));
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

  const CHUNK = 10; // reduzido para evitar queries muito grandes
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    try {
    await db
      .insert(imoveis)
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
        target: imoveis.urlAnuncio,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = (err as Record<string, unknown>)?.cause;
      console.error(`[db] ✗ upsert falhou (chunk ${i}-${i + CHUNK}):`, msg);
      if (cause) console.error(`[db]   causa:`, cause);
      throw err;
    }
  }
}

export async function markImoveisIndisponiveis(
  fonteId: string,
  urlsAtivas: string[]
) {
  if (urlsAtivas.length === 0) return;
  const all = await db
    .select({ id: imoveis.id, urlAnuncio: imoveis.urlAnuncio })
    .from(imoveis)
    .where(eq(imoveis.fonteId, fonteId));

  const activeSet = new Set(urlsAtivas);
  const idsToDisable = all
    .filter((r) => !activeSet.has(r.urlAnuncio))
    .map((r) => r.id);

  for (const id of idsToDisable) {
    await db
      .update(imoveis)
      .set({ disponivel: false, updatedAt: new Date() })
      .where(eq(imoveis.id, id));
  }
}
