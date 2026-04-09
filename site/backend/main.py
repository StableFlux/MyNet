"""
MyNet — FastAPI application entry point.
"""
import json
import logging
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database import engine
from models import *  # noqa: F401, F403 — imports all models so Base knows about them
from database import Base, SessionLocal
from seed_device_types import seed_device_types
from services.monitoring_scheduler import scheduler, load_all_monitored_devices, set_broadcast_fn
from services.pihole_client import update_pihole_cache
from config import settings

import routers.auth as auth_router
import routers.networks as networks_router
import routers.devices as devices_router
import routers.device_types as device_types_router
import routers.search as search_router
import routers.topology as topology_router
import routers.monitoring as monitoring_router
import routers.qr as qr_router
import routers.events as events_router
import routers.backup as backup_router
import routers.switch_ports as switch_ports_router
import routers.locations as locations_router
import routers.system_settings as system_settings_router
import routers.dashboard as dashboard_router
import routers.pihole as pihole_router
import routers.wan_configs as wan_configs_router
import routers.scan as scan_router
import routers.unifi as unifi_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self._active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._active.add(ws)

    def disconnect(self, ws: WebSocket):
        self._active.discard(ws)

    async def broadcast(self, data: dict):
        if not self._active:
            return
        message = json.dumps(data)
        dead = set()
        for ws in self._active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        self._active -= dead


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Guard: if JWT_SECRET_KEY is not set, generate one and persist it to .env so it
    # survives restarts. An ephemeral key would invalidate all sessions on every restart.
    if not settings.jwt_secret_key:
        import secrets
        from pathlib import Path
        generated = secrets.token_hex(32)
        settings.jwt_secret_key = generated
        env_path = Path(__file__).parent / ".env"
        try:
            existing = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
            if "JWT_SECRET_KEY" not in existing:
                with env_path.open("a", encoding="utf-8") as f:
                    f.write(f"\nJWT_SECRET_KEY={generated}\n")
                log.info("JWT_SECRET_KEY generated and saved to .env — sessions will persist across restarts.")
            else:
                log.warning("JWT_SECRET_KEY is blank in .env — using an ephemeral key for this session.")
        except OSError as e:
            log.warning(f"Could not persist JWT_SECRET_KEY to .env ({e}) — sessions will be lost on restart.")

    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Safe schema migrations — idempotent, runs on every startup
    from migrations.apply import apply_migrations
    apply_migrations(engine)

    # Seed device types
    db = SessionLocal()
    try:
        seed_device_types(db)
    finally:
        db.close()

    # One-time migration: if FERNET_KEY env var is present, decrypt all passwords
    # using the old key and store as plaintext, then drop the key from config.
    import os
    from services.encryption import migrate_from_old_key, load_state_from_db
    old_key = os.environ.get("FERNET_KEY", "")
    if old_key:
        db = SessionLocal()
        try:
            migrate_from_old_key(old_key, db)
            log.info("FERNET_KEY detected — migration complete. Remove FERNET_KEY from .env.")
        finally:
            db.close()

    # Load encryption state from DB into memory
    db = SessionLocal()
    try:
        load_state_from_db(db)
    finally:
        db.close()

    # One-time cleanup: remap any stale monitor_nic_ids to current NIC IDs
    # and initialise monitor_nic_ids for monitoring-enabled devices that have None
    db = SessionLocal()
    try:
        from models.device import Device
        from models.nic import Nic
        all_nic_ids = {n.id for n in db.query(Nic).all()}
        # Fix stale IDs
        for device in db.query(Device).filter(Device.monitor_nic_ids != None).all():
            if any(i not in all_nic_ids for i in (device.monitor_nic_ids or [])):
                current_ids = [n.id for n in device.nics]
                device.monitor_nic_ids = current_ids if current_ids else None
        # Initialise null monitor_nic_ids for monitoring-enabled devices (prefer ETH NICs)
        for device in db.query(Device).filter(Device.monitoring_enabled == True, Device.monitor_nic_ids == None).all():
            eth_ids = [n.id for n in device.nics if n.nic_type and n.nic_type.value.upper() == 'ETH']
            device.monitor_nic_ids = eth_ids if eth_ids else [n.id for n in device.nics] or None
        db.commit()
    finally:
        db.close()

    # Wire up WebSocket broadcast to monitoring scheduler
    set_broadcast_fn(manager.broadcast)

    # Log startup event
    from services.events import log_event
    from models.event import EventType
    _se_db = SessionLocal()
    try:
        log_event(_se_db, EventType.system_startup, "MyNet started",
                  detail={"version": "1.0.0"})
        _se_db.commit()
    except Exception as _e:
        log.warning(f"Startup event log failed: {_e}")
    finally:
        _se_db.close()

    # Startup conflict scan
    from services.conflict_checker import run_conflict_scan
    _cs_db = SessionLocal()
    try:
        run_conflict_scan(_cs_db)
    except Exception as _e:
        log.warning(f"Startup conflict scan failed: {_e}")
    finally:
        _cs_db.close()

    # Start background scheduler
    load_all_monitored_devices()

    # Schedule PiHole polling — interval read from DB so Settings UI changes take effect on restart
    async def _poll_pihole():
        db = SessionLocal()
        try:
            await update_pihole_cache(db)
        finally:
            db.close()

    from apscheduler.triggers.interval import IntervalTrigger
    from models.system_settings import SystemSettings
    _ss_db = SessionLocal()
    try:
        _ss = _ss_db.query(SystemSettings).first()
        _pihole_interval = (_ss.pihole_poll_interval_secs if _ss and _ss.pihole_poll_interval_secs else None) or settings.pihole_poll_interval_secs
    finally:
        _ss_db.close()
    scheduler.add_job(
        _poll_pihole,
        trigger=IntervalTrigger(seconds=_pihole_interval),
        id="pihole_poll",
        replace_existing=True,
        misfire_grace_time=60,
    )

    # Schedule conflict scan every 10 minutes
    async def _run_conflict_scan():
        from services.conflict_checker import run_conflict_scan
        _db = SessionLocal()
        try:
            run_conflict_scan(_db)
        except Exception as _e:
            log.warning(f"Periodic conflict scan failed: {_e}")
        finally:
            _db.close()

    scheduler.add_job(
        _run_conflict_scan,
        trigger=IntervalTrigger(minutes=10),
        id="conflict_scan",
        replace_existing=True,
        misfire_grace_time=60,
    )

    scheduler.start()
    log.info("MyNet started — monitoring + PiHole scheduler running")

    yield

    scheduler.shutdown(wait=False)
    log.info("MyNet shutdown")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MyNet",
    description="Home network device management",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: use explicit origins from env if provided, otherwise allow all private-network ranges.
