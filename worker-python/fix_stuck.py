"""Reset fontes stuck in 'crawling' status after container restart."""
import os
import psycopg2

conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
cur = conn.cursor()

cur.execute("SELECT id, nome, url, status FROM fontes WHERE status IN ('crawling', 'sincronizando') ORDER BY nome")
rows = cur.fetchall()
print(f"Fontes presas: {len(rows)}")
for r in rows:
    print(f"  {r[0]} | {r[1]} | {r[2]} | {r[3]}")

if rows:
    ids = [r[0] for r in rows]
    cur.execute("UPDATE fontes SET status = 'pendente' WHERE status IN ('crawling', 'sincronizando')")
    print(f"\nReset {cur.rowcount} fonte(s) para 'pendente'")
    conn.commit()

conn.close()
print("Done.")
