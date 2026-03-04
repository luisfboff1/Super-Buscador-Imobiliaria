"""
Comparação de modelos e configurações de reasoning em 10 URLs reais do banco.

Configurações testadas (6 colunas):
  nano/mini/600   → gpt-5-nano, reasoning_effort=minimal, max_tokens=600
  nano/mini/∞     → gpt-5-nano, reasoning_effort=minimal, sem limite
  nano/med/600    → gpt-5-nano, reasoning_effort=medium,  max_tokens=600
  nano/med/∞      → gpt-5-nano, reasoning_effort=medium,  sem limite
  4o/600          → gpt-4o,     sem reasoning_effort,      max_tokens=600
  4o/∞            → gpt-4o,     sem reasoning_effort,      sem limite

Uso:
    doppler run -- .\\worker-python\\venv\\Scripts\\python.exe worker-python/test_compare_reasoning.py
"""

import os, sys, time, dataclasses
from typing import Optional
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import psycopg2
from app.logger import setup_logging
setup_logging()

from scrapling.fetchers import Fetcher
import app.extractor as extractor
from app.crawler import safe_html
from app.extractor import extract_property_data

# ─── Definição de configurações ──────────────────────────────────────────────

@dataclasses.dataclass
class Config:
    label: str           # nome curto para a tabela
    model: str           # "gpt-5-nano" | "gpt-4o"
    reasoning: Optional[str]  # "minimal" | "medium" | None (para gpt-4o)
    max_tokens: Optional[int] # None = sem limite

CONFIGS = [
    Config("nano/mini/600", "gpt-5-nano", "minimal", 600),
    Config("nano/mini/∞",   "gpt-5-nano", "minimal", None),
    Config("nano/med/600",  "gpt-5-nano", "medium",  600),
    Config("nano/med/∞",    "gpt-5-nano", "medium",  None),
    Config("4o/600",        "gpt-4o",     None,      600),
    Config("4o/∞",          "gpt-4o",     None,      None),
]

# ─── Stats por execução ───────────────────────────────────────────────────────

@dataclasses.dataclass
class LLMStats:
    calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    reasoning_tokens: int = 0
    elapsed: float = 0.0
    empty_responses: int = 0

    @property
    def tokens_total(self) -> int:
        return self.tokens_in + self.tokens_out

    def reset(self):
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.reasoning_tokens = 0
        self.elapsed = 0.0
        self.empty_responses = 0


# Estado global do patch
_stats = LLMStats()
_active_config: Config = CONFIGS[0]


def _patched_llm_chat(messages, max_tokens: int = 600, reasoning_effort: str = "minimal"):
    """Substitui extractor._llm_chat — usa o modelo/config do _active_config."""
    global _stats, _active_config
    cfg = _active_config
    t0 = time.time()

    openai_client = extractor._get_openai()
    if openai_client is not None:
        try:
            kwargs = dict(
                model=cfg.model,
                messages=messages,
            )
            # gpt-5-nano usa reasoning_effort; gpt-4o usa temperature padrão
            if cfg.reasoning is not None:
                kwargs["reasoning_effort"] = cfg.reasoning
            # max_completion_tokens só quando tem limite
            if cfg.max_tokens is not None:
                kwargs["max_completion_tokens"] = cfg.max_tokens

            response = openai_client.chat.completions.create(**kwargs)
            text = response.choices[0].message.content or ""
            usage = response.usage
            if usage:
                _stats.tokens_in += usage.prompt_tokens or 0
                _stats.tokens_out += usage.completion_tokens or 0
                if (
                    hasattr(usage, "completion_tokens_details")
                    and usage.completion_tokens_details
                ):
                    _stats.reasoning_tokens += (
                        getattr(usage.completion_tokens_details, "reasoning_tokens", 0) or 0
                    )
            _stats.calls += 1
            if not text.strip():
                _stats.empty_responses += 1
            _stats.elapsed += time.time() - t0
            return text if text.strip() else None
        except Exception as e:
            print(f"    [{cfg.model}] ERRO: {e}")
            _stats.elapsed += time.time() - t0

    # Groq fallback (não contabilizado)
    try:
        from groq import Groq
        groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
        )
        return response.choices[0].message.content or ""
    except Exception:
        return None


# Instalar patch
extractor._llm_chat = _patched_llm_chat

# ─── Buscar URLs do banco ─────────────────────────────────────────────────────

