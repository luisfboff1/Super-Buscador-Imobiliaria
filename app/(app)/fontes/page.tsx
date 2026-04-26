import Link from "next/link";
import { Plus, AlertTriangle, Building } from "lucide-react";
import { getFontesComContagem } from "@/lib/db/queries";
import { FonteActions } from "@/components/fontes/FonteActions";
import { FontesBulkActions } from "@/components/fontes/FontesBulkActions";

const statusLabel: Record<string, { label: string; badge: string; dot: string }> = {
  ok: { label: "Ativo", badge: "badge-success", dot: "dot-green" },
  erro: { label: "Erro", badge: "badge-danger", dot: "dot-red" },
  crawling: { label: "Sincronizando", badge: "badge-info", dot: "dot-blue" },
  sync: { label: "Sincronizando", badge: "badge-info", dot: "dot-blue" },
  pendente: { label: "Pendente", badge: "badge-gray", dot: "dot-gray" },
};

function formatLastCrawl(date: Date | null) {
  if (!date) return "Nunca sincronizado";
  const now = new Date();
  const hours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (hours < 24)
    return `hoje ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  if (hours < 48) return "ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default async function FontesPage() {
  const fontes = await getFontesComContagem();
  const errosCount = fontes.filter((f) => f.status === "erro").length;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Fontes</div>
          <div className="topbar-sub">Gerencie as imobiliárias que o sistema rastreia</div>
        </div>
        <div className="topbar-actions">
          <FontesBulkActions
            fontes={fontes.map((f) => ({
              id: f.id,
              url: f.url,
              status: f.status,
              totalImoveis: f.totalImoveis,
            }))}
          />
          <Link href="/fontes/importar" className="btn btn-ghost">
            <Building size={15} />
            Importar via CRECI
          </Link>
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
              <strong>
                {errosCount} fonte{errosCount > 1 ? "s" : ""} com erro
              </strong>{" "}
              — Verifique as URLs ou tente sincronizar novamente.
            </div>
          </div>
        )}

        <div className="grid-2">
          {fontes.map((fonte) => {
            const s = statusLabel[fonte.status] ?? statusLabel.pendente;
            const lastCrawlDate = fonte.lastCrawl ? new Date(fonte.lastCrawl) : null;
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
                      {fonte.status === "erro"
                        ? (fonte.crawlErro ?? "Erro desconhecido")
                        : `Última sinc: ${formatLastCrawl(lastCrawlDate)}`}
                    </div>
                  </div>
                  <span className={`badge ${s.badge}`}>{s.label}</span>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    fontSize: "12.5px",
                    color: "var(--text-3)",
                    marginBottom: "14px",
                  }}
                >
                  {fonte.status !== "erro" && <span>{fonte.totalImoveis} imóveis</span>}
                  {fonte.status === "erro" && (
                    <span>
                      Última tentativa: {formatLastCrawl(lastCrawlDate)} — 0 imóveis
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <FonteActions fonteId={fonte.id} status={fonte.status} />
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
