"""
Factory-reset hook registry.

Services that hold in-memory state (session caches, scheduler queues, etc.)
register a callback here so the factory-reset flow doesn't need to know about
every service directly. At import time, each service calls register_reset_hook;
backup.factory_reset calls run_reset_hooks after the DB wipe.
"""
import logging
from typing import Callable

log = logging.getLogger(__name__)

ResetHook = Callable[[], None]

_hooks: list[ResetHook] = []


def register_reset_hook(hook: ResetHook) -> None:
    """Register a function to be invoked after a factory reset."""
    _hooks.append(hook)


def run_reset_hooks() -> None:
    """Run every registered reset hook. A failing hook is logged but does not
    abort the remaining hooks — factory reset should clear as much state as
    possible even if one cleanup step fails."""
    for hook in _hooks:
        try:
            hook()
        except Exception as exc:
            log.error("factory reset hook %s failed: %s", hook.__name__, exc, exc_info=True)
