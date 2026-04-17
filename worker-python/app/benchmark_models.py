from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from app.db import ImovelInput

PipelineMode = Literal["legacy", "candidate", "both"]
BenchmarkStage = Literal["discovery", "extraction", "full"]
TriggerMode = Literal["cli", "api"]


@dataclass
class RunTarget:
    fonte_id: str
    site_url: str
    config_snapshot: dict


@dataclass
class DiscoveryResult:
    listing_urls: list[str]
    detail_urls: list[str]
    listing_count: int
    detail_count: int
    http_calls: int
    browser_calls: int
    llm_calls: int
    elapsed_ms: int
    strategy_used: str
    timing_breakdown: dict[str, int] = field(default_factory=dict)
    memory_peak_mb: float = 0.0


@dataclass
class ExtractionItemResult:
    url: str
    data: Optional[ImovelInput]
    field_sources: dict[str, str] = field(default_factory=dict)
    field_confidence: dict[str, float] = field(default_factory=dict)
    validator_status: str = "rejected"
    validator_reasons: dict[str, list[str]] = field(default_factory=dict)
    images_meta: dict = field(default_factory=dict)
    llm_calls: int = 0
    browser_calls: int = 0
    http_calls: int = 0
    elapsed_ms: int = 0
    timing_breakdown: dict[str, int] = field(default_factory=dict)
    memory_peak_mb: float = 0.0
    raw_metrics: dict = field(default_factory=dict)


@dataclass
class PipelineRunResult:
    pipeline_version: str
    stage: BenchmarkStage
    discovery: Optional[DiscoveryResult] = None
    extraction_items: list[ExtractionItemResult] = field(default_factory=list)
    elapsed_ms: int = 0
    summary_metrics: dict = field(default_factory=dict)
