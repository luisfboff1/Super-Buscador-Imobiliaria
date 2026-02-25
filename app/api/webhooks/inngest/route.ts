import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { crawlFonteFunction } from "@/lib/inngest/functions/crawl-fonte";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [crawlFonteFunction],
});
