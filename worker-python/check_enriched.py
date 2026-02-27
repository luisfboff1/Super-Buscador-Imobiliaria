"""Quick check: only enriched properties."""
import psycopg2, os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

# Somente enriquecidos (com titulo)
cur.execute("""
    SELECT titulo, tipo, transacao, preco, area_m2, quartos, banheiros, vagas, bairro, cidade, url_anuncio
    FROM imoveis WHERE titulo IS NOT NULL
    ORDER BY preco DESC NULLS LAST LIMIT 20
""")
print("=" * 120)
print(f"{'TIPO':12} | {'TRANS':8} | {'PRECO':>14} | Q  B  V | {'AREA':>7} | {'BAIRRO':20} | TITULO")
print("-" * 120)
for r in cur.fetchall():
    titulo = (r[0] or "?")[:45]
    tipo = r[1] or "?"
    trans = r[2] or "?"
    preco = f"R${r[3]:,.0f}" if r[3] else "s/preco"
    area = f"{r[4]:.0f}m2" if r[4] else "?m2"
    q = r[5] or "?"
    b = r[6] or "?"
    v = r[7] or "?"
    bairro = (r[8] or "?")[:20]
    print(f"{tipo:12} | {trans:8} | {preco:>14} | {q}  {b}  {v} | {area:>7} | {bairro:20} | {titulo}")

# Stats
print("\n" + "=" * 60)
cur.execute("SELECT count(*) FROM imoveis")
total = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM imoveis WHERE titulo IS NOT NULL")
enriq = cur.fetchone()[0]

fields = ["preco", "tipo", "transacao", "quartos", "banheiros", "vagas", "area_m2", "bairro", "descricao"]
print(f"Total URLs no DB: {total}")
print(f"Enriquecidos (com titulo): {enriq}")
for f in fields:
    cur.execute(f"SELECT count(*) FROM imoveis WHERE {f} IS NOT NULL")
    n = cur.fetchone()[0]
    pct = (n / enriq * 100) if enriq > 0 else 0
    print(f"  {f:12}: {n}/{enriq} ({pct:.0f}%)")

conn.close()
