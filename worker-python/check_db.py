"""Quick check for crawl results in the database."""
import os
import psycopg2
import psycopg2.extras

conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

fonte_id = "69101545-d4a0-46d1-90e7-935469cdf024"

cur.execute(
    "SELECT count(*) as total, "
    "count(titulo) as com_titulo, "
    "count(preco) as com_preco, "
    "count(tipo) as com_tipo, "
    "count(transacao) as com_transacao, "
    "count(quartos) as com_quartos, "
    "count(banheiros) as com_banheiros, "
    "count(vagas) as com_vagas, "
    "count(bairro) as com_bairro, "
    "count(area_m2) as com_area, "
    "count(descricao) as com_descricao "
    "FROM imoveis WHERE fonte_id=%s",
    (fonte_id,),
)
stats = dict(cur.fetchone())
print(f"\n=== Estatísticas Bassanesi ===")
for k, v in stats.items():
    pct = f"({v*100//stats['total']}%)" if stats['total'] > 0 else ""
    print(f"  {k:16s}: {v:3d} {pct}")

cur.execute(
    "SELECT titulo, tipo, transacao, preco, area_m2, quartos, banheiros, vagas, bairro, cidade "
    "FROM imoveis WHERE fonte_id=%s ORDER BY preco DESC NULLS LAST",
    (fonte_id,),
)
print(f"\n=== Todos os imóveis ===")
for row in cur.fetchall():
    r = dict(row)
    preco = f"R${float(r['preco']):>12,.0f}" if r['preco'] else "     s/preço"
    tipo = (r['tipo'] or '?')[:12]
    trans = (r['transacao'] or '?')[:7]
    quartos = f"{r['quartos'] or '?'}q"
    ban = f"{r['banheiros'] or '?'}b"
    vagas = f"{r['vagas'] or '?'}v"
    area = f"{float(r['area_m2']):,.0f}m²" if r['area_m2'] else "?m²"
    bairro = (r['bairro'] or '?')[:15]
    print(f"  [{trans:7s}] {preco} | {tipo:12s} | {quartos:3s} {ban:3s} {vagas:3s} | {area:>8s} | {bairro:15s} | {(r['titulo'] or '?')[:45]}")

conn.close()

cur.close()
conn.close()