def get_urls() -> list[dict]:
    print("Conectando ao banco de dados...")
    conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
    cur = conn.cursor()
    cur.execute("""
        SELECT url_anuncio, titulo, tipo, preco, quartos, bairro, cidade
        FROM imoveis
        WHERE titulo IS NOT NULL
          AND url_anuncio IS NOT NULL
          AND url_anuncio LIKE 'http%'
        ORDER BY random()
        LIMIT 10
    """)
    rows = cur.fetchall()
    conn.close()
    print(f"✓ {len(rows)} URLs carregadas do banco\n")
    return [
        {"url": r[0], "gt_titulo": r[1], "gt_tipo": r[2],
         "gt_preco": r[3], "gt_quartos": r[4], "gt_bairro": r[5], "gt_cidade": r[6]}
        for r in rows
    ]


# ─── Rodar pipeline com uma configuração ─────────────────────────────────────

def run_extraction(html: str, url: str, cfg: Config) -> tuple:
    global _active_config, _stats
    _active_config = cfg
    _stats.reset()

    result = extract_property_data(html, url)
    snap = LLMStats(
        calls=_stats.calls,
        tokens_in=_stats.tokens_in,
        tokens_out=_stats.tokens_out,
        reasoning_tokens=_stats.reasoning_tokens,
        elapsed=_stats.elapsed,
        empty_responses=_stats.empty_responses,
    )
    return result, snap


# ─── Utilitários ─────────────────────────────────────────────────────────────

_DATA_FIELDS = ["titulo", "tipo", "transacao", "preco", "area_m2",
                "quartos", "banheiros", "vagas", "bairro", "cidade", "descricao"]

def count_fields(r) -> int:
    if r is None:
        return 0
    return sum(1 for f in _DATA_FIELDS if getattr(r, f, None) is not None)


# ─── Impressão da tabela ──────────────────────────────────────────────────────

COL_W = 28   # largura de cada coluna de config
URL_W = 42

def _col_header(cfg: Config) -> str:
    lim = str(cfg.max_tokens) if cfg.max_tokens else "∞"
    return cfg.label.center(COL_W)

def _col_subheader() -> str:
    return f"{'calls':5} {'in':6} {'out':5} {'rsn':5} {'t':4} {'fld':3}".center(COL_W)

def _col_row(s: LLMStats, flds: int) -> str:
    rsn = f"{s.reasoning_tokens}" if s.reasoning_tokens else "0"
    empty = f"!{s.empty_responses}" if s.empty_responses else ""
    return f"{s.calls:5} {s.tokens_in:6} {s.tokens_out:5} {rsn:5} {s.elapsed:4.1f} {flds:3}{empty}"

SEP = "=" * (URL_W + 1 + (COL_W + 3) * len(CONFIGS))

def print_header():
    print("\n" + SEP)
    header = f"{'URL':<{URL_W}} |"
    subhdr = f"{'':>{URL_W}} |"
    for cfg in CONFIGS:
        header += f" {cfg.label:^{COL_W}} |"
        subhdr += f" {'calls in out rsn t fld':^{COL_W}} |"
    print(header)
    print(subhdr)
    print(SEP)

def print_row(url: str, results: list, stats: list[LLMStats], fields: list[int]):
    url_s = ("…" + url[-(URL_W-1):]) if len(url) > URL_W else url
    line = f"{url_s:<{URL_W}} |"
    for s, fld in zip(stats, fields):
        line += f" {_col_row(s, fld):<{COL_W}} |"
    print(line)

