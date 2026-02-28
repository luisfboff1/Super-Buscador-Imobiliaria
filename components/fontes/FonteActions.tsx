"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Settings, Check, AlertCircle, Search, Zap, Loader2 } from "lucide-react";

interface CrawlProgress {
  fase: string;
  message: string;
  done: number;
  total: number;
  pct: number;
  enriched: number;
  failed: number;
  elapsed: string;
  logs: string[];
  finished: boolean;
}

interface FonteActionsProps {
  fonteId: string;
  status: string;
}

const FASE_LABELS: Record<string, { icon: React.ReactNode; label: string }> = {
  descoberta: { icon: <Search size={12} />, label: "Descobrindo imóveis" },
  enriquecimento: { icon: <Zap size={12} />, label: "Extraindo dados" },
  finalizando: { icon: <Loader2 size={12} className="crawl-spin" />, label: "Finalizando" },
  concluido: { icon: <Check size={12} />, label: "Concluído" },
};

export function FonteActions({ fonteId, status }: FonteActionsProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/fontes/${fonteId}/status`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.progress) {
        setProgress(data.progress as CrawlProgress);

        if (data.progress.finished || data.status === "ok") {
          stopPolling();
          // Aguarda 4s mostrando o resultado final, depois reseta
          setTimeout(() => {
            setSyncing(false);
            setProgress(null);
            router.refresh();
          }, 4000);
        }
      }

      if (data.status === "erro") {
        setError(data.erro || "Erro desconhecido");
        stopPolling();
        setSyncing(false);
      }
    } catch {
      // Silently retry on next poll
    }
  }, [fonteId, stopPolling, router]);

  // Reconecta o polling se o componente montar com um crawl já em andamento
  // (ex.: outro usuário/aba iniciou o crawl, ou a página foi recarregada durante um crawl)
  useEffect(() => {
    if (status === "crawling" && !pollRef.current) {
      setSyncing(true);
      setError(null);
      pollRef.current = setInterval(pollStatus, 2500);
      // Primeira poll imediata
      setTimeout(pollStatus, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  async function handleSincronizar() {
    setSyncing(true);
    setError(null);
    setProgress(null);

    try {
      const res = await fetch(`/api/fontes/${fonteId}/crawl`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erro ao iniciar");
        setSyncing(false);
        return;
      }

      // Começar polling a cada 2.5s
      pollRef.current = setInterval(pollStatus, 2500);
      // Primeira poll rapidinha
      setTimeout(pollStatus, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
      setSyncing(false);
    }
  }

  const fase = progress ? FASE_LABELS[progress.fase] ?? FASE_LABELS.descoberta : null;

  return (
    <div style={{ width: "100%" }}>
      {/* Progress panel */}
      {syncing && (
        <div className="crawl-progress">
          {/* Header with fase */}
          <div className="crawl-progress-header">
            <span className="crawl-fase">
              {fase?.icon}
              {fase?.label ?? "Iniciando..."}
            </span>
            {progress?.elapsed && (
              <span className="crawl-elapsed">{progress.elapsed}</span>
            )}
          </div>

          {/* Message */}
          {progress?.message && (
            <div className="crawl-message">{progress.message}</div>
          )}

          {/* Progress bar */}
          {progress && progress.total > 0 && (
            <div className="crawl-bar-container">
              <div className="crawl-bar">
                <div
                  className="crawl-bar-fill"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <span className="crawl-pct">{progress.pct}%</span>
            </div>
          )}

          {/* Stats row */}
          {progress && progress.enriched > 0 && (
            <div className="crawl-stats-row">
              <span>✅ {progress.enriched} extraídos</span>
              {progress.failed > 0 && <span>❌ {progress.failed} erros</span>}
              {progress.total > 0 && <span>{progress.done}/{progress.total}</span>}
            </div>
          )}

          {/* Recent logs */}
          {progress?.logs && progress.logs.length > 0 && (
            <div className="crawl-logs">
              {progress.logs.map((log, i) => (
                <div key={i} className="crawl-log-line">{log}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && !syncing && (
        <div className="crawl-error">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ flex: 1, justifyContent: "center" }}
          onClick={handleSincronizar}
          disabled={syncing}
        >
          <RefreshCw
            size={13}
            style={{ animation: syncing ? "spin 1s linear infinite" : undefined }}
          />
          {syncing
            ? "Sincronizando..."
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
    </div>
  );
}
