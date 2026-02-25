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
  titulo: string;
  tipo: string;
  preco: number;
  bairro: string;
  cidade: string;
  area: number;
  quartos: number;
  banheiros: number;
  vagas: number;
  fonte: string;
  urlAnuncio: string;
};

// Mock data para demonstração
const imoveisMock: Imovel[] = [
  {
    id: "1",
    titulo: "Apartamento moderno no centro",
    tipo: "Apartamento",
    preco: 320000,
    bairro: "Centro",
    cidade: "Caxias do Sul",
    area: 68,
    quartos: 2,
    banheiros: 1,
    vagas: 1,
    fonte: "imobhorizonte.com.br",
    urlAnuncio: "#",
  },
  {
    id: "2",
    titulo: "Casa espaçosa com jardim",
    tipo: "Casa",
    preco: 580000,
    bairro: "Santa Lúcia",
    cidade: "Caxias do Sul",
    area: 180,
    quartos: 3,
    banheiros: 2,
    vagas: 2,
    fonte: "casasul.imob.com.br",
    urlAnuncio: "#",
  },
  {
    id: "3",
    titulo: "Apartamento 3 dormitórios com suíte",
    tipo: "Apartamento",
    preco: 450000,
    bairro: "Rio Branco",
    cidade: "Caxias do Sul",
    area: 95,
    quartos: 3,
    banheiros: 2,
    vagas: 2,
    fonte: "realtysul.com.br",
    urlAnuncio: "#",
  },
  {
    id: "4",
    titulo: "Studio compacto próximo à universidade",
    tipo: "Apartamento",
    preco: 180000,
    bairro: "Universitário",
    cidade: "Caxias do Sul",
    area: 32,
    quartos: 1,
    banheiros: 1,
    vagas: 0,
    fonte: "imobhorizonte.com.br",
    urlAnuncio: "#",
  },
  {
    id: "5",
    titulo: "Casa nova em condomínio fechado",
    tipo: "Casa",
    preco: 720000,
    bairro: "Desvio Rizzo",
    cidade: "Caxias do Sul",
    area: 220,
    quartos: 4,
    banheiros: 3,
    vagas: 3,
    fonte: "casasul.imob.com.br",
    urlAnuncio: "#",
  },
  {
    id: "6",
    titulo: "Sala comercial no centro",
    tipo: "Comercial",
    preco: 280000,
    bairro: "Centro",
    cidade: "Caxias do Sul",
    area: 55,
    quartos: 0,
    banheiros: 1,
    vagas: 1,
    fonte: "realtysul.com.br",
    urlAnuncio: "#",
  },
];

type Filtros = {
  tipo: string;
  cidade: string;
  precoMax: string;
  quartos: string;
  areaMin: string;
};

function formatPreco(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function ImovelCard({ imovel, favorito, onFavorito }: { imovel: Imovel; favorito: boolean; onFavorito: () => void }) {
  return (
    <div className="imovel-card">
      <div className="imovel-img">
        <Home size={36} style={{ color: "#8fa3c0", strokeWidth: 1.25 }} />
      </div>
      <div className="imovel-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
          <div>
            <div className="imovel-price">{formatPreco(imovel.preco)}</div>
            <div className="imovel-address">
              <MapPin size={11} />
              {imovel.bairro}, {imovel.cidade}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={(e) => { e.stopPropagation(); onFavorito(); }}
            title="Favoritar"
          >
            <Heart size={15} fill={favorito ? "currentColor" : "none"} style={{ color: favorito ? "#dc2626" : undefined }} />
          </button>
        </div>

        <div className="imovel-stats">
          {imovel.quartos > 0 && (
            <span className="imovel-stat">
              <Home size={12} />
              {imovel.quartos} qts
            </span>
          )}
          <span className="imovel-stat">
            <Bath size={12} />
            {imovel.banheiros} ban
          </span>
          {imovel.vagas > 0 && (
            <span className="imovel-stat">
              <Car size={12} />
              {imovel.vagas} vaga{imovel.vagas > 1 ? "s" : ""}
            </span>
          )}
          <span className="imovel-stat">
            <Maximize2 size={12} />
            {imovel.area}m²
          </span>
        </div>

        <div className="imovel-fonte">
          <span>{imovel.fonte}</span>
          <a href={imovel.urlAnuncio} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            <ExternalLink size={11} />
            Ver anúncio
          </a>
        </div>
      </div>
    </div>
  );
}

export default function BuscadorPage() {
  const [filtros, setFiltros] = useState<Filtros>({
    tipo: "",
    cidade: "",
    precoMax: "",
    quartos: "",
    areaMin: "",
  });
  const [busca, setBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<Imovel[] | null>(null);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [showFiltros, setShowFiltros] = useState(false);

  function toggleFavorito(id: string) {
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    setBuscando(true);
    // TODO: chamar API /api/imoveis/search com os filtros
    await new Promise((r) => setTimeout(r, 800));
    // Filtrar mock
    let results = imoveisMock;
    if (filtros.tipo) results = results.filter((i) => i.tipo.toLowerCase() === filtros.tipo.toLowerCase());
    if (filtros.cidade) results = results.filter((i) => i.cidade.toLowerCase().includes(filtros.cidade.toLowerCase()));
    if (filtros.precoMax) results = results.filter((i) => i.preco <= Number(filtros.precoMax));
    if (filtros.quartos) results = results.filter((i) => i.quartos >= Number(filtros.quartos));
    if (filtros.areaMin) results = results.filter((i) => i.area >= Number(filtros.areaMin));
    setResultado(results);
    setBuscando(false);
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
            <div style={{ display: "flex", gap: "10px", marginBottom: showFiltros ? "20px" : "0" }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px" }}>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>Tipo</label>
                    <select
                      className="form-input"
                      value={filtros.tipo}
                      onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
                    >
                      <option value="">Todos</option>
                      <option value="Apartamento">Apartamento</option>
                      <option value="Casa">Casa</option>
                      <option value="Terreno">Terreno</option>
                      <option value="Comercial">Comercial</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>Cidade</label>
                    <input
                      className="form-input"
                      placeholder="Ex: Caxias do Sul"
                      value={filtros.cidade}
                      onChange={(e) => setFiltros({ ...filtros, cidade: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>Preço máx.</label>
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Ex: 500000"
                      value={filtros.precoMax}
                      onChange={(e) => setFiltros({ ...filtros, precoMax: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "4px" }}>Quartos mín.</label>
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
                    <label className="form-label" style={{ marginBottom: "4px" }}>Área mín. (m²)</label>
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Ex: 60"
                      value={filtros.areaMin}
                      onChange={(e) => setFiltros({ ...filtros, areaMin: e.target.value })}
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
            <p>Use os filtros acima ou descreva o imóvel que você procura. Buscaremos em todas as fontes cadastradas.</p>
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
                <strong style={{ color: "var(--text)" }}>{resultado.length}</strong> imóveis encontrados
              </div>
              <select className="form-input" style={{ width: "auto", fontSize: "12.5px", padding: "6px 10px" }}>
                <option>Mais relevante</option>
                <option>Menor preço</option>
                <option>Maior preço</option>
                <option>Maior área</option>
                <option>Mais recente</option>
              </select>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "14px",
              }}
            >
              {resultado.map((imovel) => (
                <ImovelCard
                  key={imovel.id}
                  imovel={imovel}
                  favorito={favoritos.has(imovel.id)}
                  onFavorito={() => toggleFavorito(imovel.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
