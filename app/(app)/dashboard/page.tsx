import Link from "next/link";
import { Home, Link2, Clock, Heart, Search } from "lucide-react";
import { auth } from "@/auth";
import { getStats, getSearches, getFontesComContagem } from "@/lib/db/queries";

function formatDate(date: Date) {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24)
    return `Hoje ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  if (hours < 48) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const firstName = (session!.user!.name ?? session!.user!.email ?? "Usuário").split(" ")[0];

  const [stats, searches, fontes] = await Promise.all([
    getStats(userId),
    getSearches(userId),
    getFontesComContagem(),
  ]);

  const recentSearches = searches.slice(0, 4);
  const fontesStatus = fontes.slice(0, 5);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Dashboard</div>
          <div className="topbar-sub">Bem-vindo de volta, {firstName}</div>
        </div>
        <div className="topbar-actions">
          <Link href="/buscador" className="btn btn-primary">
            <Search size={15} />
            Nova busca
          </Link>
        </div>
      </div>

      <div className="page-inner">
        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(37,99,235,0.1)" }}>
              <Home size={17} style={{ color: "#2563eb" }} />
            </div>
            <div>
              <div className="stat-label">Imóveis indexados</div>
              <div className="stat-value">{stats.imoveis.toLocaleString("pt-BR")}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(100,116,139,0.1)" }}>
              <Link2 size={17} style={{ color: "#475569" }} />
            </div>
            <div>
              <div className="stat-label">Fontes ativas</div>
              <div className="stat-value">{stats.fontes}</div>
              {stats.fontesErro > 0 && (
                <div className="stat-delta" style={{ color: "#dc2626" }}>
                  {stats.fontesErro} com erro
                </div>
              )}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(37,99,235,0.07)" }}>
              <Clock size={17} style={{ color: "#2563eb" }} />
            </div>
            <div>
              <div className="stat-label">Buscas realizadas</div>
              <div className="stat-value">{stats.searches}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(100,116,139,0.08)" }}>
              <Heart size={17} style={{ color: "#475569" }} />
            </div>
            <div>
              <div className="stat-label">Favoritos salvos</div>
              <div className="stat-value">{stats.favoritos}</div>
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div className="grid-sidebar">
          {/* Recent searches */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Buscas recentes</div>
              <Link href="/historico" className="btn btn-ghost" style={{ fontSize: "12.5px", padding: "5px 12px" }}>
                Ver todas
              </Link>
            </div>
            {recentSearches.length === 0 ? (
              <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-3)", fontSize: "13px" }}>
                Nenhuma busca realizada ainda.{" "}
                <Link href="/buscador" style={{ color: "var(--primary)" }}>
                  Fazer a primeira busca →
                </Link>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Consulta</th>
                      <th>Data</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSearches.map((s) => (
                      <tr key={s.id}>
                        <td
                          style={{
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.titulo ?? "Busca sem título"}
                        </td>
                        <td style={{ color: "var(--text-3)", fontSize: 12 }}>
                          {formatDate(new Date(s.createdAt))}
                        </td>
                        <td>
                          <Link href="/buscador" className="btn btn-ghost btn-sm">
                            Repetir
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Fontes status */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Status das fontes</div>
                <Link href="/fontes" style={{ fontSize: "12px", color: "var(--primary)", textDecoration: "none" }}>
                  Gerenciar
                </Link>
              </div>
              {fontesStatus.length === 0 ? (
                <div style={{ fontSize: "12.5px", color: "var(--text-3)" }}>
                  Nenhuma fonte cadastrada.{" "}
                  <Link href="/fontes/nova" style={{ color: "var(--primary)" }}>
                    Adicionar →
                  </Link>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {fontesStatus.map((f) => (
                    <div
                      key={f.id}
                      style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}
                    >
                      <span
                        className={`dot ${
                          f.status === "ok"
                            ? "dot-green"
                            : f.status === "erro"
                            ? "dot-red"
                            : "dot-gray"
                        }`}
                      />
                      <span style={{ flex: 1, color: f.status === "sync" ? "var(--text-3)" : "var(--text-2)" }}>
                        {f.url}
                      </span>
                      <span style={{ fontSize: "11.5px", color: "var(--text-3)" }}>
                        {f.status === "ok"
                          ? `${f.totalImoveis} imóveis`
                          : f.crawlErro ?? f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upgrade card */}
            <div
              className="card"
              style={{ background: "linear-gradient(135deg,rgba(37,99,235,0.06),rgba(29,78,216,0.04))" }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
                Upgrade para Pro
              </div>
              <div style={{ fontSize: "12.5px", color: "var(--text-2)", marginBottom: "14px", lineHeight: 1.5 }}>
                O plano Pro oferece 100 buscas de IA por dia e fontes ilimitadas.
              </div>
              <Link
                href="/configuracoes/plano"
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center", display: "flex", fontSize: "13px" }}
              >
                Ver planos
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
