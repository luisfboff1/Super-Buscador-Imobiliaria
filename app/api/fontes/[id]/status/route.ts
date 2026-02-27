import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import * as tenantSchema from "@/lib/db/schema/tenant";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  const [fonte] = await db
    .select({
      status: tenantSchema.fontes.status,
      crawlProgress: tenantSchema.fontes.crawlProgress,
      crawlErro: tenantSchema.fontes.crawlErro,
      lastCrawl: tenantSchema.fontes.lastCrawl,
    })
    .from(tenantSchema.fontes)
    .where(eq(tenantSchema.fontes.id, id))
    .limit(1);

  if (!fonte) {
    return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    status: fonte.status,
    progress: fonte.crawlProgress,
    erro: fonte.crawlErro,
    lastCrawl: fonte.lastCrawl,
  });
}
