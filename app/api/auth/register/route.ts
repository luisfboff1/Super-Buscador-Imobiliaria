import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, authSchema } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "E-mail e senha são obrigatórios." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 8 caracteres." },
        { status: 400 }
      );
    }

    // Verifica se e-mail já existe
    const [existing] = await db
      .select({ id: authSchema.users.id })
      .from(authSchema.users)
      .where(eq(authSchema.users.email, email))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "Este e-mail já está cadastrado." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const [user] = await db
      .insert(authSchema.users)
      .values({
        name: name || null,
        email,
        password: hashedPassword,
      })
      .returning({ id: authSchema.users.id, email: authSchema.users.email });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/auth/register]", error);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
