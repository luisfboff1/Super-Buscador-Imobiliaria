"use client";

import { useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Heart,
  ExternalLink,
  Home,
  Bath,
  Car,
  Maximize2,
  MapPin,
} from "lucide-react";

type Imovel = {
  id: string;
  titulo: string | null;
  tipo: string | null;
  transacao: string | null;
  preco: string | null;
  bairro: string | null;
  cidade: string | null;
  areaM2: string | null;
  quartos: number | null;
  banheiros: number | null;
  vagas: number | null;
  urlAnuncio: string | null;
  imagens: string[] | null;
  fonteNome: string | null;
  fonteUrl: string | null;
};

const TIPO_LABELS: Record<string, string> = {
  casa: "Casa",
  apartamento: "Apartamento",
  terreno: "Terreno",
  comercial: "Comercial",
  rural: "Rural",
  cobertura: "Cobertura",
  kitnet: "Kitnet",
  sobrado: "Sobrado",
  flat: "Flat",
  loft: "Loft",
  galpao: "Galpão",
  sala: "Sala",
  loja: "Loja",
  chacara: "Chácara",
  predio: "Prédio",
  box: "Box",
  barracao: "Barracão",
  duplex: "Duplex",
  triplex: "Triplex",
  condominio: "Condomínio",
  pavilhao: "Pavilhão",
  outro: "Outro",
};

const TRANSACAO_LABELS: Record<string, { label: string; className: string }> = {
  venda: { label: "Venda", className: "badge-venda" },
  aluguel: { label: "Aluguel", className: "badge-aluguel" },
  ambos: { label: "Venda/Aluguel", className: "badge-ambos" },
};

type Filtros = {
  tipo: string;
  transacao: string;
  cidade: string;
  bairro: string;
  precoMin: string;
  precoMax: string;
  quartos: string;
  vagas: string;
  areaMin: string;
  areaMax: string;
  sortBy: "relevante" | "preco_asc" | "preco_desc" | "area_desc" | "recentes";
};

