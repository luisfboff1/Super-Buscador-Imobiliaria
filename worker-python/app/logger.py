"""
Logging configurado para Railway.

- Formato: [TIMESTAMP] [LEVEL] [MODULE] mensagem
- ASCII-safe icons (no emojis — avoids cp1252 crashes on Windows)
- Dual output: console + worker.log file (survives OOM kills)
"""

import logging
import logging.handlers
import os
import sys
from datetime import datetime


class RailwayFormatter(logging.Formatter):
    """Formatter otimizado para Railway — ASCII-safe."""

    ICONS = {
        logging.DEBUG: "[DBG]",
        logging.INFO: "[INF]",
        logging.WARNING: "[WRN]",
        logging.ERROR: "[ERR]",
        logging.CRITICAL: "[CRT]",
    }

    def format(self, record: logging.LogRecord) -> str:
        icon = self.ICONS.get(record.levelno, "[INF]")
        ts = datetime.fromtimestamp(record.created).strftime("%H:%M:%S.%f")[:-3]
        module = record.name.replace("app.", "")
        msg = record.getMessage()
        # Sanitize non-ASCII chars that would crash cp1252 on Windows
        try:
            msg.encode(sys.stdout.encoding or "utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError, LookupError):
            msg = msg.encode("ascii", errors="replace").decode("ascii")
        return f"[{ts}] {icon} [{module}] {msg}"


def setup_logging() -> None:
    """Configura logging global."""
    level = logging.DEBUG if os.getenv("LOG_LEVEL", "").lower() == "debug" else logging.INFO
    
    root = logging.getLogger()
    root.setLevel(level)
    
    # Remove handlers existentes
    for h in root.handlers[:]:
        root.removeHandler(h)
    
    # Console handler — writes to sys.stdout directly (no wrapper)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(RailwayFormatter())
    root.addHandler(handler)
    
    # File handler — survives OOM kills (RotatingFileHandler, 10MB, 2 backups)
    try:
        log_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        log_path = os.path.join(log_dir, "worker.log")
        fh = logging.handlers.RotatingFileHandler(
            log_path, maxBytes=10 * 1024 * 1024, backupCount=2,
            encoding="utf-8",
        )
        fh.setFormatter(RailwayFormatter())
        fh.setLevel(level)
        root.addHandler(fh)
    except Exception:
        pass  # Don't crash if file logging fails
    
    # Silencia bibliotecas ruidosas — evita linhas duplicadas de "Fetched (200)"
    # scrapling/httpx chamam logging.basicConfig() que cria handler extra no root;
    # setando WARNING, as msgs INFO do scrapling nem são criadas.
    for noisy in ("urllib3", "scrapling", "playwright", "httpx", "httpcore",
                  "hpack", "httpx._client", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Proteção extra: se alguma lib adicionou handler ao root depois do nosso
    # cleanup (via basicConfig), remove todos exceto os nossos.
    _our_handlers = {id(handler)}
    try:
        _our_handlers.add(id(fh))
    except NameError:
        pass
    for h in root.handlers[:]:
        if id(h) not in _our_handlers:
            root.removeHandler(h)


def get_logger(name: str) -> logging.Logger:
    """Retorna logger com prefixo app."""
    return logging.getLogger(f"app.{name}")
