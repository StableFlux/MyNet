"""
Network scan router — GET /api/scan
Admin-only: triggers a live ping sweep of all defined subnets.
"""
from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from services.auth import require_admin
from services.network_scanner import scan_networks

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.get("")
async def run_network_scan(
    network_ids: List[int] = Query(default=[]),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Ping-sweep networks with a defined CIDR.
    Pass network_ids to limit the scan to specific networks; omit to scan all.
    Returns discovered hosts with known/unknown status.
    Does NOT modify the database.
    """
    results = await scan_networks(db, network_ids=network_ids or None)
    return {"hosts": results, "total": len(results), "unknown": sum(1 for h in results if not h["known"])}