# The regex fallback is intentionally permissive for self-hosted LAN use — set CORS_ORIGINS
# in .env to restrict to specific origins for internet-facing deployments.
if settings.cors_origins:
    _cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
def health_check():
    """Liveness probe — returns 200 if the application is running."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Global exception handler — prevents internal error details leaking to clients
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please check the server logs."},
    )


# Include routers
app.include_router(auth_router.router)
app.include_router(networks_router.router)
app.include_router(devices_router.router)
app.include_router(device_types_router.router)
app.include_router(search_router.router)
app.include_router(topology_router.router)
app.include_router(monitoring_router.router)
app.include_router(qr_router.router)
app.include_router(events_router.router)
app.include_router(backup_router.router)
app.include_router(switch_ports_router.router)
app.include_router(locations_router.router)
app.include_router(system_settings_router.router, prefix="/api")
app.include_router(dashboard_router.router)
app.include_router(pihole_router.router)
app.include_router(wan_configs_router.router)
app.include_router(scan_router.router)
app.include_router(unifi_router.router)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Authenticate before accepting — reject unauthenticated connections.
    # Token passed as query param ?token=<jwt> since WebSocket upgrade headers
    # don't support cookies reliably across all browsers/reverse proxies.
    from services.auth import _decode_token
    from models.system_settings import SystemSettings
    from models.user import User, UserRole

    db = SessionLocal()
    try:
        # Check if auth is disabled
        sys_settings = db.query(SystemSettings).first()
        auth_disabled = sys_settings and not sys_settings.auth_required

        if not auth_disabled:
            token = websocket.query_params.get("token") or websocket.cookies.get("access_token")
            if not token:
                await websocket.close(code=4401)
                return
            payload = _decode_token(token)
            if not payload:
                await websocket.close(code=4401)
                return
            user = db.get(User, int(payload["sub"]))
            if not user or not user.is_active:
                await websocket.close(code=4401)
                return
    finally:
        db.close()

    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; client can also send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------


