import { auth } from "@/auth";
import { getStats } from "@/lib/db/queries";
import { ProfileForm } from "./ProfileForm";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const stats = await getStats(userId);

  const userName = session!.user!.name ?? "";
  const userEmail = session!.user!.email ?? "";

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Configurações</div>
          <div className="topbar-sub">Gerencie seu workspace e conta</div>
        </div>
      </div>

      <div className="page-inner" style={{ maxWidth: 640 }}>
        {/* Perfil — client component para interatividade */}
        <ProfileForm defaultName={userName} email={userEmail} />

        {/* Plano */}
        <div className="card" style={{ marginBottom: "16px" }}>
          <div className="card-header">
            <div className="card-title">Plano atual</div>
            <span className="badge badge-gray">Gratuito</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-3)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: "4px",
                }}
              >
                Fontes cadastradas
              </div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)" }}>
                {stats.fontes}{" "}
                <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--text-3)" }}>/ 5</span>
              </div>
            </div>
            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-3)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: "4px",
                }}
              >
                Buscas realizadas
              </div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)" }}>
                {stats.searches}{" "}
                <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--text-3)" }}>
                  total
                </span>
              </div>
            </div>
          </div>
          <button className="btn btn-primary">Fazer upgrade para Pro</button>
        </div>

        {/* Zona de perigo */}
        <div className="card" style={{ borderColor: "rgba(220,38,38,0.2)" }}>
          <div className="card-header">
            <div className="card-title" style={{ color: "var(--danger)" }}>
              Zona de perigo
            </div>
          </div>
          <p style={{ fontSize: "13px", color: "var(--text-2)", marginBottom: "14px" }}>
            Excluir a conta remove permanentemente todos os seus dados, fontes e histórico de buscas.
          </p>
          <button className="btn btn-danger btn-sm">Excluir conta</button>
        </div>
      </div>
    </>
  );
}
