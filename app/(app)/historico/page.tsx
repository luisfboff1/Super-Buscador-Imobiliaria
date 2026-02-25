import Link from "next/link";
import { Search, Clock, ArrowRight } from "lucide-react";
import { auth } from "@/auth";
import { getSearches } from "@/lib/db/queries";

function formatDate(date: Date) {
  const now = new Date();
  const hours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (hours < 24) return `Hoje às ${time}`;
  if (hours < 48) return `Ontem às ${time}`;
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${time}`;
}

export default async function HistoricoPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const historico = await getSearches(userId);

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
            {historico.map((item) => {
              const filtros = (item.filtros as Record<string, unknown> | null) ?? {};
              return (
                <div
                  key={item.id}
                  className="card"
                  style={{ display: "flex", alignItems: "center", gap: "16px" }}
                >
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
                      {item.titulo ?? "Busca sem título"}
                    </div>
                    <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "var(--text-3)" }}>
                      <span>
                        <Clock
                          size={11}
                          style={{ display: "inline", marginRight: "3px", verticalAlign: "middle" }}
                        />
                        {formatDate(new Date(item.createdAt))}
                      </span>
                      {!!filtros.tipo && <span>{String(filtros.tipo)}</span>}
                      {!!filtros.cidade && <span>{String(filtros.cidade)}</span>}
                    </div>
                  </div>

                  <Link href="/buscador" className="btn btn-ghost btn-sm">
                    Repetir
                    <ArrowRight size={13} />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
