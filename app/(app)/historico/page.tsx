import Link from "next/link";
import { Search, Clock, ArrowRight } from "lucide-react";

const historico = [
  {
    id: "1",
    query: "apartamento 2 quartos perto do parque moinhos",
    filtros: { tipo: "Apartamento", quartos: 2, cidade: "Porto Alegre" },
    resultados: 42,
    data: "Hoje às 14:32",
  },
  {
    id: "2",
    query: "casa com terreno amplo até R$600k zona sul",
    filtros: { tipo: "Casa", precoMax: 600000, cidade: "Porto Alegre" },
    resultados: 18,
    data: "Hoje às 11:05",
  },
  {
    id: "3",
    query: "studio ou loft próximo à PUCRS",
    filtros: { tipo: "Apartamento", cidade: "Porto Alegre" },
    resultados: 27,
    data: "Ontem às 16:20",
  },
  {
    id: "4",
    query: "kitnet aluguel bairro Floresta até R$1.500",
    filtros: { tipo: "Apartamento", cidade: "Porto Alegre", precoMax: 1500 },
    resultados: 9,
    data: "22/02 às 09:15",
  },
  {
    id: "5",
    query: "apartamento 3 dormitórios com suíte em Caxias do Sul",
    filtros: { tipo: "Apartamento", quartos: 3, cidade: "Caxias do Sul" },
    resultados: 15,
    data: "21/02 às 14:00",
  },
];

export default function HistoricoPage() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Histórico</div>
          <div className="topbar-sub">Suas buscas anteriores</div>
        </div>
      </div>

      <div className="page-inner">
        {historico.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Clock size={40} strokeWidth={1.25} />
            </div>
            <h3>Nenhuma busca ainda</h3>
            <p>Suas buscas aparecerão aqui para que você possa revisitá-las.</p>
            <Link href="/buscador" className="btn btn-primary">
              <Search size={14} />
              Fazer primeira busca
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {historico.map((item) => (
              <div key={item.id} className="card" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "9px",
                    background: "var(--primary-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Search size={15} style={{ color: "var(--primary)" }} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "13.5px",
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginBottom: "4px",
                    }}
                  >
                    {item.query}
                  </div>
                  <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "var(--text-3)" }}>
                    <span>
                      <Clock size={11} style={{ display: "inline", marginRight: "3px", verticalAlign: "middle" }} />
                      {item.data}
                    </span>
                    <span className="badge badge-blue">{item.resultados} resultados</span>
                    {item.filtros.tipo && <span>{item.filtros.tipo}</span>}
                    {item.filtros.cidade && <span>{item.filtros.cidade}</span>}
                  </div>
                </div>

                <Link href={`/buscador`} className="btn btn-ghost btn-sm">
                  Repetir
                  <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
