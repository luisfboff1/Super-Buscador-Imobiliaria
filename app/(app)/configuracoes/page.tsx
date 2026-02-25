export default function ConfiguracoesPage() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Configurações</div>
          <div className="topbar-sub">Gerencie seu workspace e conta</div>
        </div>
      </div>

      <div className="page-inner" style={{ maxWidth: 640 }}>
        {/* Perfil */}
        <div className="card" style={{ marginBottom: "16px" }}>
          <div className="card-header">
            <div className="card-title">Perfil</div>
          </div>
          <div className="form-group">
            <label className="form-label">Nome</label>
            <input className="form-input" type="text" defaultValue="Mateus Rimoldi Facchin" />
          </div>
          <div className="form-group">
            <label className="form-label">E-mail</label>
            <input className="form-input" type="email" defaultValue="mateus@exemplo.com" disabled />
            <div className="form-hint">O e-mail não pode ser alterado.</div>
          </div>
          <button className="btn btn-primary">Salvar alterações</button>
        </div>

        {/* Plano */}
        <div className="card" style={{ marginBottom: "16px" }}>
          <div className="card-header">
            <div className="card-title">Plano atual</div>
            <span className="badge badge-gray">Gratuito</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "4px" }}>Fontes cadastradas</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)" }}>4 <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--text-3)" }}>/ 5</span></div>
            </div>
            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "4px" }}>Buscas IA hoje</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)" }}>6 <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--text-3)" }}>/ 10</span></div>
            </div>
          </div>
          <button className="btn btn-primary">Fazer upgrade para Pro</button>
        </div>

        {/* Zona de perigo */}
        <div className="card" style={{ borderColor: "rgba(220,38,38,0.2)" }}>
          <div className="card-header">
            <div className="card-title" style={{ color: "var(--danger)" }}>Zona de perigo</div>
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
