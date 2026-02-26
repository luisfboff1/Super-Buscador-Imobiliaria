import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { crawlFonteFunction } from "@/lib/inngest/functions/crawl-fonte";
import { enrichBatchFunction } from "@/lib/inngest/functions/enrich-batch";

// Aumenta o timeout máximo da função Vercel para 300s (5 min)
// Necessário porque cada step do Inngest chama esta rota e o crawl pode demorar
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [crawlFonteFunction, enrichBatchFunction],
});