def print_totals(all_rows: list[dict]):
    totals = [LLMStats() for _ in CONFIGS]
    total_fields = [0] * len(CONFIGS)

    for row in all_rows:
        for j, (s, fld) in enumerate(zip(row["stats"], row["fields"])):
            totals[j].calls += s.calls
            totals[j].tokens_in += s.tokens_in
            totals[j].tokens_out += s.tokens_out
            totals[j].reasoning_tokens += s.reasoning_tokens
            totals[j].elapsed += s.elapsed
            totals[j].empty_responses += s.empty_responses
            total_fields[j] += fld

    print(SEP)
    line = f"{'TOTAIS':<{URL_W}} |"
    for s, fld in zip(totals, total_fields):
        line += f" {_col_row(s, fld):<{COL_W}} |"
    print(line)

    print("\n📊 RESUMO POR CONFIGURAÇÃO:")
    print(f"  {'Config':<18} {'Total tk':>9} {'In tk':>7} {'Out tk':>7} {'Reason tk':>10} {'Tempo':>7} {'Campos':>7} {'Resps vazias':>13}")
    print(f"  {'-'*80}")
    baseline_tok = totals[0].tokens_total or 1
    baseline_fld = total_fields[0] or 1
    for cfg, s, fld in zip(CONFIGS, totals, total_fields):
        diff_tok = s.tokens_total - baseline_tok
        diff_fld = fld - baseline_fld
        tok_str = f"{s.tokens_total:,}"
        if diff_tok != 0:
            tok_str += f" ({diff_tok:+,})"
        fld_str = f"{fld}"
        if diff_fld != 0:
            fld_str += f" ({diff_fld:+})"
        empty_str = f"{s.empty_responses}" if s.empty_responses else "0"
        print(
            f"  {cfg.label:<18} {tok_str:>9} {s.tokens_in:>7,} {s.tokens_out:>7,} "
            f"{s.reasoning_tokens:>10,} {s.elapsed:>6.1f}s {fld_str:>7} {empty_str:>13}"
        )

    # Vencedor por tokens e por campos
    best_tok_i = min(range(len(totals)), key=lambda i: totals[i].tokens_total if totals[i].calls > 0 else 999999)
    best_fld_i = max(range(len(total_fields)), key=lambda i: total_fields[i])
    print(f"\n  🏆 Menor custo em tokens: {CONFIGS[best_tok_i].label}  ({totals[best_tok_i].tokens_total:,} tokens)")
    print(f"  🏆 Mais campos preenchidos: {CONFIGS[best_fld_i].label}  ({total_fields[best_fld_i]} campos)")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    urls = get_urls()
    if not urls:
        print("Nenhuma URL encontrada no banco!")
        return

    all_rows = []
    print_header()

    for i, item in enumerate(urls):
        url = item["url"]
        print(f"\n[{i+1}/{len(urls)}] {url[:90]}")

        # 1. Baixar HTML UMA VEZ
        try:
            t0 = time.time()
            page = Fetcher.get(url, stealthy_headers=True, timeout=20)
            html = safe_html(page)
            print(f"  HTML: {len(html):,} chars em {time.time()-t0:.1f}s")
        except Exception as e:
            print(f"  ✗ Falha ao baixar: {e}")
            continue

        if not html or len(html) < 200:
            print("  ✗ HTML vazio/muito pequeno — pulando")
            continue

        row_results = []
        row_stats = []
        row_fields = []

        for cfg in CONFIGS:
            label_pad = f"{cfg.label:<14}"
            print(f"  ▶ {label_pad} ...", end="", flush=True)
            try:
                r, s = run_extraction(html, url, cfg)
            except Exception as e:
                print(f" ERRO: {e}")
                r, s = None, LLMStats()
            fld = count_fields(r)
            empty_note = f" ⚠{s.empty_responses}vazia" if s.empty_responses else ""
            print(f" {s.calls}c {s.tokens_total}tk {s.elapsed:.1f}s → {fld} campos{empty_note}")
            row_results.append(r)
            row_stats.append(s)
            row_fields.append(fld)

        print_row(url, row_results, row_stats, row_fields)
        all_rows.append({"url": url, "results": row_results, "stats": row_stats, "fields": row_fields})

        # Diferenças de qualidade entre configs
        diffs = []
        base = row_results[0]  # nano/mini/600 como referência
        for cfg, r in zip(CONFIGS[1:], row_results[1:]):
            if base is None or r is None:
                continue
            fields_diff = []
            for f in ["titulo", "tipo", "preco", "quartos", "bairro", "cidade"]:
                v_base = getattr(base, f, None)
                v_r = getattr(r, f, None)
                if v_base != v_r:
                    fields_diff.append(f"{f}: {v_base!r}→{v_r!r}")
            if fields_diff:
                diffs.append(f"    vs {cfg.label}: {', '.join(fields_diff)}")
        if diffs:
            print("  Diffs vs nano/mini/600:")
            for d in diffs:
                print(d)

    if all_rows:
        print_totals(all_rows)
    else:
        print("\nNenhuma URL processada com sucesso.")

    print("\n" + SEP)


if __name__ == "__main__":
    main()
