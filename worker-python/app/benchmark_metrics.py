"""
Coleta de métricas por run de benchmark.

Usa contextvars para permitir contabilizar chamadas de HTTP/browser/LLM
sem acoplar o benchmark ao fluxo normal de produção.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import time
from typing import Optional

import psutil


@dataclass
class BenchmarkMetrics:
    http_calls: int = 0
    browser_calls: int = 0
    llm_calls: int = 0
    strategies: list[str] = field(default_factory=list)
    timings: dict[str, int] = field(default_factory=dict)
    peak_memory_mb: float = 0.0

    def to_dict(self) -> dict:
        return {
            "http_calls": self.http_calls,
            "browser_calls": self.browser_calls,
            "llm_calls": self.llm_calls,
            "strategies": list(self.strategies),
            "timings": dict(self.timings),
            "peak_memory_mb": self.peak_memory_mb,
        }


_active_metrics: ContextVar[Optional[BenchmarkMetrics]] = ContextVar("benchmark_metrics", default=None)


@contextmanager
def metrics_scope():
    metrics = BenchmarkMetrics()
    token = _active_metrics.set(metrics)
    try:
        yield metrics
    finally:
        _active_metrics.reset(token)


def get_metrics() -> Optional[BenchmarkMetrics]:
    return _active_metrics.get()


def record_http_call() -> None:
    metrics = get_metrics()
    if metrics is not None:
        metrics.http_calls += 1


def record_browser_call() -> None:
    metrics = get_metrics()
    if metrics is not None:
        metrics.browser_calls += 1


def record_llm_call() -> None:
    metrics = get_metrics()
    if metrics is not None:
        metrics.llm_calls += 1


def record_strategy(name: str) -> None:
    metrics = get_metrics()
    if metrics is not None and name:
        metrics.strategies.append(name)
        sample_memory()


def record_timing(name: str, elapsed_ms: int) -> None:
    metrics = get_metrics()
    if metrics is not None and name:
        metrics.timings[name] = metrics.timings.get(name, 0) + max(int(elapsed_ms), 0)
        sample_memory()


def sample_memory() -> None:
    metrics = get_metrics()
    if metrics is None:
        return
    try:
        rss_mb = psutil.Process().memory_info().rss / (1024 * 1024)
        if rss_mb > metrics.peak_memory_mb:
            metrics.peak_memory_mb = round(rss_mb, 1)
    except Exception:
        return


@contextmanager
def timed_step(name: str):
    started = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        record_timing(name, elapsed_ms)
