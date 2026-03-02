import Link from "next/link";
import { Heart, ExternalLink, Home, Bath, Car, Maximize2, MapPin, Search } from "lucide-react";
import { auth } from "@/auth";
import { getFavoritos } from "@/lib/db/queries";

function formatPreco(v: string | null) {
  if (!v) return "Preço não informado";
  const num = parseFloat(v);
  if (isNaN(num)) return v;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export default async function FavoritosPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const favoritos = await getFavoritos(userId);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Favoritos</div>
          <div className="topbar-sub">{favoritos.length} imóvel{favoritos.length !== 1 ? "is" : ""} salvo{favoritos.length !== 1 ? "s" : ""}</div>
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
          <div className="grid-3">
            {favoritos.map((fav) => (
              <div key={fav.id} className="imovel-card">
                <div className="imovel-img">
                  <Home size={36} style={{ color: "#8fa3c0", strokeWidth: 1.25 }} />
                </div>
                <div className="imovel-body">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "8px",
                    }}
                  >
                    <div>
                      <div className="imovel-price">{formatPreco(fav.imovel.preco)}</div>
                      <div className="imovel-address">
                        <MapPin size={11} />
                        {fav.imovel.bairro ?? "—"}, {fav.imovel.cidade ?? "—"}
                      </div>
                    </div>
                    <Heart size={15} fill="currentColor" style={{ color: "#dc2626", flexShrink: 0 }} />
                  </div>

                  <div className="imovel-stats">
                    {fav.imovel.quartos != null && fav.imovel.quartos > 0 && (
                      <span className="imovel-stat">
                        <Home size={12} />
                        {fav.imovel.quartos} qts
                      </span>
                    )}
                    {fav.imovel.banheiros != null && (
                      <span className="imovel-stat">
                        <Bath size={12} />
                        {fav.imovel.banheiros} ban
                      </span>
                    )}
                    {fav.imovel.vagas != null && fav.imovel.vagas > 0 && (
                      <span className="imovel-stat">
                        <Car size={12} />
                        {fav.imovel.vagas} vaga{fav.imovel.vagas > 1 ? "s" : ""}
                      </span>
                    )}
                    {fav.imovel.areaM2 && (
                      <span className="imovel-stat">
                        <Maximize2 size={12} />
                        {fav.imovel.areaM2}m²
                      </span>
                    )}
                  </div>

                  {fav.nota && (
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
                      📝 {fav.nota}
                    </div>
                  )}

                  <div className="imovel-fonte">
                    <span>{fav.fonteUrl ?? "Fonte desconhecida"}</span>
                    {fav.imovel.urlAnuncio && (
                      <a
                        href={fav.imovel.urlAnuncio}
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
            ))}
          </div>
        )}
      </div>
    </>
  );
}
