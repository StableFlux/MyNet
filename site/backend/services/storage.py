"""
USB Storage service — implements the feature described in USB_STORAGE_DESIGN.md.

Responsibilities:
- Platform detection (feature is disabled off systemd Linux per decision 8)
- Read/write storage_config.json and migration_state.json
- Thin wrapper over the privileged /usr/local/bin/mynet-storage helper
- Snapshot scheduler (piggybacks on services.monitoring_scheduler.scheduler)
- Pull-detection watcher (asyncio task polling /proc/mounts)
- Migration state machine with resumable phases
- Broadcast storage.* events through the WebSocket ConnectionManager

All privileged operations go through the helper script via sudo. This module
never shells out to mount/umount/mkfs/systemctl directly.
"""
from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger(__name__)


# ── Constants ─────────────────────────────────────────────────────────────────

INSTALL_DIR = Path("/opt/mynet")
DATA_DIR = INSTALL_DIR / "data"
DB_PATH = DATA_DIR / "mynet.db"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"
STORAGE_CONFIG_PATH = DATA_DIR / "storage_config.json"
MIGRATION_STATE_PATH = DATA_DIR / "migration_state.json"
MIGRATION_LOCK_PATH = DATA_DIR / "migration.lock"
PRE_MIGRATION_DB = DATA_DIR / "mynet.db.pre-migration"
PRE_MIGRATION_RETENTION_SECS = 24 * 3600   # §14 decision 7
MOUNT_POINT = Path("/mnt/mynet-storage")

HELPER_PATH = "/usr/local/bin/mynet-storage"
SERVICE_NAME = "mynet.service"

SNAPSHOT_CURRENT = SNAPSHOTS_DIR / "mynet-current.db"
SNAPSHOT_PREVIOUS = SNAPSHOTS_DIR / "mynet-previous.db"
SNAPSHOT_TMP_SUFFIX = ".tmp"

# Free-space alert thresholds (§11)
FREE_SPACE_WARN_PCT = 0.80
FREE_SPACE_HARD_STOP_PCT = 0.95

DEFAULT_SNAPSHOT_INTERVAL_SECS = 3600         # 1 hour default (§14 decision 3)
ALLOWED_SNAPSHOT_INTERVALS = (900, 1800, 3600, 21600)   # 15m / 30m / 1h / 6h

MODE_SD = "sd"
MODE_USB = "usb"

# Migration phases — persisted to migration_state.json so a crash can resume
PHASE_PREFLIGHT = "preflight"
PHASE_SNAPSHOT = "snapshot"
PHASE_STOP_SERVICE = "stop_service"
PHASE_COPY = "copy"
PHASE_VERIFY_DEST = "verify_destination"
PHASE_INSTALL_DROPIN = "install_dropin"
PHASE_SWAP = "swap"
PHASE_START_SERVICE = "start_service"
PHASE_VERIFY_PROBE = "verify_probe"
PHASE_COMPLETE = "complete"
PHASE_ROLLING_BACK = "rolling_back"


# ── Platform detection ────────────────────────────────────────────────────────

def is_platform_supported() -> bool:
    """§14 decision 8: feature disabled entirely outside systemd Linux.

    True only when we can reasonably expect the helper script, systemctl, and
    real block devices to work. Endpoints return 501 otherwise.
    """
    if sys.platform != "linux":
        return False
    if not Path("/run/systemd/system").exists():
        return False
    if not Path(HELPER_PATH).exists():
        return False
    return True


def platform_unsupported_reason() -> str:
    if sys.platform != "linux":
        return "USB storage requires a Linux host"
    if not Path("/run/systemd/system").exists():
        return "USB storage requires systemd"
    if not Path(HELPER_PATH).exists():
        return f"USB storage helper not installed at {HELPER_PATH}"
    return ""


# ── Config file (mode / interval / chosen UUID) ───────────────────────────────

@dataclass
class StorageConfig:
    mode: str = MODE_SD
    usb_uuid: str = ""
    snapshot_interval_secs: int = DEFAULT_SNAPSHOT_INTERVAL_SECS


