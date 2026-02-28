from app.db import get_conn
conn = get_conn(); cur = conn.cursor()

cur.execute("""
    SELECT titulo, bairro, cidade, created_at, updated_at
    FROM imoveis
    WHERE fonte_id = 'bcf596fd-2aa7-42fc-b0b0-d38358e205c5'
    AND (bairro ILIKE 'bairro' OR cidade ILIKE 'início' OR cidade ILIKE 'inicio')
    ORDER BY created_at DESC
""")
cols = [d[0] for d in cur.description]
rows = cur.fetchall()
print(f'Registros contaminados: {len(rows)}')
for r in rows:
    print(dict(zip(cols, r)))

cur.execute("SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM imoveis WHERE fonte_id = 'bcf596fd-2aa7-42fc-b0b0-d38358e205c5'")
row = cur.fetchone()
print(f'\nTotal: {row[0]} | Min={row[1]} | Max={row[2]}')
cur.close(); conn.close()
