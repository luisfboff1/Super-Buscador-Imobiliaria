import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createImportJob } from "@/lib/db/queries";
import { inngest } from "@/lib/inngest/client";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { cidade, estado } = await req.json().catch(() => ({}));
  if (!cidade || typeof cidade !== "string" || cidade.trim().length < 2) {
    return NextResponse.json(
      { error: "Parâmetro 'cidade' é obrigatório" },
      { status: 400 }
    );
  }

  const job = await createImportJob(cidade.trim(), estado || "RS");

  await inngest.send({
    name: "creci/import.requested",
    data: { jobId: job.id, cidade: job.cidade },
  });

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