function formatPreco(v: string | null) {
  if (!v) return "Preço não informado";
  const num = parseFloat(v);
  if (isNaN(num)) return v;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function ImovelCard({
  imovel,
  favorito,
  onFavorito,
}: {
  imovel: Imovel;
  favorito: boolean;
  onFavorito: () => void;
}) {
  return (
    <div className="imovel-card">
      <div className="imovel-img">
        {imovel.imagens?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imovel.imagens[0]} alt={imovel.titulo ?? "Imóvel"} />
        ) : (
          <Home size={36} style={{ color: "#8fa3c0", strokeWidth: 1.25 }} />
        )}
        <div className="imovel-badges">
          {imovel.transacao && TRANSACAO_LABELS[imovel.transacao] && (
            <span className={`imovel-badge ${TRANSACAO_LABELS[imovel.transacao].className}`}>
              {TRANSACAO_LABELS[imovel.transacao].label}
            </span>
          )}
          {imovel.tipo && (
            <span className="imovel-badge badge-tipo">
              {TIPO_LABELS[imovel.tipo] ?? imovel.tipo}
            </span>
          )}
        </div>
      </div>
      <div className="imovel-body">
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}
        >
          <div>
            <div className="imovel-price">{formatPreco(imovel.preco)}</div>
            <div className="imovel-address">
              <MapPin size={11} />
              {imovel.bairro ?? "—"}, {imovel.cidade ?? "—"}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={(e) => {
              e.stopPropagation();
              onFavorito();
            }}
            title="Favoritar"
          >
            <Heart
              size={15}
              fill={favorito ? "currentColor" : "none"}
              style={{ color: favorito ? "#dc2626" : undefined }}
            />
          </button>
        </div>

        <div className="imovel-stats">
          {imovel.quartos != null && imovel.quartos > 0 && (
            <span className="imovel-stat">
              <Home size={12} />
              {imovel.quartos} qts
            </span>
          )}
          {imovel.banheiros != null && (
            <span className="imovel-stat">
              <Bath size={12} />
              {imovel.banheiros} ban
            </span>
          )}
          {imovel.vagas != null && imovel.vagas > 0 && (
            <span className="imovel-stat">
              <Car size={12} />
              {imovel.vagas} vaga{imovel.vagas > 1 ? "s" : ""}
            </span>
          )}
          {imovel.areaM2 && (
            <span className="imovel-stat">
              <Maximize2 size={12} />
              {imovel.areaM2}m²
            </span>
          )}
        </div>

        <div className="imovel-fonte">
          <span>{imovel.fonteUrl ?? imovel.fonteNome ?? "Fonte desconhecida"}</span>
          {imovel.urlAnuncio && (
            <a
              href={imovel.urlAnuncio}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <ExternalLink size={11} />
              Ver anúncio
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BuscadorPage() {
  const [filtros, setFiltros] = useState<Filtros>({
    tipo: "",
    transacao: "",
    cidade: "",
    bairro: "",
    precoMin: "",
    precoMax: "",
    quartos: "",
    vagas: "",
    areaMin: "",
    areaMax: "",
    sortBy: "relevante",
  });
  const [busca, setBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<Imovel[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [showFiltros, setShowFiltros] = useState(false);

  async function toggleFavorito(id: string) {
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    await fetch("/api/favoritos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imovelId: id }),
    });
  }

  async function fetchPage(targetPage: number, filtrosAtuais: Filtros = filtros) {
    setBuscando(true);
    try {
      const params = new URLSearchParams();
      if (filtrosAtuais.tipo) params.set("tipo", filtrosAtuais.tipo);
      if (filtrosAtuais.transacao) params.set("transacao", filtrosAtuais.transacao);
      if (filtrosAtuais.cidade) params.set("cidade", filtrosAtuais.cidade);
      if (filtrosAtuais.bairro) params.set("bairro", filtrosAtuais.bairro);
      if (filtrosAtuais.precoMin) params.set("precoMin", filtrosAtuais.precoMin);
      if (filtrosAtuais.precoMax) params.set("precoMax", filtrosAtuais.precoMax);
      if (filtrosAtuais.quartos) params.set("quartosMin", filtrosAtuais.quartos);
      if (filtrosAtuais.vagas) params.set("vagasMin", filtrosAtuais.vagas);
      if (filtrosAtuais.areaMin) params.set("areaMin", filtrosAtuais.areaMin);
      if (filtrosAtuais.areaMax) params.set("areaMax", filtrosAtuais.areaMax);
      if (filtrosAtuais.sortBy) params.set("sortBy", filtrosAtuais.sortBy);
      if (busca) params.set("q", busca);
      params.set("page", String(targetPage));

      const res = await fetch(`/api/imoveis?${params.toString()}`);
      if (!res.ok) throw new Error("Erro ao buscar imóveis");
      const data = await res.json();
      setResultado(data.imoveis ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? 1);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setResultado([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setBuscando(false);
    }
  }

  async function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    await fetchPage(1);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Buscador</div>
          <div className="topbar-sub">Busque imóveis em todas as fontes cadastradas</div>
        </div>
      </div>

      <div className="page-inner">
        {/* Search form */}
        <div className="card" style={{ marginBottom: "20px" }}>
          <form onSubmit={handleBuscar}>
            <div className="search-bar-row" style={{ marginBottom: showFiltros ? "20px" : "0" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <Search
                  size={15}
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
                  type="text"
                  placeholder="Busca livre: ex. apartamento 2 quartos com garagem em Caxias..."
                  style={{ paddingLeft: "34px" }}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={`btn btn-outline ${showFiltros ? "active" : ""}`}
                onClick={() => setShowFiltros(!showFiltros)}
              >
                <SlidersHorizontal size={14} />
                Filtros
              </button>
              <button type="submit" className="btn btn-primary" disabled={buscando}>
                <Search size={14} />
                {buscando ? "Buscando..." : "Buscar"}
              </button>
            </div>

            {/* Filtros avançados */}
            {showFiltros && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <div className="filter-grid">
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Transação
                    </label>
                    <select
                      className="form-input"
                      value={filtros.transacao}
                      onChange={(e) => setFiltros({ ...filtros, transacao: e.target.value })}
                    >
                      <option value="">Todas</option>
                      <option value="venda">Comprar</option>
                      <option value="aluguel">Alugar</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Tipo
                    </label>
                    <select
                      className="form-input"
                      value={filtros.tipo}
                      onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
                    >
                      <option value="">Todos</option>
                      <option value="apartamento">Apartamento</option>
                      <option value="casa">Casa</option>
                      <option value="sobrado">Sobrado</option>
                      <option value="terreno">Terreno</option>
                      <option value="comercial">Comercial</option>
                      <option value="sala">Sala</option>
                      <option value="loja">Loja</option>
                      <option value="galpao">Galpão</option>
                      <option value="pavilhao">Pavilhão</option>
                      <option value="predio">Prédio</option>
                      <option value="box">Box</option>
                      <option value="cobertura">Cobertura</option>
                      <option value="kitnet">Kitnet</option>
                      <option value="chacara">Chácara</option>
                      <option value="rural">Rural</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Cidade
                    </label>
                    <input
                      className="form-input"
                      placeholder="Ex: Caxias do Sul"
                      value={filtros.cidade}
                      onChange={(e) => setFiltros({ ...filtros, cidade: e.target.value })}
                    />
                  </div>
                </div>
                <div className="filter-grid" style={{ marginTop: "12px" }}>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Bairro
                    </label>
                    <input
                      className="form-input"
                      placeholder="Ex: Centro, São Pelegrino"
                      value={filtros.bairro}
                      onChange={(e) => setFiltros({ ...filtros, bairro: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Preço mín.
                    </label>
                    <input
                      className="form-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Ex: 100000"
                      value={filtros.precoMin}
                      onChange={(e) => setFiltros({ ...filtros, precoMin: e.target.value.replace(/[^\d.,]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Preço máx.
                    </label>
                    <input
                      className="form-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Ex: 500000"
                      value={filtros.precoMax}
                      onChange={(e) => setFiltros({ ...filtros, precoMax: e.target.value.replace(/[^\d.,]/g, "") })}
                    />
                  </div>
                </div>
                <div className="filter-grid" style={{ marginTop: "12px" }}>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Quartos mín.
                    </label>
                    <select
                      className="form-input"
                      value={filtros.quartos}
                      onChange={(e) => setFiltros({ ...filtros, quartos: e.target.value })}
                    >
                      <option value="">Qualquer</option>
                      <option value="1">1+</option>
                      <option value="2">2+</option>
                      <option value="3">3+</option>
                      <option value="4">4+</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Garagens mín.
                    </label>
                    <select
                      className="form-input"
                      value={filtros.vagas}
                      onChange={(e) => setFiltros({ ...filtros, vagas: e.target.value })}
                    >
                      <option value="">Qualquer</option>
                      <option value="1">1+</option>
                      <option value="2">2+</option>
                      <option value="3">3+</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Área mín. (m²)
                    </label>
                    <input
                      className="form-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Ex: 60"
                      value={filtros.areaMin}
                      onChange={(e) => setFiltros({ ...filtros, areaMin: e.target.value.replace(/[^\d.,]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>
                      Área máx. (m²)
                    </label>
                    <input
                      className="form-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Ex: 100000"
                      value={filtros.areaMax}
                      onChange={(e) => setFiltros({ ...filtros, areaMax: e.target.value.replace(/[^\d.,]/g, "") })}
                    />
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Resultados */}
        {resultado === null ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={40} strokeWidth={1.25} />
            </div>
            <h3>Pronto para buscar</h3>
            <p>
              Use os filtros acima ou descreva o imóvel que você procura. Buscaremos em todas as fontes
              cadastradas.
            </p>
          </div>
        ) : resultado.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={40} strokeWidth={1.25} />
            </div>
            <h3>Nenhum imóvel encontrado</h3>
            <p>Tente ajustar os filtros ou ampliar a busca para outras cidades.</p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "13.5px", color: "var(--text-2)" }}>
                <strong style={{ color: "var(--text)" }}>{total}</strong> imóveis encontrados
                {totalPages > 1 && (
                  <span style={{ marginLeft: "8px" }}>— página {page} de {totalPages}</span>
                )}
              </div>
              <select
                className="form-input"
                style={{ width: "auto", fontSize: "12.5px", padding: "6px 10px" }}
                value={filtros.sortBy}
                onChange={(e) => {
                  const sortBy = e.target.value as Filtros["sortBy"];
                  setFiltros((prev) => ({ ...prev, sortBy }));
                  if (resultado !== null) {
                    void fetchPage(1, { ...filtros, sortBy });
                  }
                }}
              >
                <option value="relevante">Mais relevante</option>
                <option value="preco_asc">Menor preço</option>
                <option value="preco_desc">Maior preço</option>
                <option value="area_desc">Maior área</option>
                <option value="recentes">Mais recente</option>
              </select>
            </div>

            <div className="grid-3">
              {resultado.map((imovel) => (
                <ImovelCard
                  key={imovel.id}
                  imovel={imovel}
                  favorito={favoritos.has(imovel.id)}
                  onFavorito={() => toggleFavorito(imovel.id)}
                />
              ))}
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "24px",
                }}
              >
                <button
                  className="btn btn-outline btn-sm"
                  disabled={page <= 1 || buscando}
                  onClick={() => fetchPage(page - 1)}
                >
                  ← Anterior
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && typeof arr[idx - 1] === "number" && p - (arr[idx - 1] as number) > 1)
                      acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "..." ? (
                      <span key={`ellipsis-${idx}`} style={{ padding: "0 4px", color: "var(--text-3)" }}>…</span>
                    ) : (
                      <button
                        key={p}
                        className={`btn btn-sm ${p === page ? "btn-primary" : "btn-outline"}`}
                        disabled={buscando}
                        onClick={() => fetchPage(p as number)}
                        style={{ minWidth: "36px" }}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  className="btn btn-outline btn-sm"
                  disabled={page >= totalPages || buscando}
                  onClick={() => fetchPage(page + 1)}
                >
                  Próxima →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
