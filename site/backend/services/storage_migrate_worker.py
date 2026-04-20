"""
Standalone migration worker for the USB Storage feature.

Invoked via the helper's `run-migration` subcommand, which wraps this module
in a detached `systemd-run` transient unit. Running outside mynet.service's
cgroup is what lets the migration call `systemctl stop mynet.service`
without killing itself mid-flight — the classic self-stop deadlock that
took the first implementation down.

Argv:
    python -m services.storage_migrate_worker usb <uuid>
    python -m services.storage_migrate_worker sd

The worker writes progress to migration_state.json throughout, which the
backend reports back to the frontend via /api/storage/status. It never
broadcasts via WebSocket (services.storage.emit is a no-op when no broadcast
function is registered) because the WebSocket lives in the backend's process.
"""
from __future__ import annotations

import asyncio
import logging
import sys

# Ensure the services package resolves relative to the backend working dir
# that the systemd-run transient unit enters. See helper's
# --property=WorkingDirectory= setting.

log = logging.getLogger("storage_migrate_worker")


async def _run() -> int:
    if len(sys.argv) < 2:
        log.error("usage: python -m services.storage_migrate_worker <usb|sd> [uuid]")
        return 2
    direction = sys.argv[1]

    # Import here so the helper's invocation produces a clean error if the
    # virtualenv / PYTHONPATH is broken, rather than a silent ModuleNotFoundError
    # buried in journal output.
    try:
        from services import storage
    except ImportError as e:
        log.error(f"failed to import services.storage: {e}")
        return 3

    try:
        if direction == "usb":
            if len(sys.argv) < 3:
                log.error("usb migration requires a UUID argument")
                return 2
            usb_uuid = sys.argv[2]
            log.info(f"starting SD→USB migration (uuid={usb_uuid})")
            result = await storage.migrate_sd_to_usb(usb_uuid)
        elif direction == "sd":
            log.info("starting USB→SD migration")
            result = await storage.migrate_usb_to_sd()
        else:
            log.error(f"unknown direction: {direction!r}")
            return 2
    except Exception as e:
        log.exception(f"migration failed: {e}")
        return 1

    log.info(f"migration complete: {result}")
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    sys.exit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
