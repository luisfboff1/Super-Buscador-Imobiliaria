"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, ExternalLink, CheckSquare, Square, Loader2 } from "lucide-react";

interface ImobiliariaCRECI {
  nome: string;
  cidade: string;
  estado: string;
  url: string | null;
  creci?: string | null;
}

interface ResultadoCRECI {
  cidade: string;
  total: number;
  imobiliarias: ImobiliariaCRECI[];
}

export default function ImportarFontesPage() {
  const [cidade, setCidade] = useState("");
  const [loading, setLoading] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCRECI | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [urlsEditadas, setUrlsEditadas] = useState<Record<number, string>>({});
  const [importadosCount, setImportadosCount] = useState<number | null>(null);

  async function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    if (!cidade.trim()) return;
    setLoading(true);
    setErro(null);
    setResultado(null);
    setSelecionados(new Set());
    setUrlsEditadas({});
    setImportadosCount(null);

    try {
      const res = await fetch(`/api/creci/extract?cidade=${encodeURIComponent(cidade.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao buscar");
      setResultado(data);
      // Pré-seleciona todas com URL
      const comUrl = new Set<number>(
        data.imobiliarias
          .map((_: ImobiliariaCRECI, i: number) => i)
          .filter((i: number) => !!data.imobiliarias[i].url) as number[]
      );
      setSelecionados(comUrl);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao buscar");
    } finally {
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
    if (!resultado) return;
    if (selecionados.size === resultado.imobiliarias.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(resultado.imobiliarias.map((_, i) => i)));
    }
  }

  async function handleImportar() {
    if (!resultado || selecionados.size === 0) return;
    setImportando(true);

    const itens = [...selecionados]
      .map((idx) => {
        const item = resultado.imobiliarias[idx];
        const url = urlsEditadas[idx] ?? item.url;
        if (!url) return null;
        return {
          nome: item.nome,
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
    const item = resultado?.imobiliarias[idx];
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
              Buscando imobiliárias e descobrindo URLs via IA... Isso pode levar alguns
              segundos.
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
        {resultado && (
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
                <strong style={{ color: "var(--text)" }}>{resultado.total}</strong> imobiliárias
                encontradas em{" "}
                <strong style={{ color: "var(--text)" }}>{resultado.cidade || cidade}</strong>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={toggleTodos}
                  style={{ fontSize: 12 }}
                >
                  {selecionados.size === resultado.imobiliarias.length
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
              {resultado.imobiliarias.map((item, idx) => {
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
                        {item.nome}
                      </div>
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
