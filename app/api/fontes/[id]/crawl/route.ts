import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFonteById } from "@/lib/db/queries";
import { inngest } from "@/lib/inngest/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  const fonte = await getFonteById(id);
  if (!fonte) {
    return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 });
  }

  // Dispara o job no Inngest
  await inngest.send({
    name: "fontes/crawl.requested",
    data: { fonteId: id },
  });

  return NextResponse.json({ status: "queued", fonteId: id });
}
