"""
Logging configurado para Railway.

- Formato: [TIMESTAMP] [LEVEL] [MODULE] mensagem
- Colorido/plaintext dependendo do ambiente
- Níveis: DEBUG (dev), INFO (prod)
"""

import logging
import os
import sys
from datetime import datetime


class RailwayFormatter(logging.Formatter):
    """Formatter otimizado para Railway — com timestamps, módulos e ícones."""

    ICONS = {
        logging.DEBUG: "🔍",
        logging.INFO: "📋",
        logging.WARNING: "⚠️",
        logging.ERROR: "❌",
        logging.CRITICAL: "🔥",
    }

    def format(self, record: logging.LogRecord) -> str:
        icon = self.ICONS.get(record.levelno, "📋")
        ts = datetime.fromtimestamp(record.created).strftime("%H:%M:%S.%f")[:-3]
        module = record.name.replace("app.", "")
        return f"[{ts}] {icon} [{module}] {record.getMessage()}"


def setup_logging() -> None:
    """Configura logging global."""
    level = logging.DEBUG if os.getenv("LOG_LEVEL", "").lower() == "debug" else logging.INFO
    
    root = logging.getLogger()
    root.setLevel(level)
    
    # Remove handlers existentes
    for h in root.handlers[:]:
        root.removeHandler(h)
    
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(RailwayFormatter())
    root.addHandler(handler)
    
    # Silencia bibliotecas ruidosas
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("scrapling").setLevel(logging.INFO)
    logging.getLogger("playwright").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Retorna logger com prefixo app."""
    return logging.getLogger(f"app.{name}")
