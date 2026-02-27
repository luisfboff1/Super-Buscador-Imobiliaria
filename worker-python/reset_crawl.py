"""Reset crawl data for Bassanesi and re-trigger."""
import os
import psycopg2

conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
cur = conn.cursor()

fonte_id = "69101545-d4a0-46d1-90e7-935469cdf024"

# Check columns
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='fontes' ORDER BY ordinal_position")
print("Fontes columns:", [r[0] for r in cur.fetchall()])

cur.execute("DELETE FROM imoveis WHERE fonte_id=%s", (fonte_id,))
print(f"Deleted {cur.rowcount} imoveis rows")

cur.execute("UPDATE fontes SET status='pendente' WHERE id=%s", (fonte_id,))
conn.commit()
print("Fonte reset to pendente")

conn.close()
