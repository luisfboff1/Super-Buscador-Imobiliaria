"use client";

import { useState } from "react";

export function ProfileForm({
  defaultName,
  email,
}: {
  defaultName: string;
  email: string;
}) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="card" style={{ marginBottom: "16px" }}>
      <div className="card-header">
        <div className="card-title">Perfil</div>
      </div>
      <div className="form-group">
        <label className="form-label">Nome</label>
        <input
          className="form-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">E-mail</label>
        <input className="form-input" type="email" value={email} disabled />
        <div className="form-hint">O e-mail não pode ser alterado.</div>
      </div>
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar alterações"}
      </button>
    </div>
  );
}
