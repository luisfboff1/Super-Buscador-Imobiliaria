import {
  pgTable,
  uuid,
  text,
  boolean,
  numeric,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Schema por tenant — replicado para cada organização

export const fontes = pgTable("fontes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  url: text("url").unique().notNull(),
  cidade: text("cidade"),
  estado: text("estado"),
  ativa: boolean("ativa").default(true).notNull(),
  lastCrawl: timestamp("last_crawl"),
  status: text("status").default("pendente").notNull(), // pendente | crawling | ok | erro
  crawlErro: text("crawl_erro"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const imoveis = pgTable("imoveis", {
  id: uuid("id").primaryKey().defaultRandom(),
  fonteId: uuid("fonte_id").references(() => fontes.id, { onDelete: "cascade" }).notNull(),
  urlAnuncio: text("url_anuncio").notNull(),
  titulo: text("titulo"),
  tipo: text("tipo"), // apartamento | casa | terreno | comercial
  cidade: text("cidade"),
  bairro: text("bairro"),
  estado: text("estado"),
  preco: numeric("preco"),
  areaM2: numeric("area_m2"),
  quartos: integer("quartos"),
  banheiros: integer("banheiros"),
  vagas: integer("vagas"),
  descricao: text("descricao"),
  imagens: text("imagens").array(),
  caracteristicas: jsonb("caracteristicas"),
  disponivel: boolean("disponivel").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const searches = pgTable("searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(), // clerk user_id
  titulo: text("titulo"),
  filtros: jsonb("filtros"),
  resultado: jsonb("resultado"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  searchId: uuid("search_id").references(() => searches.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(), // user | assistant | tool
  content: text("content"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const favoritos = pgTable("favoritos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  imovelId: uuid("imovel_id").references(() => imoveis.id, { onDelete: "cascade" }).notNull(),
  nota: text("nota"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tipos inferidos do schema
export type Fonte = typeof fontes.$inferSelect;
export type NovaFonte = typeof fontes.$inferInsert;
export type Imovel = typeof imoveis.$inferSelect;
export type NovoImovel = typeof imoveis.$inferInsert;
export type Search = typeof searches.$inferSelect;
export type Favorito = typeof favoritos.$inferSelect;
