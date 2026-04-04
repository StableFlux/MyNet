import io
import zipfile
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
from models.device import Device
from models.user import User
from services.auth import require_viewer
from services.qr_generator import (
    generate_mynet_qr_png,
    generate_service_qr_png,
    generate_label_png,
    generate_url_label_png,
)

router = APIRouter(prefix="/api/qr", tags=["qr"])


@router.get("/devices/{device_id}/mynet")
def mynet_qr(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    png = generate_mynet_qr_png(device_id)
    return Response(content=png, media_type="image/png")


@router.get("/devices/{device_id}/service")
def service_qr(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    device = db.get(Device, device_id)
    if not device or not device.url:
        raise HTTPException(404, "Device has no service URL")
    png = generate_service_qr_png(device.url)
    return Response(content=png, media_type="image/png")


@router.get("/devices/{device_id}/label")
def label_qr(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    primary_ip = next(
        (n.ip_address for n in device.nics if n.ip_address and n.ip_address != "DHCP"),
        None,
    )
    png = generate_label_png(device_id, device.name, primary_ip)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="label_{device.name.replace(" ", "_")}.png"'},
    )


@router.get("/label")
def url_label(
    url: str = Query(...),
    name: str = Query(...),
    _: User = Depends(require_viewer),
):
    """Generate a label PNG for any URL + name (used for service QR labels)."""
    png = generate_url_label_png(url, name)
    safe = name.replace("/", "_").replace(" ", "_")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="label_{safe}.png"'},
    )


@router.post("/devices/batch-labels")
def batch_labels(
    device_ids: list[int],
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """Returns a ZIP archive of label PNGs for multiple devices."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for did in device_ids:
            device = db.get(Device, did)
            if not device:
                continue
            primary_ip = next(
                (n.ip_address for n in device.nics if n.ip_address and n.ip_address != "DHCP"),
                None,
            )
            png = generate_label_png(did, device.name, primary_ip)
            safe_name = device.name.replace("/", "_").replace(" ", "_")
            zf.writestr(f"label_{did}_{safe_name}.png", png)

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="mynet_labels.zip"'},
    )
