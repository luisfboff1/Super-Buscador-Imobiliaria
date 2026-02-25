import Link from "next/link";
import { Plus, RefreshCw, AlertTriangle } from "lucide-react";

// Dados mockados — serão substituídos por dados reais do banco
const fontes = [
  {
    id: "1",
    url: "imobhorizonte.com.br",
    nome: "Imob Horizonte",
    imoveis: 523,
    lastSync: "hoje 14:20",
    status: "ok" as const,
    erros: 8,
  },
  {
    id: "2",
    url: "casasul.imob.com.br",
    nome: "Casa Sul",
    imoveis: 318,
    lastSync: "hoje 13:55",
    status: "ok" as const,
    erros: 2,
  },
  {
    id: "3",
    url: "imovelprime.com.br",
    nome: "Imóvel Prime",
    imoveis: 0,
    lastSync: "hoje 12:00",
    status: "erro" as const,
    detail: "Erro 403 — Acesso negado",
  },
  {
    id: "4",
    url: "realtysul.com.br",
    nome: "Realty Sul",
    imoveis: 142,
    lastSync: "hoje 11:30",
    status: "ok" as const,
    erros: 0,
  },
];

const statusLabel: Record<string, { label: string; badge: string; dot: string }> = {
  ok: { label: "Ativo", badge: "badge-success", dot: "dot-green" },
  erro: { label: "Erro", badge: "badge-danger", dot: "dot-red" },
  sync: { label: "Sincronizando", badge: "badge-gray", dot: "dot-blue" },
  pendente: { label: "Pendente", badge: "badge-gray", dot: "dot-gray" },
};

export default function FontesPage() {
  const errosCount = fontes.filter((f) => f.status === "erro").length;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Fontes</div>
          <div className="topbar-sub">Gerencie as imobiliárias que o sistema rastreia</div>
        </div>
        <div className="topbar-actions">
          <Link href="/fontes/nova" className="btn btn-primary">
            <Plus size={15} />
            Adicionar fonte
          </Link>
        </div>
      </div>

      <div className="page-inner">
        {errosCount > 0 && (
          <div className="alert alert-warning">
            <AlertTriangle size={16} />
            <div>
              <strong>{errosCount} fonte{errosCount > 1 ? "s" : ""} com erro</strong> — Verifique as URLs ou tente sincronizar novamente.
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
          {fontes.map((fonte) => {
            const s = statusLabel[fonte.status];
            return (
              <div
                key={fonte.id}
                className="card"
                style={
                  fonte.status === "erro"
                    ? { borderColor: "rgba(239,68,68,0.25)", background: "rgba(254,242,242,0.6)" }
                    : {}
                }
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                  <span className={`dot ${s.dot}`} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--text)" }}>
                      {fonte.url}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: fonte.status === "erro" ? "var(--danger)" : "var(--text-3)",
                      }}
                    >
                      {fonte.status === "erro" ? fonte.detail : `Última sinc: ${fonte.lastSync}`}
                    </div>
                  </div>
                  <span className={`badge ${s.badge}`}>{s.label}</span>
                </div>

                <div style={{ display: "flex", gap: "16px", fontSize: "12.5px", color: "var(--text-3)", marginBottom: "14px" }}>
                  {fonte.status !== "erro" && <span>{fonte.imoveis} imóveis</span>}
                  {fonte.erros != null && fonte.erros > 0 && <span>{fonte.erros} erros ignorados</span>}
                  {fonte.status === "erro" && (
                    <span>Última tentativa: {fonte.lastSync} — 0 imóveis</span>
                  )}
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: "center" }}>
                    <RefreshCw size={13} />
                    {fonte.status === "erro" ? "Tentar novamente" : "Sincronizar"}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: "center" }}>
                    {fonte.status === "erro" ? "Editar URL" : "Configurar"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add new fonte card */}
          <Link
            href="/fontes/nova"
            className="card"
            style={{
              borderStyle: "dashed",
              background: "rgba(248,250,252,0.7)",
              cursor: "pointer",
              textDecoration: "none",
              display: "block",
            }}
          >
            <div style={{ textAlign: "center", padding: "20px 12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  background: "#f1f5f9",
                  border: "1.5px dashed #cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 10px",
                }}
              >
                <Plus size={16} style={{ color: "#94a3b8" }} />
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-3)" }}>
                Adicionar nova fonte
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-3)", marginTop: "4px" }}>
                Cole a URL da imobiliária
              </div>
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}
