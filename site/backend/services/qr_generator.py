"""
QR code generation — MyNet device link QR and service URL QR.
Label output sized for Brother P950NW 24mm tape.
"""
import io
from typing import Optional
from PIL import Image, ImageDraw, ImageFont
import qrcode
from config import settings


def _make_qr(url: str, box_size: int = 8, border: int = 2) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").get_image()


def generate_mynet_qr_png(device_id: int) -> bytes:
    """QR linking to the MyNet device detail page."""
    url = f"{settings.app_url}/devices/{device_id}"
    img = _make_qr(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_service_qr_png(service_url: str) -> bytes:
    """QR linking directly to the device's own web service."""
    img = _make_qr(service_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


_LABEL_SIZE     = 400
_LABEL_PADDING  = 20
_FONT_SIZE      = 28
_LINE_HEIGHT    = 38   # font_size + leading
_MAX_LINES      = 2
_TEXT_AREA      = _LINE_HEIGHT * _MAX_LINES   # always reserved — keeps QR position fixed
_QR_Y           = _LABEL_PADDING + _TEXT_AREA + 10
_QR_SIZE        = _LABEL_SIZE - _QR_Y - _LABEL_PADDING
_MAX_TEXT_W     = _LABEL_SIZE - 2 * _LABEL_PADDING
_FONT_PATH      = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _load_font() -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(_FONT_PATH, _FONT_SIZE)
    except OSError:
        return ImageFont.load_default()


def _wrap_name(name: str, font, probe) -> list[str]:
    """Word-wrap name into up to _MAX_LINES lines. Truncates overflow with …"""
    words = name.split()
    lines: list[str] = []
    current = ""

    for word in words:
        candidate = (current + " " + word).strip()
        if probe.textbbox((0, 0), candidate, font=font)[2] <= _MAX_TEXT_W:
            current = candidate
        else:
            if current:
                lines.append(current)
            if len(lines) >= _MAX_LINES:
                break
            current = word

    if current and len(lines) < _MAX_LINES:
        lines.append(current)

    # Truncate last line with ellipsis if it still overflows
    if lines:
        last = lines[-1]
        if probe.textbbox((0, 0), last, font=font)[2] > _MAX_TEXT_W:
            while last and probe.textbbox((0, 0), last + "…", font=font)[2] > _MAX_TEXT_W:
                last = last[:-1]
            lines[-1] = last + "…"

    return lines


def _make_label(url: str, name: str) -> bytes:
    """
    Fixed-size label (400×400): font and QR dimensions are always identical.
    Name is word-wrapped into up to 2 lines and centred in a fixed text area above the QR.
    """
    font = _load_font()
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lines = _wrap_name(name, font, probe)

    label = Image.new("RGB", (_LABEL_SIZE, _LABEL_SIZE), "white")
    draw = ImageDraw.Draw(label)

    # Text block vertically centred within the fixed text area
    total_text_h = len(lines) * _LINE_HEIGHT
    text_start_y = _LABEL_PADDING + (_TEXT_AREA - total_text_h) // 2
    for i, line in enumerate(lines):
        text_w = draw.textbbox((0, 0), line, font=font)[2]
        draw.text(((_LABEL_SIZE - text_w) // 2, text_start_y + i * _LINE_HEIGHT), line, fill="black", font=font)

    # QR always at the same fixed position
    qr_img = _make_qr(url, box_size=10, border=2).resize((_QR_SIZE, _QR_SIZE), Image.LANCZOS)
    label.paste(qr_img, ((_LABEL_SIZE - _QR_SIZE) // 2, _QR_Y))

    buf = io.BytesIO()
    label.save(buf, format="PNG", dpi=(300, 300))
    return buf.getvalue()


def generate_url_label_png(url: str, name: str) -> bytes:
    return _make_label(url, name)


def generate_label_png(
    device_id: int,
    device_name: str,
    ip_address: Optional[str] = None,  # kept for call-site compat, not used
) -> bytes:
    url = f"{settings.app_url}/devices/{device_id}"
    return _make_label(url, device_name)
