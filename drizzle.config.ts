import type { Config } from "drizzle-kit";
import { config } from "dotenv";

// drizzle-kit não lê .env.local automaticamente
config({ path: ".env.local" });

export default {
  schema: "./lib/db/schema",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
