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
  config: jsonb("config"),
  ativa: boolean("ativa").default(true).notNull(),
  lastCrawl: timestamp("last_crawl"),
  status: text("status").default("pendente").notNull(), // pendente | crawling | ok | erro
  crawlErro: text("crawl_erro"),
  crawlProgress: jsonb("crawl_progress"), // { fase, message, done, total, pct, logs[] }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const imoveis = pgTable("imoveis", {
  id: uuid("id").primaryKey().defaultRandom(),
  fonteId: uuid("fonte_id").references(() => fontes.id, { onDelete: "cascade" }).notNull(),
  urlAnuncio: text("url_anuncio").notNull().unique(),
  titulo: text("titulo"),
  tipo: text("tipo"), // apartamento | casa | terreno | comercial
  transacao: text("transacao"), // venda | aluguel | ambos
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

export const crawlRuns = pgTable("crawl_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  fonteId: uuid("fonte_id").references(() => fontes.id, { onDelete: "cascade" }).notNull(),
  pipelineVersion: text("pipeline_version").notNull(),
  stage: text("stage").notNull(),
  triggerMode: text("trigger_mode").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  elapsedMs: integer("elapsed_ms"),
  configSnapshot: jsonb("config_snapshot"),
  siteProfileSnapshot: jsonb("site_profile_snapshot"),
  summaryMetrics: jsonb("summary_metrics"),
});

export const crawlRunItems = pgTable("crawl_run_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => crawlRuns.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  itemType: text("item_type").notNull(),
  discovered: boolean("discovered").default(false).notNull(),
  extractedData: jsonb("extracted_data"),
  fieldSources: jsonb("field_sources"),
  fieldConfidence: jsonb("field_confidence"),
  validatorStatus: text("validator_status"),
  validatorReasons: jsonb("validator_reasons"),
  imagesMeta: jsonb("images_meta"),
  rawMetrics: jsonb("raw_metrics"),
});

export const crawlRunComparisons = pgTable("crawl_run_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  legacyRunId: uuid("legacy_run_id").references(() => crawlRuns.id, { onDelete: "cascade" }),
  candidateRunId: uuid("candidate_run_id").references(() => crawlRuns.id, { onDelete: "cascade" }),
  comparisonScope: text("comparison_scope").notNull(),
  reportJson: jsonb("report_json").notNull(),
  reportMarkdown: text("report_markdown").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const creciImportJobs = pgTable("creci_import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  cidade: text("cidade").notNull(),
  estado: text("estado").default("RS").notNull(),
  status: text("status").default("pending").notNull(), // pending | running | completed | failed
  total: integer("total").default(0).notNull(),
  enriched: integer("enriched").default(0).notNull(),
  imobiliarias: jsonb("imobiliarias"), // [{nome, nomeFantasia, creci, situacao, url}]
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tipos inferidos do schema
export type Fonte = typeof fontes.$inferSelect;
export type NovaFonte = typeof fontes.$inferInsert;
export type Imovel = typeof imoveis.$inferSelect;
export type NovoImovel = typeof imoveis.$inferInsert;
export type Search = typeof searches.$inferSelect;
export type Favorito = typeof favoritos.$inferSelect;
export type CrawlRun = typeof crawlRuns.$inferSelect;
export type CrawlRunItem = typeof crawlRunItems.$inferSelect;
export type CrawlRunComparison = typeof crawlRunComparisons.$inferSelect;
export type CreciImportJob = typeof creciImportJobs.$inferSelect;
