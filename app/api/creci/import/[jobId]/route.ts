import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getImportJob } from "@/lib/db/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await getImportJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    cidade: job.cidade,
    estado: job.estado,
    status: job.status,
    total: job.total,
    enriched: job.enriched,
    imobiliarias: job.imobiliarias ?? [],
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  });
}
