"""Delete all imoveis for a fonte matching a URL pattern, then reset fonte status."""
import psycopg2
import os
import sys

pattern = sys.argv[1] if len(sys.argv) > 1 else "%casaforte%"

conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
cur = conn.cursor()

# Find fonte
cur.execute("SELECT id, nome, url FROM fontes WHERE url LIKE %s", (pattern,))
rows = cur.fetchall()
if not rows:
    print(f"Nenhuma fonte encontrada com pattern: {pattern}")
    sys.exit(1)

for fonte_id, nome, url in rows:
    print(f"Fonte: {nome} ({url})")
    print(f"ID: {fonte_id}")
    
    # Count imoveis
    cur.execute("SELECT COUNT(*) FROM imoveis WHERE fonte_id = %s", (fonte_id,))
    count = cur.fetchone()[0]
    print(f"Imóveis encontrados: {count}")
    
    # Delete
    cur.execute("DELETE FROM imoveis WHERE fonte_id = %s", (fonte_id,))
    print(f"Deletados: {cur.rowcount} imóveis")
    
    # Reset fonte status
    cur.execute("""
        UPDATE fontes 
        SET status = 'pendente', 
            crawl_erro = NULL, 
            crawl_progress = NULL,
            last_crawl = NULL
        WHERE id = %s
    """, (fonte_id,))
    print(f"Fonte resetada para 'pendente'")

conn.commit()
cur.close()
conn.close()
print("\nDone!")
