"""
USB Storage router — admin-only endpoints behind /api/storage/*.

See USB_STORAGE_DESIGN.md §10 for the full endpoint list. Every endpoint
returns 501 Not Implemented when run outside a systemd Linux host (§14
decision 8) so the UI can cleanly hide the feature where it can't work.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import FileResponse

from models.user import User
from services.auth import require_admin
from services import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/storage", tags=["storage"])


def _require_platform() -> None:
    if not storage.is_platform_supported():
        raise HTTPException(status_code=501, detail=storage.platform_unsupported_reason())


@router.get("/health")
def health():
    """Unauthenticated health probe for the frontend degraded-mode detector.

    Intentionally requires no DB access — the frontend falls back to this
    when authenticated endpoints start returning 5xx, to tell the user
    whether the problem is the database (usually USB missing or DB corrupt)
    or something transient.
    """
    import sqlite3
    import os
    from pathlib import Path
    db_reachable = False
    reason = ""
    db_path = Path(storage.DB_PATH)

    # Corruption detected at startup takes precedence over everything else —
    # even if the file is technically "reachable" it's not usable.
    corrupt_reason = storage.get_db_corrupt_reason()
    if corrupt_reason:
        reason = f"database corruption: {corrupt_reason}"
    else:
        try:
            if db_path.is_symlink() and not os.path.exists(db_path):
                reason = "database symlink target is missing (USB unmounted?)"
            elif not db_path.exists():
                reason = "database file does not exist"
            else:
                conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
                try:
                    conn.execute("SELECT 1").fetchone()
                    db_reachable = True
                finally:
                    conn.close()
        except Exception as e:
            reason = f"{type(e).__name__}: {e}"

    return {
        "db_reachable": db_reachable,
        "db_integrity_ok": corrupt_reason is None,
        "db_integrity_reason": corrupt_reason or "",
        "platform_supported": storage.is_platform_supported(),
        "mode": storage.load_config().mode,
        "reason": reason,
        "snapshots": storage.last_snapshot_info(),
    }


def _require_db_unreachable_or_corrupt() -> None:
    """Gate for the unauthenticated recovery endpoints. Allows the call
    when the DB is genuinely unhealthy — either it can't be opened (mount
    missing, file gone) or quick_check has flagged it as corrupt at
    startup. Rejects calls when the DB is plainly working, to prevent
    these unauthenticated endpoints being used in normal operation."""
    if storage.get_db_corrupt_reason():
        return
    import sqlite3
    try:
        conn = sqlite3.connect(f"file:{storage.DB_PATH}?mode=ro", uri=True, timeout=2)
        conn.execute("SELECT 1").fetchone()
        conn.close()
        raise HTTPException(status_code=400, detail="database is reachable; recovery endpoints are only callable during degraded mode")
    except HTTPException:
        raise
    except Exception:
        return


# Legacy alias so existing endpoints that only checked unreachability keep
# the same behaviour (the broader gate also covers unreachable cases).
_require_db_unreachable = _require_db_unreachable_or_corrupt


@router.post("/recover/restore-snapshot", status_code=202)
def recover_restore_snapshot(body: dict = Body(...)):
    """Degraded-mode recovery: restore an SD snapshot IN PLACE, keeping the
    current storage mode. Overwrites the DB at DB_PATH (which is a symlink
    to the USB in USB mode, or a plain file in SD mode) with the contents
    of the chosen snapshot.

    Used when the current DB is corrupt but the storage medium itself is
    fine. For a dead USB, use /recover/revert-to-sd instead.

    Body: {which: "current"|"previous"}. Restart handled in a detached
    worker; returns 202 immediately.
    """
    _require_db_unreachable_or_corrupt()
    if not storage.is_platform_supported():
        raise HTTPException(status_code=501, detail=storage.platform_unsupported_reason())
    which = body.get("which", "current")
    if which not in ("current", "previous"):
        raise HTTPException(status_code=400, detail='which must be "current" or "previous"')
    src = storage.SNAPSHOT_CURRENT if which == "current" else storage.SNAPSHOT_PREVIOUS
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"snapshot {which} does not exist")
    try:
        return storage.run_helper("run-restore-snapshot", which)
    except storage.HelperError as e:
        raise HTTPException(status_code=502, detail=f"failed to spawn restore worker: {e}")


@router.post("/recover/remount", status_code=202)
def recover_remount():
    """Degraded-mode recovery: restart mynet.service and remount the USB.

    Called by the "Retry" button on the Degraded Mode screen. After a USB
    pull, SQLAlchemy's connection pool keeps file descriptors on the stale
    filesystem — umount -l alone can't fully release it, and a subsequent
    mount trips "target is busy" or "dependency failed" on the mount unit.
    Proper recovery needs the service stopped first.

    To avoid the self-stop deadlock (we're executing inside mynet.service),
    we invoke the helper's run-remount-recovery subcommand, which dispatches
    the stop/unmount/mount/start dance to a detached systemd-run scope.
    Returns 202 immediately; the frontend polls /health to see when
    recovery completes.
    """
    _require_db_unreachable()
    if not storage.is_platform_supported():
        raise HTTPException(status_code=501, detail=storage.platform_unsupported_reason())
    cfg = storage.load_config()
    if not cfg.usb_uuid:
        raise HTTPException(status_code=400, detail="no USB UUID recorded in storage_config.json")
    try:
        return storage.run_helper("run-remount-recovery", cfg.usb_uuid)
    except storage.HelperError as e:
        raise HTTPException(status_code=502, detail=f"failed to spawn recovery worker: {e}")


@router.post("/recover/revert-to-sd", status_code=202)
def recover_revert_to_sd():
    """Degraded-mode recovery: remove the USB symlink + drop-in, restore the
    latest snapshot to the SD card, and restart the service in SD mode.

    Unauthenticated (no DB → no auth), but gated on the DB actually being
    unreachable or corrupt so this can't be abused to force a revert on a
    healthy install.

    The whole flow is dispatched to a detached systemd-run scope via the
    helper. Running it in-process (as this did previously) raced the
    service restart's SIGTERM against the HTTP response, so the client saw
    "helper service failed" even when the flow had succeeded. The detached
    scope pattern matches /recover/remount and /recover/restore-snapshot.
    """
    _require_db_unreachable()
    if not storage.is_platform_supported():
        raise HTTPException(status_code=501, detail=storage.platform_unsupported_reason())
    which = "current" if storage.SNAPSHOT_CURRENT.exists() else "previous" if storage.SNAPSHOT_PREVIOUS.exists() else None
    if which is None:
        raise HTTPException(status_code=404, detail="no snapshot available to restore from")
    try:
        return storage.run_helper("run-revert-to-sd", which)
    except storage.HelperError as e:
        raise HTTPException(status_code=502, detail=f"failed to spawn revert worker: {e}")


@router.get("/status")
def get_status(_: User = Depends(require_admin)):
    """Full snapshot of storage state for the Settings panel."""
    return storage.full_status()


@router.post("/scan")
def scan(_: User = Depends(require_admin)):
    """Return candidate USB partitions. Empty list on platforms without the helper."""
    _require_platform()
    return {"candidates": storage.detect_usb_candidates()}


@router.post("/initialise")
def initialise(
    body: dict = Body(...),
    _: User = Depends(require_admin),
):
    """Format a device as ext4 with the MYNET-STORAGE label.

    Body: {device: "/dev/sdb1", confirm: "INITIALISE"}
    """
    _require_platform()
    if body.get("confirm") != "INITIALISE":
        raise HTTPException(status_code=400, detail='type "INITIALISE" to confirm')
    device = body.get("device") or ""
    if not device:
        raise HTTPException(status_code=400, detail="device is required")
    try:
        # mkfs.ext4 on a multi-GB USB can take minutes on a Pi. 600s ceiling.
        return storage.run_helper("init", device, timeout=600)
    except storage.HelperError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/migrate", status_code=202)
async def migrate(
    body: dict = Body(...),
    _: User = Depends(require_admin),
):
    """Trigger an SD↔USB migration.

    Body: {target: "usb"|"sd", confirm: "MIGRATE", usb_uuid?: "…"}
    (usb_uuid required when target=usb.)

    Returns 202 Accepted and spawns a detached worker via the helper's
    `run-migration` subcommand. The worker runs in a systemd-run transient
    unit outside mynet.service's cgroup so it survives the service stop/start
    the migration performs mid-flight. Frontend polls /api/storage/status
    (which reads migration_state.json) to track progress.
    """
    _require_platform()
    if body.get("confirm") != "MIGRATE":
        raise HTTPException(status_code=400, detail='type "MIGRATE" to confirm')

    if storage.is_migration_in_progress():
        raise HTTPException(status_code=409, detail="a migration is already in progress")

    target = body.get("target")
    if target == storage.MODE_USB:
        uuid = (body.get("usb_uuid") or "").strip()
        if not uuid:
            raise HTTPException(status_code=400, detail="usb_uuid is required when target=usb")
        # Mount the USB before kicking off the worker so the helper's
        # validation sees a mountable partition and so the worker can
        # write to /mnt/mynet-storage/ immediately.
        try:
            storage.run_helper("mount", uuid)
        except storage.HelperError as e:
            raise HTTPException(status_code=400, detail=f"mount failed: {e}")
        try:
            return storage.run_helper("run-migration", "usb", uuid)
        except storage.HelperError as e:
            raise HTTPException(status_code=500, detail=f"failed to spawn migration worker: {e}")

    if target == storage.MODE_SD:
        try:
            return storage.run_helper("run-migration", "sd")
        except storage.HelperError as e:
            raise HTTPException(status_code=500, detail=f"failed to spawn migration worker: {e}")

    raise HTTPException(status_code=400, detail='target must be "usb" or "sd"')


@router.post("/snapshot/now")
async def snapshot_now(_: User = Depends(require_admin)):
    """Force an out-of-cycle snapshot."""
    _require_platform()
    if storage.is_migration_in_progress():
        raise HTTPException(status_code=409, detail="migration in progress")
    try:
        return storage.take_snapshot()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/snapshot/restore")
def snapshot_restore(
    body: dict = Body(...),
    _: User = Depends(require_admin),
):
    """Restore a snapshot to the active DB path. Service is restarted.

    Body: {which: "current"|"previous", confirm: "RESTORE"}
    """
    _require_platform()
    if body.get("confirm") != "RESTORE":
        raise HTTPException(status_code=400, detail='type "RESTORE" to confirm')
    which = body.get("which")
    src = storage.SNAPSHOT_CURRENT if which == "current" else storage.SNAPSHOT_PREVIOUS if which == "previous" else None
    if src is None:
        raise HTTPException(status_code=400, detail='which must be "current" or "previous"')
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"snapshot {which} does not exist")

    # Stop service → copy snapshot over DB_PATH (respecting symlink if active)
    # → start service. Restore leaves storage mode alone: if the user is
    # restoring while in USB mode, the snapshot ends up on the USB.
    try:
        storage.run_helper("service", "stop")
        dest = storage.DB_PATH.resolve() if storage.DB_PATH.is_symlink() else storage.DB_PATH
        # Copy via sqlite3 backup so we verify integrity on the way in
        storage._sqlite_online_backup(src, dest.with_suffix(dest.suffix + ".restore-tmp"))
        tmp = dest.with_suffix(dest.suffix + ".restore-tmp")
        if not storage._integrity_check(tmp):
            tmp.unlink(missing_ok=True)
            raise RuntimeError("restored snapshot failed integrity_check")
        tmp.replace(dest)
        os.chmod(dest, 0o600)
        storage.run_helper("service", "start")
    except storage.HelperError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"ok": True, "restored": which}


@router.get("/snapshot/download")
def snapshot_download(which: str = "current", _: User = Depends(require_admin)):
    """Stream the current or previous snapshot file. Admin-only (§14 decision 6).

    Returns 409 during migrations (§14 decision 4 context).
    """
    if storage.is_migration_in_progress():
        raise HTTPException(status_code=409, detail="migration in progress")
    src: Path
    if which == "current":
        src = storage.SNAPSHOT_CURRENT
    elif which == "previous":
        src = storage.SNAPSHOT_PREVIOUS
    else:
        raise HTTPException(status_code=400, detail='which must be "current" or "previous"')
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"snapshot {which} does not exist yet")
    filename = f"mynet-snapshot-{which}.db"
    return FileResponse(str(src), media_type="application/vnd.sqlite3", filename=filename)


@router.post("/unmount")
def unmount(_: User = Depends(require_admin)):
    """Unmount the USB. Only valid from SD mode (would otherwise take the DB
    offline). Used by the uninstall flow and by Settings after a USB→SD
    migration if the user wants to safely remove the drive."""
    _require_platform()
    cfg = storage.load_config()
    if cfg.mode != storage.MODE_SD:
        raise HTTPException(status_code=400, detail="cannot unmount while USB is the active storage")
    try:
        return storage.run_helper("unmount")
    except storage.HelperError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/migration-state/dismiss")
def dismiss_migration_state(_: User = Depends(require_admin)):
    """Clear a lingering migration_state.json entry — used by the UI's
    Dismiss button after a failed migration. No-op if no state present."""
    storage.clear_migration_state()
    return {"ok": True}


@router.patch("/snapshot-interval")
def set_snapshot_interval(
    body: dict = Body(...),
    _: User = Depends(require_admin),
):
    """Change the snapshot cadence. Body: {seconds: 900|1800|3600|21600}"""
    _require_platform()
    secs = int(body.get("seconds", 0))
    try:
        from services.monitoring_scheduler import scheduler
        storage.set_snapshot_interval(scheduler, secs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "snapshot_interval_secs": secs}
