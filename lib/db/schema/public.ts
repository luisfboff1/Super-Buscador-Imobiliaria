import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Tabelas do schema público (compartilhadas entre tenants)

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(), // clerk org_id
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  plan: text("plan").default("free").notNull(), // free | pro | enterprise
  schemaName: text("schema_name").unique().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceMonthly: integer("price_monthly"), // em centavos BRL
  maxFontes: integer("max_fontes"),
  maxSearchesDay: integer("max_searches_day"),
  aiSearches: boolean("ai_searches").default(false),
});
