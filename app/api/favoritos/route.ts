import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFavoritos, toggleFavorito } from "@/lib/db/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const favoritos = await getFavoritos(session.user.id!);
  return NextResponse.json({ favoritos });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { imovelId } = await req.json();
  if (!imovelId) return NextResponse.json({ error: "imovelId é obrigatório" }, { status: 400 });

  const adicionado = await toggleFavorito(session.user.id!, imovelId);
  return NextResponse.json({ adicionado });
}
