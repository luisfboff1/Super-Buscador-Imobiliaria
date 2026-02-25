"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Globe } from "lucide-react";

export default function NovaFontePage() {
  const [form, setForm] = useState({ nome: "", url: "", cidade: "", estado: "" });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const estados = [
    "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
    "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/fontes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) setSuccess(true);
  }

  if (success) {
    return (
      <>
        <div className="topbar">
          <div>
            <div className="topbar-title">Adicionar Fonte</div>
          </div>
        </div>
        <div className="page-inner" style={{ maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
          <div style={{ marginBottom: "16px", display: "flex", justifyContent: "center" }}>
            <CheckCircle2 size={48} style={{ color: "var(--success)" }} />
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>Fonte adicionada!</h2>
          <p style={{ color: "var(--text-2)", marginBottom: "24px" }}>
            O crawl foi iniciado em background. Em alguns minutos os imóveis de{" "}
            <strong>{form.url}</strong> estarão disponíveis para busca.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <Link href="/fontes" className="btn btn-primary">Ver fontes</Link>
            <button className="btn btn-outline" onClick={() => { setSuccess(false); setForm({ nome: "", url: "", cidade: "", estado: "" }); }}>
              Adicionar outra
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link href="/fontes" className="btn btn-ghost btn-icon">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="topbar-title">Adicionar Fonte</div>
            <div className="topbar-sub">Cadastre uma imobiliária para rastrear</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ maxWidth: 560 }}>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Dados da imobiliária</div>
              <div className="card-desc">
                Cole a URL da imobiliária e preencha os dados. O sistema fará o crawl automaticamente.
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">URL da imobiliária *</label>
              <div style={{ position: "relative" }}>
                <Globe
                  size={14}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-3)",
                  }}
                />
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://www.imobiliaria.com.br"
                  style={{ paddingLeft: "34px" }}
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  required
                />
              </div>
              <div className="form-hint">
                Cole a URL da página de listagem de imóveis da imobiliária.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Nome da imobiliária *</label>
              <input
                className="form-input"
                type="text"
                placeholder="Ex: Imobiliária Horizonte"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                required
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Cidade</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Ex: Caxias do Sul"
                  value={form.cidade}
                  onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Estado</label>
                <select
                  className="form-input"
                  value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  {estados.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="alert alert-info" style={{ marginTop: "8px" }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} width={16} height={16}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div>
                O crawl inicial pode levar alguns minutos dependendo do tamanho da imobiliária.
                Você receberá uma notificação quando estiver pronto.
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Salvando..." : "Adicionar e iniciar crawl"}
              </button>
              <Link href="/fontes" className="btn btn-outline">
                Cancelar
              </Link>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
