"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Search, ExternalLink, CheckSquare, Square, Loader2 } from "lucide-react";

interface ImobiliariaCRECI {
  nome: string;
  nomeFantasia?: string | null;
  cidade: string;
  estado: string;
  url: string | null;
  creci?: string | null;
  situacao?: string | null;
}

interface JobStatus {
  id: string;
  cidade: string;
  estado: string;
  status: "pending" | "running" | "completed" | "failed";
  total: number;
  enriched: number;
  imobiliarias: ImobiliariaCRECI[];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export default function ImportarFontesPage() {
  const [cidade, setCidade] = useState("");
  const [loading, setLoading] = useState(false);
  const [importando, setImportando] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [urlsEditadas, setUrlsEditadas] = useState<Record<number, string>>({});
  const [importadosCount, setImportadosCount] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/creci/import/${jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as JobStatus;
      setJob(data);

      if (data.status === "completed") {
        stopPolling();
        setLoading(false);
        // Pré-seleciona todas com URL
        const comUrl = new Set<number>(
          data.imobiliarias
            .map((_, i) => i)
            .filter((i) => !!data.imobiliarias[i].url)
        );
        setSelecionados(comUrl);
      } else if (data.status === "failed") {
        stopPolling();
        setLoading(false);
        setErro(data.errorMessage || "Falha na importação");
      }
    } catch {
      // silently retry
    }
  }, [stopPolling]);

  async function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    if (!cidade.trim()) return;
    setLoading(true);
    setErro(null);
    setJob(null);
    setSelecionados(new Set());
    setUrlsEditadas({});
    setImportadosCount(null);

    try {
      const res = await fetch("/api/creci/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cidade: cidade.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao iniciar busca");

      // Inicia polling a cada 2.5s
      pollRef.current = setInterval(() => pollJob(data.jobId), 2500);
      // Primeira poll rápida
      setTimeout(() => pollJob(data.jobId), 800);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao buscar");
      setLoading(false);
    }
  }

  function toggleSelecionado(idx: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleTodos() {
    if (!job) return;
    if (selecionados.size === job.imobiliarias.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(job.imobiliarias.map((_, i) => i)));
    }
  }

  async function handleImportar() {
    if (!job || selecionados.size === 0) return;
    setImportando(true);

    const itens = [...selecionados]
      .map((idx) => {
        const item = job.imobiliarias[idx];
        const url = urlsEditadas[idx] ?? item.url;
        if (!url) return null;
        return {
          nome: item.nomeFantasia || item.nome,
          url,
          cidade: item.cidade,
          estado: item.estado,
        };
      })
      .filter(Boolean);

    let count = 0;
    for (const item of itens) {
      try {
        const res = await fetch("/api/fontes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (res.ok) count++;
      } catch {
        // ignora erros individuais
      }
    }

    setImportadosCount(count);
    setImportando(false);
  }

  const selecionadosComUrl = [...selecionados].filter((idx) => {
    const item = job?.imobiliarias[idx];
    return !!(urlsEditadas[idx] ?? item?.url);
  });

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link href="/fontes" className="btn btn-ghost btn-sm">
            <ArrowLeft size={14} />
            Voltar
          </Link>
          <div>
            <div className="topbar-title">Importar via CRECI</div>
            <div className="topbar-sub">
              Busque imobiliárias registradas no CRECI-RS por cidade
            </div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ maxWidth: 800 }}>
        {/* Form de busca */}
        <div className="card" style={{ marginBottom: 24 }}>
          <form onSubmit={handleBuscar} style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-2)",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Cidade
              </label>
              <input
                className="input"
                placeholder="Ex: Caxias do Sul"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                disabled={loading}
                style={{ width: "100%" }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !cidade.trim()}
              style={{ whiteSpace: "nowrap" }}
            >
              {loading ? (
                <>
                  <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                  Buscando...
                </>
              ) : (
                <>
                  <Search size={15} />
                  Buscar no CRECI
                </>
              )}
            </button>
          </form>

          {loading && (
            <div
              style={{
                marginTop: 16,
                padding: "12px 16px",
                background: "#f8fafc",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--text-2)",
              }}
            >
              {!job || job.status === "pending" ? (
                <>Iniciando busca no CRECI-RS...</>
              ) : job.total === 0 ? (
                <>Buscando imobiliárias da cidade...</>
              ) : (
                <>
                  <strong>{job.total}</strong> imobiliárias encontradas — descobrindo URLs:{" "}
                  <strong>{job.enriched}/{job.total}</strong>
                  {job.total > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        height: 4,
                        background: "#e2e8f0",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          background: "var(--primary)",
                          width: `${Math.round((job.enriched / job.total) * 100)}%`,
                          transition: "width 0.4s",
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Erro */}
        {erro && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            {erro}
          </div>
        )}

        {/* Sucesso de importação */}
        {importadosCount !== null && (
          <div
            className="alert"
            style={{
              marginBottom: 16,
              background: "#f0fdf4",
              borderColor: "rgba(34,197,94,0.25)",
              color: "#15803d",
            }}
          >
            <strong>{importadosCount} imobiliárias importadas!</strong>{" "}
            <Link href="/fontes" style={{ color: "inherit", textDecoration: "underline" }}>
              Ver lista de fontes →
            </Link>
          </div>
        )}

        {/* Resultados */}
        {job && job.status === "completed" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                <strong style={{ color: "var(--text)" }}>{job.total}</strong> imobiliárias
                encontradas em{" "}
                <strong style={{ color: "var(--text)" }}>{job.cidade}</strong>
                {" — "}
                <strong style={{ color: "var(--text)" }}>{job.enriched}</strong> com URL
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={toggleTodos}
                  style={{ fontSize: 12 }}
                >
                  {selecionados.size === job.imobiliarias.length
                    ? "Desmarcar todos"
                    : "Selecionar todos"}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleImportar}
                  disabled={importando || selecionadosComUrl.length === 0}
                >
                  {importando ? (
                    <>
                      <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                      Importando...
                    </>
                  ) : (
                    `Importar ${selecionadosComUrl.length} selecionadas`
                  )}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {job.imobiliarias.map((item, idx) => {
                const isSelected = selecionados.has(idx);
                const urlAtual = urlsEditadas[idx] ?? item.url ?? "";
                const temUrl = !!urlAtual;

                return (
                  <div
                    key={idx}
                    className="card"
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      cursor: "pointer",
                      border: isSelected
                        ? "1.5px solid var(--primary)"
                        : undefined,
                      opacity: !temUrl ? 0.6 : 1,
                    }}
                    onClick={() => toggleSelecionado(idx)}
                  >
                    <div style={{ flexShrink: 0, color: isSelected ? "var(--primary)" : "var(--text-3)" }}>
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "var(--text)",
                          marginBottom: 4,
                        }}
                      >
                        {item.nomeFantasia || item.nome}
                      </div>
                      {item.nomeFantasia && item.nomeFantasia !== item.nome && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--text-3)",
                            marginBottom: 2,
                            fontStyle: "italic",
                          }}
                        >
                          {item.nome}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {item.cidade}/{item.estado}
                        {item.creci && (
                          <span style={{ marginLeft: 8, opacity: 0.7 }}>
                            CRECI {item.creci}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* URL — editável */}
                    <div
                      style={{ flex: 1.5, minWidth: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        className="input"
                        value={urlAtual}
                        onChange={(e) =>
                          setUrlsEditadas((prev) => ({ ...prev, [idx]: e.target.value }))
                        }
                        placeholder="URL não encontrada — preencha manualmente"
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "5px 10px",
                        }}
                      />
                    </div>

                    {/* Link externo */}
                    {temUrl && (
                      <a
                        href={urlAtual}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: "var(--text-3)", flexShrink: 0 }}
                        title="Abrir site"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button
                className="btn btn-primary"
                onClick={handleImportar}
                disabled={importando || selecionadosComUrl.length === 0}
              >
                {importando ? (
                  <>
                    <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                    Importando...
                  </>
                ) : (
                  `Importar ${selecionadosComUrl.length} imobiliárias selecionadas`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
