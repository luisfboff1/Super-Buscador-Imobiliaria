import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteFontes } from "@/lib/db/queries";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids deve ser um array de strings" }, { status: 400 });
  }

  const deleted = await deleteFontes(ids);
  return NextResponse.json({ ok: true, deleted });
}
