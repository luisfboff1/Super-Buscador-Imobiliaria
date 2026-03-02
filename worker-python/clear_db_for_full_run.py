"""Limpa imoveis e reseta status de todas fontes para 'idle'."""
import psycopg2, os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM imoveis")
total = cur.fetchone()[0]
print(f"Imoveis antes: {total}")

cur.execute("DELETE FROM imoveis")
deleted = cur.rowcount
print(f"Deletados: {deleted}")

cur.execute("UPDATE fontes SET status='idle'")
print(f"Fontes resetadas: {cur.rowcount}")

conn.commit()
conn.close()
print("Pronto! DB limpo.")
