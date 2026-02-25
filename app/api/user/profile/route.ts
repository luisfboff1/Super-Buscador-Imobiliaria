import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, authSchema } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { name } = await req.json();
  if (typeof name !== "string" || name.trim().length === 0)
    return NextResponse.json({ error: "Nome inválido" }, { status: 400 });

  await db
    .update(authSchema.users)
    .set({ name: name.trim() })
    .where(eq(authSchema.users.id, session.user.id));

  return NextResponse.json({ ok: true });
}
