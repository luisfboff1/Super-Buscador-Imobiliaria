"""
Migration: adiciona coluna status em imoveis para suporte a sync incremental.

status: 'ativo' | 'possivelmente_vendido'
  - 'ativo'                 = imóvel está disponível no site
  - 'possivelmente_vendido' = URL sumiu do site (pode ter sido vendido/alugado)
"""
import psycopg2, os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

# 1. Adicionar coluna status
cur.execute("""
    ALTER TABLE imoveis
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'ativo'
""")
print("✓ Coluna status adicionada")

# 2. Popular status baseado no disponivel atual
cur.execute("""
    UPDATE imoveis SET status = 'ativo' WHERE disponivel = true
""")
print(f"  → {cur.rowcount} registros marcados como 'ativo'")

cur.execute("""
    UPDATE imoveis SET status = 'possivelmente_vendido' WHERE disponivel = false
""")
print(f"  → {cur.rowcount} registros marcados como 'possivelmente_vendido'")

# 3. Índice para queries rápidas por status + fonte
cur.execute("""
    CREATE INDEX IF NOT EXISTS idx_imoveis_fonte_status
    ON imoveis (fonte_id, status)
""")
print("✓ Índice idx_imoveis_fonte_status criado")

conn.commit()
conn.close()
print("\nMigration concluída!")
