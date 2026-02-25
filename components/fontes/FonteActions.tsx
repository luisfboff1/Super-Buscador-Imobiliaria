"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Settings } from "lucide-react";

interface FonteActionsProps {
  fonteId: string;
  status: string;
}

export function FonteActions({ fonteId, status }: FonteActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSincronizar() {
    setLoading(true);
    setDone(false);
    try {
      const res = await fetch(`/api/fontes/${fonteId}/crawl`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setDone(true);
        router.refresh();
      }
      // data.status === "queued" (Inngest) ou "done" (síncrono)
      console.log("[crawl]", data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <button
        className="btn btn-ghost btn-sm"
        style={{ flex: 1, justifyContent: "center" }}
        onClick={handleSincronizar}
        disabled={loading}
      >
        <RefreshCw
          size={13}
          style={{ animation: loading ? "spin 1s linear infinite" : undefined }}
        />
        {loading
          ? "Sincronizando..."
          : done
          ? "Concluído ✓"
          : status === "erro"
          ? "Tentar novamente"
          : "Sincronizar"}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        style={{ flex: 1, justifyContent: "center" }}
      >
        <Settings size={13} />
        {status === "erro" ? "Editar URL" : "Configurar"}
      </button>
    </div>
  );
}
