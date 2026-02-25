import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFontesComContagem, createFonte } from "@/lib/db/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const fontes = await getFontesComContagem();
  return NextResponse.json({ fontes });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { nome, url, cidade, estado } = await req.json();
  if (!nome || !url) {
    return NextResponse.json({ error: "nome e url são obrigatórios" }, { status: 400 });
  }

  const fonte = await createFonte({ nome, url, cidade, estado });
  return NextResponse.json({ fonte }, { status: 201 });
}