def load_config() -> StorageConfig:
    if not STORAGE_CONFIG_PATH.exists():
        return StorageConfig()
    try:
        raw = json.loads(STORAGE_CONFIG_PATH.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.warning(f"storage_config.json unreadable, using defaults: {e}")
        return StorageConfig()
    cfg = StorageConfig(
        mode=raw.get("mode", MODE_SD),
        usb_uuid=raw.get("usb_uuid", ""),
        snapshot_interval_secs=int(raw.get("snapshot_interval_secs", DEFAULT_SNAPSHOT_INTERVAL_SECS)),
    )
    if cfg.snapshot_interval_secs not in ALLOWED_SNAPSHOT_INTERVALS:
        cfg.snapshot_interval_secs = DEFAULT_SNAPSHOT_INTERVAL_SECS
    if cfg.mode not in (MODE_SD, MODE_USB):
        cfg.mode = MODE_SD
    return cfg


def save_config(cfg: StorageConfig) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORAGE_CONFIG_PATH.with_suffix(STORAGE_CONFIG_PATH.suffix + SNAPSHOT_TMP_SUFFIX)
    tmp.write_text(json.dumps(asdict(cfg), indent=2))
    tmp.replace(STORAGE_CONFIG_PATH)


# ── Migration state (phase tracking for crash recovery) ───────────────────────

@dataclass
class MigrationState:
    target: str          # MODE_SD or MODE_USB
    phase: str
    started_at: float = field(default_factory=time.time)
    usb_uuid: str = ""
    error: str = ""
    detail: dict = field(default_factory=dict)


def load_migration_state() -> Optional[MigrationState]:
    if not MIGRATION_STATE_PATH.exists():
        return None
    try:
        raw = json.loads(MIGRATION_STATE_PATH.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.warning(f"migration_state.json unreadable: {e}")
        return None
    return MigrationState(**{k: raw.get(k, getattr(MigrationState, k, ""))
                             for k in MigrationState.__dataclass_fields__.keys()})


def save_migration_state(state: MigrationState) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MIGRATION_STATE_PATH.with_suffix(MIGRATION_STATE_PATH.suffix + SNAPSHOT_TMP_SUFFIX)
    tmp.write_text(json.dumps(asdict(state), indent=2))
    tmp.replace(MIGRATION_STATE_PATH)


def clear_migration_state() -> None:
    try:
        MIGRATION_STATE_PATH.unlink()
    except FileNotFoundError:
        pass


# ── File lock for migration concurrency + snapshot mutex ──────────────────────

class MigrationLock:
    """Non-blocking flock on migration.lock.

    The state machine acquires this at pre-flight. The snapshot scheduler
    checks for it (via a try-acquire) and skips the tick when held.
    """
    def __init__(self):
        self._fh = None

    def acquire(self) -> bool:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._fh = open(MIGRATION_LOCK_PATH, "w")
        try:
            fcntl.flock(self._fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self._fh.close()
            self._fh = None
            return False

    def release(self) -> None:
        if self._fh is not None:
            try:
                fcntl.flock(self._fh, fcntl.LOCK_UN)
            finally:
                self._fh.close()
                self._fh = None


def is_migration_in_progress() -> bool:
    """Snapshot scheduler calls this to decide whether to skip the tick."""
    if not MIGRATION_LOCK_PATH.exists():
        return False
    try:
        with open(MIGRATION_LOCK_PATH, "r") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fh, fcntl.LOCK_UN)
            return False
    except OSError:
        return True


# ── Helper subprocess wrapper ─────────────────────────────────────────────────

class HelperError(RuntimeError):
    pass


def run_helper(subcommand: str, *args: str, timeout: int = 30) -> dict:
    """Invoke /usr/local/bin/mynet-storage via sudo and parse JSON output.

    The helper is whitelisted in /etc/sudoers.d/mynet-storage with NOPASSWD.
    Returns the parsed JSON body. Raises HelperError on non-zero exit or
    unparseable output, preserving stderr for diagnostics.
    """
    if not is_platform_supported():
        raise HelperError(f"storage helper unavailable: {platform_unsupported_reason()}")
    cmd = ["sudo", "-n", HELPER_PATH, subcommand, *args]
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise HelperError(f"helper timed out: {subcommand}")
    except FileNotFoundError:
        raise HelperError("sudo not available")
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        raise HelperError(f"helper {subcommand} failed: {msg}")
    # version returns plain text, not JSON
    if subcommand == "version":
        return {"version": proc.stdout.strip()}
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as e:
        raise HelperError(f"helper {subcommand} returned invalid JSON: {e}")


# ── Status (combines helper output with backend-side info) ────────────────────

def last_snapshot_info() -> dict:
    """Return timestamps + sizes for current + previous snapshots."""
    def info(path: Path) -> dict:
        if not path.exists():
            return {"exists": False}
        st = path.stat()
        return {
            "exists": True,
            "size_bytes": st.st_size,
            "modified_at": int(st.st_mtime),
        }
    return {
        "current": info(SNAPSHOT_CURRENT),
        "previous": info(SNAPSHOT_PREVIOUS),
    }


def full_status() -> dict:
    """Shape consumed by GET /api/storage/status."""
    cfg = load_config()
    if not is_platform_supported():
        return {
            "platform_supported": False,
            "reason": platform_unsupported_reason(),
            "mode": cfg.mode,
            "snapshot_interval_secs": cfg.snapshot_interval_secs,
        }
    try:
        helper = run_helper("status")
    except HelperError as e:
        helper = {"error": str(e)}
    state = load_migration_state()
    return {
        "platform_supported": True,
        "mode": cfg.mode,
        "snapshot_interval_secs": cfg.snapshot_interval_secs,
        "usb_uuid": cfg.usb_uuid,
        "helper": helper,
        "snapshots": last_snapshot_info(),
        "migration_in_progress": is_migration_in_progress(),
        "migration_state": asdict(state) if state else None,
        "allowed_snapshot_intervals": list(ALLOWED_SNAPSHOT_INTERVALS),
    }


def detect_usb_candidates() -> list[dict]:
    """Return the helper's candidate list, filtered to ext4 / likely-mynet drives."""
    if not is_platform_supported():
        return []
    try:
        raw = run_helper("detect")
    except HelperError as e:
        log.warning(f"detect_usb_candidates failed: {e}")
        return []
    # Helper returns a JSON array directly
    if isinstance(raw, list):
        return raw
    return raw.get("candidates", []) if isinstance(raw, dict) else []


def first_run_storage_candidate() -> Optional[dict]:
    """§6: called from /api/auth/setup-required when users_count == 0.

    Returns a summary of a ready-to-use MyNet USB drive (label MYNET-STORAGE
    with a readable MyNet DB) or None when no such drive is present.
    """
    if not is_platform_supported():
        return None
    # Only consider candidates labelled MYNET-STORAGE
    candidates = [c for c in detect_usb_candidates() if c.get("label") == "MYNET-STORAGE"]
    if len(candidates) != 1:
        return None
    cand = candidates[0]
    # We need to mount read-only temporarily to confirm this is a valid MyNet DB.
    # For safety on first-run, we skip mounting and instead rely on the label;
    # the wizard flow will do a real mount + verify before committing.
    return {
        "device": cand.get("device"),
        "uuid": cand.get("uuid"),
        "label": cand.get("label"),
        "size_bytes": cand.get("size_bytes"),
    }


# ── Snapshot operation ────────────────────────────────────────────────────────

def _sqlite_online_backup(source: Path, dest: Path) -> None:
    """Take a consistent online copy of `source` to `dest` using SQLite's
    backup API. Safe to run while writers are active."""
    src_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dst_conn = sqlite3.connect(str(dest))
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
    finally:
        src_conn.close()


def _integrity_check(db: Path) -> bool:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        cur = conn.execute("PRAGMA integrity_check")
        row = cur.fetchone()
        return bool(row and row[0] == "ok")
    finally:
        conn.close()


def take_snapshot() -> dict:
    """Write a fresh snapshot to SD.

    Rotation: current → previous, new copy → current. Uses a tmp file +
    atomic rename so a crash mid-copy never replaces a good snapshot.
    Integrity-checked before being considered valid.
    """
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists() and not DB_PATH.is_symlink():
        raise FileNotFoundError(f"DB not found at {DB_PATH}")

    # Resolve the symlink so we back up the actual file, not the link itself
    source = DB_PATH.resolve()
    tmp = SNAPSHOT_CURRENT.with_suffix(SNAPSHOT_CURRENT.suffix + SNAPSHOT_TMP_SUFFIX)
    # Defensive: remove stale tmp from a previous crash
    if tmp.exists():
        tmp.unlink()

    _sqlite_online_backup(source, tmp)
    if not _integrity_check(tmp):
        tmp.unlink(missing_ok=True)
        raise RuntimeError("snapshot failed integrity_check")

    # Rotate: current → previous (atomic), tmp → current (atomic)
    if SNAPSHOT_CURRENT.exists():
        SNAPSHOT_CURRENT.replace(SNAPSHOT_PREVIOUS)
    tmp.replace(SNAPSHOT_CURRENT)

    os.chmod(SNAPSHOT_CURRENT, 0o600)
    return {
        "current": {"size_bytes": SNAPSHOT_CURRENT.stat().st_size, "modified_at": int(time.time())},
        "previous": {"exists": SNAPSHOT_PREVIOUS.exists()},
    }


# ── Pre-migration anchor cleanup ──────────────────────────────────────────────

def cleanup_pre_migration_if_old() -> None:
    """§14 decision 7: delete the pre-migration anchor 24h after migration.

    Runs on service startup and once per snapshot tick.
    """
    if not PRE_MIGRATION_DB.exists():
        return
    age = time.time() - PRE_MIGRATION_DB.stat().st_mtime
    if age >= PRE_MIGRATION_RETENTION_SECS:
        try:
            PRE_MIGRATION_DB.unlink()
            log.info(f"deleted aged pre-migration anchor ({int(age/3600)}h old)")
        except OSError as e:
            log.warning(f"failed to delete pre-migration anchor: {e}")


# ── WebSocket emission ────────────────────────────────────────────────────────
# A broadcast callable is registered from main.py at startup. The same
# mechanism monitoring_scheduler.py uses.

_ws_broadcast_fn: Optional[Callable[[dict], Awaitable[None]]] = None


def set_broadcast_fn(fn: Callable[[dict], Awaitable[None]]) -> None:
    global _ws_broadcast_fn
    _ws_broadcast_fn = fn


async def emit(subtype: str, **data: Any) -> None:
    if _ws_broadcast_fn is None:
        return
    try:
        await _ws_broadcast_fn({"type": "storage", "subtype": subtype, **data})
    except Exception as e:
        log.warning(f"storage emit failed: {e}")


# ── Migration state machine ──────────────────────────────────────────────────

async def _probe_db() -> bool:
    """Post-migration verification: open the (symlinked) DB and read one row."""
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        try:
            conn.execute("SELECT id FROM system_settings LIMIT 1").fetchone()
            return True
        finally:
            conn.close()
    except sqlite3.Error as e:
        log.warning(f"verification probe failed: {e}")
        return False


async def migrate_sd_to_usb(usb_uuid: str) -> dict:
    """Full SD → USB migration. Steps match §4 of the design doc."""
    lock = MigrationLock()
    if not lock.acquire():
        raise RuntimeError("another migration is already in progress")

    state = MigrationState(target=MODE_USB, phase=PHASE_PREFLIGHT, usb_uuid=usb_uuid)
    save_migration_state(state)

    try:
        # Pre-flight: snapshot first so the anchor doubles as the first hourly snapshot
        await emit("migration.phase", phase=PHASE_SNAPSHOT)
        state.phase = PHASE_SNAPSHOT; save_migration_state(state)
        take_snapshot()

        # Stop the service to quiesce writes. systemctl called via helper.
        await emit("migration.phase", phase=PHASE_STOP_SERVICE)
        state.phase = PHASE_STOP_SERVICE; save_migration_state(state)
        run_helper("service", "stop")

        # Preserve the SD DB as rollback anchor
        if DB_PATH.exists() and not DB_PATH.is_symlink():
            DB_PATH.rename(PRE_MIGRATION_DB)

        # Copy to USB using sqlite3 .backup
        await emit("migration.phase", phase=PHASE_COPY)
        state.phase = PHASE_COPY; save_migration_state(state)
        usb_db = MOUNT_POINT / "mynet.db"
        if usb_db.exists():
            usb_db.unlink()
        _sqlite_online_backup(PRE_MIGRATION_DB, usb_db)

        # Integrity check on the destination before we commit to it
        await emit("migration.phase", phase=PHASE_VERIFY_DEST)
        state.phase = PHASE_VERIFY_DEST; save_migration_state(state)
        if not _integrity_check(usb_db):
            raise RuntimeError("USB copy failed integrity_check")

        # Install drop-in making the mount a hard requirement on next boot
        await emit("migration.phase", phase=PHASE_INSTALL_DROPIN)
        state.phase = PHASE_INSTALL_DROPIN; save_migration_state(state)
        run_helper("enable-mount-dependency", usb_uuid)

        # Flip the symlink — from here on DB_PATH resolves to the USB file
        await emit("migration.phase", phase=PHASE_SWAP)
        state.phase = PHASE_SWAP; save_migration_state(state)
        run_helper("swap-symlink", str(usb_db))

        # Persist config before restart so the scheduler/pull-watcher see USB mode
        cfg = load_config()
        cfg.mode = MODE_USB
        cfg.usb_uuid = usb_uuid
        save_config(cfg)

        # Start the service and verify it can open the DB
        await emit("migration.phase", phase=PHASE_START_SERVICE)
        state.phase = PHASE_START_SERVICE; save_migration_state(state)
        run_helper("service", "start")

        # systemd may take a moment to bring the service up
        await asyncio.sleep(2.0)

        await emit("migration.phase", phase=PHASE_VERIFY_PROBE)
        state.phase = PHASE_VERIFY_PROBE; save_migration_state(state)
        for _ in range(10):
            if await _probe_db():
                break
            await asyncio.sleep(1.0)
        else:
            raise RuntimeError("verification probe failed after migration")

        state.phase = PHASE_COMPLETE
        save_migration_state(state)
        await emit("migration.phase", phase=PHASE_COMPLETE)
        clear_migration_state()

        return {"ok": True, "mode": MODE_USB}

    except Exception as exc:
        log.exception("migration sd→usb failed; rolling back")
        state.phase = PHASE_ROLLING_BACK
        state.error = str(exc)
        save_migration_state(state)
        await emit("migration.phase", phase=PHASE_ROLLING_BACK, error=str(exc))
        await _rollback_to_sd()
        # Intentionally DO NOT clear migration_state here. The frontend needs
        # to be able to render the failure reason after the worker exits;
        # the user dismisses it explicitly via the API. The next migration
        # attempt overwrites this state anyway.
        raise
    finally:
        lock.release()


async def migrate_usb_to_sd() -> dict:
    """USB → SD. Symmetric to migrate_sd_to_usb; reuses the same state file."""
    lock = MigrationLock()
    if not lock.acquire():
        raise RuntimeError("another migration is already in progress")

    state = MigrationState(target=MODE_SD, phase=PHASE_PREFLIGHT)
    save_migration_state(state)

    try:
        await emit("migration.phase", phase=PHASE_SNAPSHOT)
        state.phase = PHASE_SNAPSHOT; save_migration_state(state)
        take_snapshot()

        await emit("migration.phase", phase=PHASE_STOP_SERVICE)
        state.phase = PHASE_STOP_SERVICE; save_migration_state(state)
        run_helper("service", "stop")

        usb_db = MOUNT_POINT / "mynet.db"
        incoming = DATA_DIR / "mynet.db.incoming"
        if incoming.exists():
            incoming.unlink()

        await emit("migration.phase", phase=PHASE_COPY)
        state.phase = PHASE_COPY; save_migration_state(state)
        _sqlite_online_backup(usb_db, incoming)

        await emit("migration.phase", phase=PHASE_VERIFY_DEST)
        state.phase = PHASE_VERIFY_DEST; save_migration_state(state)
        if not _integrity_check(incoming):
            raise RuntimeError("SD copy failed integrity_check")

        # Remove the symlink, then rename the copy into place. The existing
        # pre-migration file from the prior SD→USB migration (if still on SD)
        # becomes a secondary safety net until its 24h auto-delete.
        run_helper("remove-symlink")
        incoming.replace(DB_PATH)
        os.chmod(DB_PATH, 0o600)

        # Remove the mount-dependency drop-in and unmount the USB
        run_helper("disable-mount-dependency")
        run_helper("unmount")

        cfg = load_config()
        cfg.mode = MODE_SD
        cfg.usb_uuid = ""
        save_config(cfg)

        await emit("migration.phase", phase=PHASE_START_SERVICE)
        state.phase = PHASE_START_SERVICE; save_migration_state(state)
        run_helper("service", "start")
        await asyncio.sleep(2.0)

        await emit("migration.phase", phase=PHASE_VERIFY_PROBE)
        state.phase = PHASE_VERIFY_PROBE; save_migration_state(state)
        for _ in range(10):
            if await _probe_db():
                break
            await asyncio.sleep(1.0)
        else:
            raise RuntimeError("verification probe failed after migration")

        state.phase = PHASE_COMPLETE
        save_migration_state(state)
        await emit("migration.phase", phase=PHASE_COMPLETE)
        clear_migration_state()

        return {"ok": True, "mode": MODE_SD}

    except Exception as exc:
        log.exception("migration usb→sd failed; attempting service restart")
        state.phase = PHASE_ROLLING_BACK
        state.error = str(exc)
        save_migration_state(state)
        await emit("migration.phase", phase=PHASE_ROLLING_BACK, error=str(exc))
        # Minimal rollback: leave the symlink pointing at USB if it still does,
        # restart the service, surface the error. migration_state is left for
        # the frontend to display; user dismisses it explicitly.
        try:
            run_helper("service", "start")
        except HelperError:
            pass
        raise
    finally:
        lock.release()


async def _rollback_to_sd() -> None:
    """Restore the pre-migration SD DB and start the service on SD mode.

    Used when an SD→USB migration fails mid-flight. Leaves the installation
    in a known-good SD-mode state.
    """
    try:
        run_helper("remove-symlink")
    except HelperError:
        pass
    try:
        run_helper("disable-mount-dependency")
    except HelperError:
        pass
    if PRE_MIGRATION_DB.exists():
        try:
            PRE_MIGRATION_DB.replace(DB_PATH)
            os.chmod(DB_PATH, 0o600)
        except OSError as e:
            log.error(f"rollback: failed to restore pre-migration DB: {e}")
    try:
        run_helper("service", "start")
    except HelperError as e:
        log.error(f"rollback: service start failed: {e}")


# ── Resume on startup ─────────────────────────────────────────────────────────

def resume_or_rollback_on_startup() -> None:
    """§13 step 5 — runs BEFORE SQLAlchemy create_engine.

    Inspects migration_state.json and either completes the migration or rolls
    back, leaving the installation in a state where DB_PATH points at a valid
    DB file before the app opens any connection.
    """
    state = load_migration_state()
    if state is None:
        cleanup_pre_migration_if_old()
        return

    log.warning(
        f"resuming from interrupted migration (target={state.target} phase={state.phase})"
    )

    # A crashed migration at phase COPY / VERIFY_DEST / INSTALL_DROPIN / SWAP:
    # the symlink may or may not have been flipped. Safest action is to
    # roll back to SD: restore pre-migration anchor, remove symlink, remove
    # drop-in. The service can then start in SD mode.
    if state.target == MODE_USB:
        log.warning("rolling back failed SD→USB migration")
        # Remove symlink (may not exist) — do this synchronously without helper
        # calls if possible, because the helper requires systemd and we might
        # be pre-systemd here (we shouldn't be, but belt-and-braces).
        if DB_PATH.is_symlink():
            try:
                DB_PATH.unlink()
            except OSError:
                pass
        if PRE_MIGRATION_DB.exists() and not DB_PATH.exists():
            try:
                PRE_MIGRATION_DB.replace(DB_PATH)
            except OSError as e:
                log.error(f"failed to restore pre-migration DB during resume: {e}")
        # Force SD mode in config so the service starts clean
        cfg = load_config()
        cfg.mode = MODE_SD
        cfg.usb_uuid = ""
        save_config(cfg)
        # Try to remove the drop-in via the helper if available; otherwise the
        # next update.sh / sudoers-gated call will clean it up
        try:
            if is_platform_supported():
                run_helper("disable-mount-dependency")
        except HelperError as e:
            log.warning(f"resume: disable-mount-dependency failed (will retry on next start): {e}")

    elif state.target == MODE_SD:
        # Crashed USB→SD. Was the copy successful? If DB_PATH is a plain file
        # and not a symlink, the rename already happened and we just need to
        # clean up. Otherwise fall back to the USB file if mounted.
        if DB_PATH.is_symlink():
            # Rename never happened — leave it pointing at USB; next boot
            # with USB mounted will work. Ensure config still says USB mode.
            cfg = load_config()
            cfg.mode = MODE_USB
            save_config(cfg)

    clear_migration_state()
    cleanup_pre_migration_if_old()


# ── Pull-detection watcher ────────────────────────────────────────────────────

class PullDetector:
    """Async task that polls /proc/mounts at 1-second intervals.

    When the configured USB mount disappears, or the mount becomes read-only,
    emits storage.usb_lost. The frontend renders a degraded banner; backend
    upstream callers consult a flag to pause writers.
    """
    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._lost = False

    @property
    def usb_lost(self) -> bool:
        return self._lost

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="storage.pull_detector")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await self._tick()
            except Exception as e:
                log.warning(f"pull detector tick error: {e}")
            await asyncio.sleep(1.0)

    async def _tick(self) -> None:
        cfg = load_config()
        if cfg.mode != MODE_USB:
            if self._lost:
                self._lost = False
            return
        try:
            raw = Path("/proc/mounts").read_text()
        except OSError:
            return
        mount_line = None
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1] == str(MOUNT_POINT):
                mount_line = parts
                break
        if mount_line is None:
            if not self._lost:
                self._lost = True
                await emit("usb_lost", reason="mount_missing")
            return
        opts = mount_line[3] if len(mount_line) > 3 else ""
        if "ro" in opts.split(","):
            if not self._lost:
                self._lost = True
                await emit("usb_lost", reason="mounted_read_only")


