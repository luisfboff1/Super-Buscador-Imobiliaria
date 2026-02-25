import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteFonte } from "@/lib/db/queries";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await deleteFonte(id);
  return NextResponse.json({ ok: true });
}
