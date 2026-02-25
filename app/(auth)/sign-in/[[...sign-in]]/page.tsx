"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

const features = [
  "Agregação de múltiplas fontes",
  "Busca em linguagem natural com IA",
  "Exportação e histórico completo",
  "Extração automática de contatos CRECI",
];

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // TODO: integrar com Clerk
    await new Promise((r) => setTimeout(r, 800));
    window.location.href = "/dashboard";
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        minHeight: "100vh",
        width: "100%",
      }}
    >
      {/* Left panel */}
      <div
        style={{
          background: "linear-gradient(155deg,#0b1a3e 0%,#0d2260 45%,#1a3a7a 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative blobs */}
        <div
          style={{
            position: "absolute",
            top: "-80px",
            right: "-80px",
            width: "320px",
            height: "320px",
            background: "radial-gradient(circle,rgba(59,130,246,0.25),transparent 70%)",
            borderRadius: "50%",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-60px",
            left: "-60px",
            width: "240px",
            height: "240px",
            background: "radial-gradient(circle,rgba(37,99,235,0.18),transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", position: "relative", zIndex: 1 }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              background: "rgba(255,255,255,0.12)",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} width={18} height={18} style={{ color: "#93c5fd" }}>
              <circle cx="11" cy="11" r="8" />
              <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
          </div>
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>Super Buscador</span>
        </div>

        {/* Copy */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2 style={{ fontSize: "26px", fontWeight: 700, color: "#fff", lineHeight: 1.3, marginBottom: "12px" }}>
            Encontre imóveis com inteligência
          </h2>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6, marginBottom: "20px" }}>
            Busque em dezenas de imobiliárias ao mesmo tempo, em linguagem natural.
          </p>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
            {features.map((f) => (
              <li key={f} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13.5px", color: "rgba(255,255,255,0.75)" }}>
                <CheckCircle2 size={15} style={{ color: "#60a5fa", flexShrink: 0 }} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", position: "relative", zIndex: 1 }}>
          © 2026 Super Buscador
        </div>
      </div>

      {/* Right panel */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          background: "#f8fafc",
        }}
      >
        <div style={{ width: "100%", maxWidth: "400px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
            Bem-vindo de volta
          </h1>
          <p style={{ fontSize: "13.5px", color: "#64748b", marginBottom: "28px" }}>
            Não tem conta?{" "}
            <Link href="/sign-up" style={{ color: "#2563eb", textDecoration: "none" }}>
              Crie grátis
            </Link>
          </p>

          {/* Google SSO */}
          <button
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              width: "100%",
              padding: "10px",
              background: "#fff",
              border: "1.5px solid #e2e8f0",
              borderRadius: "9px",
              fontSize: "13.5px",
              fontWeight: 600,
              color: "#374151",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all .15s",
              marginBottom: "16px",
            }}
          >
            <svg viewBox="0 0 24 24" width={18} height={18}>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar com Google
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              margin: "20px 0",
              color: "#94a3b8",
              fontSize: "12px",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
            ou com e-mail
            <div style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                E-mail
              </label>
              <input
                type="email"
                placeholder="seunome@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "9px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  color: "#0f172a",
                  background: "#fff",
                  outline: "none",
                  transition: "border .15s",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#374151" }}>Senha</label>
              <a href="#" style={{ fontSize: "12.5px", color: "#2563eb", textDecoration: "none" }}>Esqueceu?</a>
            </div>
            <div style={{ marginBottom: "20px" }}>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "9px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  color: "#0f172a",
                  background: "#fff",
                  outline: "none",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "11px",
                background: loading ? "#93c5fd" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "9px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
