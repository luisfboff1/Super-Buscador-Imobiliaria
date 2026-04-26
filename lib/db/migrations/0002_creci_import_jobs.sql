CREATE TABLE IF NOT EXISTS creci_import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cidade text NOT NULL,
    estado text NOT NULL DEFAULT 'RS',
    status text NOT NULL DEFAULT 'pending',
    total integer NOT NULL DEFAULT 0,
    enriched integer NOT NULL DEFAULT 0,
    imobiliarias jsonb,
    error_message text,
    started_at timestamp,
    completed_at timestamp,
    created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creci_import_jobs_status_created
ON creci_import_jobs(status, created_at DESC);
