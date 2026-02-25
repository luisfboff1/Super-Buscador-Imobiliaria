import Link from "next/link";
import { Heart, ExternalLink, Home, Bath, Car, Maximize2, MapPin, Search } from "lucide-react";

const favoritos = [
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
    nota: "Visitar no fim de semana",
    savedAt: "Hoje às 15:20",
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
    nota: "",
    savedAt: "Ontem",
  },
];

function formatPreco(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export default function FavoritosPage() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Favoritos</div>
          <div className="topbar-sub">{favoritos.length} imóveis salvos</div>
        </div>
      </div>

      <div className="page-inner">
        {favoritos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Heart size={40} strokeWidth={1.25} />
            </div>
            <h3>Nenhum favorito ainda</h3>
            <p>Ao encontrar um imóvel interessante, clique no coração para salvar aqui.</p>
            <Link href="/buscador" className="btn btn-primary">
              <Search size={14} />
              Buscar imóveis
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
            {favoritos.map((imovel) => (
              <div key={imovel.id} className="imovel-card">
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
                    <Heart size={15} fill="currentColor" style={{ color: "#dc2626", flexShrink: 0 }} />
                  </div>

                  <div className="imovel-stats">
                    {imovel.quartos > 0 && (
                      <span className="imovel-stat"><Home size={12} />{imovel.quartos} qts</span>
                    )}
                    <span className="imovel-stat"><Bath size={12} />{imovel.banheiros} ban</span>
                    {imovel.vagas > 0 && (
                      <span className="imovel-stat"><Car size={12} />{imovel.vagas} vaga{imovel.vagas > 1 ? "s" : ""}</span>
                    )}
                    <span className="imovel-stat"><Maximize2 size={12} />{imovel.area}m²</span>
                  </div>

                  {imovel.nota && (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "6px 10px",
                        background: "var(--warning-light)",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "var(--warning)",
                      }}
                    >
                      📝 {imovel.nota}
                    </div>
                  )}

                  <div className="imovel-fonte">
                    <span>{imovel.fonte}</span>
                    <a href="#" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                      <ExternalLink size={11} />
                      Ver anúncio
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