pull_detector = PullDetector()


# ── Snapshot scheduler hook ──────────────────────────────────────────────────

async def snapshot_job() -> None:
    """APScheduler-invoked. Skips when a migration holds the lock."""
    if is_migration_in_progress():
        log.info("snapshot tick skipped — migration in progress")
        return
    if pull_detector.usb_lost:
        log.info("snapshot tick skipped — USB is lost")
        return
    try:
        info = take_snapshot()
        await emit("snapshot.ok", **info.get("current", {}))
    except Exception as exc:
        log.exception(f"snapshot failed: {exc}")
        await emit("snapshot.failed", error=str(exc))
    cleanup_pre_migration_if_old()


def install_snapshot_job(scheduler) -> None:
    """Wire the snapshot job into the given APScheduler instance.

    Uses the interval from storage_config.json. When the interval changes via
    the API, the job is re-scheduled (see set_snapshot_interval).
    """
    cfg = load_config()
    if scheduler.get_job("storage_snapshot"):
        scheduler.remove_job("storage_snapshot")
    scheduler.add_job(
        snapshot_job,
        trigger="interval",
        seconds=cfg.snapshot_interval_secs,
        id="storage_snapshot",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )


def set_snapshot_interval(scheduler, secs: int) -> None:
    if secs not in ALLOWED_SNAPSHOT_INTERVALS:
        raise ValueError(f"interval must be one of {ALLOWED_SNAPSHOT_INTERVALS}")
    cfg = load_config()
    cfg.snapshot_interval_secs = secs
    save_config(cfg)
    install_snapshot_job(scheduler)
