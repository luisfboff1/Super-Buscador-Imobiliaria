CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE fontes
ADD COLUMN IF NOT EXISTS config jsonb;

CREATE TABLE IF NOT EXISTS crawl_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fonte_id uuid NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
    pipeline_version text NOT NULL,
    stage text NOT NULL,
    trigger_mode text NOT NULL,
    status text NOT NULL,
    started_at timestamp NOT NULL DEFAULT NOW(),
    finished_at timestamp,
    elapsed_ms integer,
    config_snapshot jsonb,
    site_profile_snapshot jsonb,
    summary_metrics jsonb
);

CREATE TABLE IF NOT EXISTS crawl_run_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
    url text NOT NULL,
    item_type text NOT NULL,
    discovered boolean NOT NULL DEFAULT false,
    extracted_data jsonb,
    field_sources jsonb,
    field_confidence jsonb,
    validator_status text,
    validator_reasons jsonb,
    images_meta jsonb,
    raw_metrics jsonb
);

CREATE TABLE IF NOT EXISTS crawl_run_comparisons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_run_id uuid REFERENCES crawl_runs(id) ON DELETE CASCADE,
    candidate_run_id uuid REFERENCES crawl_runs(id) ON DELETE CASCADE,
    comparison_scope text NOT NULL,
    report_json jsonb NOT NULL,
    report_markdown text NOT NULL,
    created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_runs_fonte_stage
ON crawl_runs(fonte_id, stage, pipeline_version, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_crawl_run_items_run_url
ON crawl_run_items(run_id, url);

CREATE INDEX IF NOT EXISTS idx_crawl_run_comparisons_runs
ON crawl_run_comparisons(legacy_run_id, candidate_run_id);
