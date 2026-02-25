import Link from "next/link";
import {
  Home,
  Link2,
  Clock,
  Heart,
  Search,
} from "lucide-react";

const recentSearches = [
  { query: "apartamento 2 quartos perto do parque moinhos", results: 42, date: "Hoje 14:32" },
  { query: "casa com terreno amplo até R$600k zona sul", results: 18, date: "Hoje 11:05" },
  { query: "studio ou loft próximo à PUCRS", results: 27, date: "Ontem" },
  { query: "kitnet aluguel bairro Floresta até R$1.500", results: 9, date: "22/02" },
];

const fontesStatus = [
  { url: "imobhorizonte.com.br", imoveis: 523, status: "ok" },
  { url: "casasul.imob.com.br", imoveis: 318, status: "ok" },
  { url: "imovelprime.com.br", imoveis: 0, status: "erro", detail: "Erro 403" },
  { url: "realtysul.com.br", imoveis: 142, status: "ok" },
  { url: "novacasa.imob.br", imoveis: 0, status: "sync", detail: "Sincronizando" },
];

export default function DashboardPage() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Dashboard</div>
          <div className="topbar-sub">Bem-vindo de volta, Mateus</div>
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
              <div className="stat-value">1.847</div>
              <div className="stat-delta positive">+124 esta semana</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(100,116,139,0.1)" }}>
              <Link2 size={17} style={{ color: "#475569" }} />
            </div>
            <div>
              <div className="stat-label">Fontes ativas</div>
              <div className="stat-value">5</div>
              <div className="stat-delta" style={{ color: "#dc2626" }}>3 com erro</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(37,99,235,0.07)" }}>
              <Clock size={17} style={{ color: "#2563eb" }} />
            </div>
            <div>
              <div className="stat-label">Buscas realizadas</div>
              <div className="stat-value">38</div>
              <div className="stat-delta positive">+8 hoje</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: "rgba(100,116,139,0.08)" }}>
              <Heart size={17} style={{ color: "#475569" }} />
            </div>
            <div>
              <div className="stat-label">Favoritos salvos</div>
              <div className="stat-value">12</div>
              <div className="stat-delta">2 novos resultados</div>
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "20px", marginTop: "8px" }}>
          {/* Recent searches */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Buscas recentes</div>
              <Link href="/historico" className="btn btn-ghost" style={{ fontSize: "12.5px", padding: "5px 12px" }}>
                Ver todas
              </Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Consulta</th>
                    <th>Resultados</th>
                    <th>Data</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentSearches.map((s, i) => (
                    <tr key={i}>
                      <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.query}
                      </td>
                      <td>
                        <span className="badge badge-blue">{s.results}</span>
                      </td>
                      <td style={{ color: "var(--text-3)", fontSize: 12 }}>{s.date}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm">Abrir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {fontesStatus.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
                    <span
                      className={`dot ${f.status === "ok" ? "dot-green" : f.status === "erro" ? "dot-red" : "dot-gray"}`}
                    />
                    <span style={{ flex: 1, color: f.status === "sync" ? "var(--text-3)" : "var(--text-2)" }}>
                      {f.url}
                    </span>
                    <span style={{ fontSize: "11.5px", color: "var(--text-3)" }}>
                      {f.status === "ok" ? `${f.imoveis} imóveis` : f.detail}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Upgrade card */}
            <div className="card" style={{ background: "linear-gradient(135deg,rgba(37,99,235,0.06),rgba(29,78,216,0.04))" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
                Upgrade para Pro
              </div>
              <div style={{ fontSize: "12.5px", color: "var(--text-2)", marginBottom: "14px", lineHeight: 1.5 }}>
                Suas buscas de IA chegaram a 6/10 hoje. O plano Pro oferece 100 buscas/dia.
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
