"""
In-memory ring buffer for WARNING+ log records.
Install once at startup via install(); read via get_recent().
Captured by the debug endpoint so frontend can show backend errors
without needing SSH access to the Pi.
"""
import logging
from collections import deque
from datetime import datetime, timezone

_buffer: deque = deque(maxlen=300)


class _MemoryHandler(logging.Handler):
    def emit(self, record: logging.LogRecord):
        try:
            _buffer.append({
                "t": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "level": record.levelname,
                "logger": record.name,
                "msg": self.format(record),
            })
        except Exception:
            pass


def install():
    """Attach to the root logger. Call once from main.py lifespan."""
    handler = _MemoryHandler(level=logging.WARNING)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger().addHandler(handler)


def get_recent(n: int = 60) -> list:
    return list(_buffer)[-n:]
