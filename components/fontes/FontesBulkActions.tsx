"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

interface FonteSummary {
  id: string;
  url: string;
  status: string;
  totalImoveis: number;
}

interface FontesBulkActionsProps {
  fontes: FonteSummary[];
}

export function FontesBulkActions({ fontes }: FontesBulkActionsProps) {
  const router = useRouter();
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = fontes.filter(
    (f) => f.status === "erro" || (f.status !== "crawling" && f.totalImoveis === 0)
  );
  const total = candidates.length;
  const erros = candidates.filter((f) => f.status === "erro").length;
  const zeros = total - erros;

  if (total === 0) return null;

  async function handleCleanup() {
    const partes: string[] = [];
    if (erros > 0) partes.push(`${erros} com erro`);
    if (zeros > 0) partes.push(`${zeros} sem imóveis`);
    const detalhe = partes.join(" e ");

    const confirmed = window.confirm(
      `Excluir ${total} fonte${total > 1 ? "s" : ""} (${detalhe})? Essa ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    setCleaning(true);
    setError(null);
    try {
      const res = await fetch("/api/fontes/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: candidates.map((f) => f.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Erro ao limpar fontes");
        setCleaning(false);
        return;
      }
      router.refresh();
      setCleaning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
      setCleaning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        className="btn btn-ghost"
        onClick={handleCleanup}
        disabled={cleaning}
        title="Exclui todas as fontes com erro ou sem imóveis"
        style={{ color: "var(--danger)" }}
      >
        {cleaning ? <Loader2 size={15} className="crawl-spin" /> : <Trash2 size={15} />}
        {cleaning ? "Limpando..." : `Limpar inválidas (${total})`}
      </button>
      {error && (
        <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>
      )}
    </div>
  );
}
