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
  const pollStartRef = useRef<number | null>(null);
  const lastProgressRef = useRef<{ done: number; ts: number } | null>(null);

  // Máximo: 60 min polling (crawls longos são legítimos com heartbeat ativo)
  // Sem progresso por 2 min = backup de segurança (servidor detecta em ~90s)
  const POLL_MAX_MS = 60 * 60 * 1000;
  const STALL_MS = 2 * 60 * 1000;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollStartRef.current = null;
    lastProgressRef.current = null;
  }, []);

  const pollStatus = useCallback(async () => {
    // Timeout global: para se passou do limite máximo
    const now = Date.now();
    if (pollStartRef.current && now - pollStartRef.current > POLL_MAX_MS) {
      setError("Crawl sem resposta — o worker pode ter sido reiniciado. Tente sincronizar novamente.");
      stopPolling();
      setSyncing(false);
      return;
    }

    try {
      const res = await fetch(`/api/fontes/${fonteId}/status`);
      if (!res.ok) return;
      const data = await res.json();

      // Se o worker reiniciou e resetou o status, parar polling
      if (data.status === "erro" && data.progress?.finished) {
        setError(data.erro || "Crawl interrompido");
        stopPolling();
        setSyncing(false);
        return;
      }

      if (data.progress) {
        setProgress(data.progress as CrawlProgress);

        // Detecta travamento: progresso parado por STALL_MS
        const done = (data.progress as CrawlProgress).done ?? 0;
        const last = lastProgressRef.current;
        if (!last || done !== last.done) {
          lastProgressRef.current = { done, ts: now };
        } else if (now - last.ts > STALL_MS && !data.progress.finished) {
          setError("Crawl parece travado (sem progresso há 8 min). Verifique o worker ou tente novamente.");
          stopPolling();
          setSyncing(false);
          return;
        }

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
      pollStartRef.current = Date.now();
      lastProgressRef.current = null;
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
      pollStartRef.current = Date.now();
      lastProgressRef.current = null;
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
