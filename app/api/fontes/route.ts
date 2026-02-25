import { NextRequest, NextResponse } from "next/server";
// import { db } from "@/lib/db";
// import { tenantSchema } from "@/lib/db";

// GET /api/fontes — lista todas as fontes do tenant
export async function GET() {
  try {
    // TODO: autenticar com Clerk e resolver tenant
    // const { orgId } = await auth();
    // const fontes = await db.select().from(tenantSchema.fontes);

    // Mock temporário para desenvolvimento
    const fontes = [
      {
        id: "1",
        nome: "Imob Horizonte",
        url: "https://imobhorizonte.com.br",
        cidade: "Caxias do Sul",
        estado: "RS",
        status: "ok",
        imoveis: 523,
        lastCrawl: new Date().toISOString(),
        ativa: true,
      },
    ];

    return NextResponse.json({ fontes });
  } catch (error) {
    console.error("[GET /api/fontes]", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

// POST /api/fontes — cria uma nova fonte
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nome, url, cidade, estado } = body;

    if (!nome || !url) {
      return NextResponse.json(
        { error: "nome e url são obrigatórios" },
        { status: 400 }
      );
    }

    // TODO: validar URL acessível, salvar no banco, disparar crawl via Inngest
    // const [fonte] = await db.insert(tenantSchema.fontes).values({
    //   nome, url, cidade, estado, status: "pendente",
    // }).returning();

    const fonte = { id: crypto.randomUUID(), nome, url, cidade, estado, status: "pendente", createdAt: new Date().toISOString() };

    return NextResponse.json({ fonte }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/fontes]", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
