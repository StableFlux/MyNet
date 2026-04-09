from sqlalchemy import Column, Integer, String, Boolean, JSON
from database import Base


# Default colours — used when no custom value is stored in the DB.
DEFAULT_LOCATION_TYPE_COLORS: dict[str, str] = {
    'Room':      '#a5b4fc',
    'Area':      '#6ee7b7',
    'Premises':  '#c4b5fd',
    'Building':  '#7dd3fc',
    'Draw':      '#fcd34d',
    'Container': '#fdba74',
    'Storage':   '#cbd5e1',
    'Shelf':     '#67e8f9',
    'Rack':      '#fda4af',
}

DEFAULT_DEVICE_CATEGORY_COLORS: dict[str, str] = {
    'IoT':              '#f97316',  # orange — cautionary, consumer firmware
    'Security':         '#fb7185',  # rose        — risk group
    'Power':            '#eab308',  # yellow      — risk group
    'Network':          '#38bdf8',  # sky         — infrastructure group
    'Servers & VMs':    '#3b82f6',  # blue        — infrastructure group
    'User Devices':     '#22c55e',  # green       — personal tech group
    'Entertainment':    '#16a34a',  # dark green  — personal tech group
    'Peripherals':      '#a78bfa',  # violet      — personal tech group
    'Maker & Projects': '#4ade80',  # lime        — personal tech group
}

DEFAULT_DEVICE_STATUS_COLORS: dict[str, str] = {
    'in_service':     '#10b981',  # green   — active
    'stock':          '#6366f1',  # indigo  — in inventory, ready
    'undeployed':     '#fcd34d',  # yellow  — ready, staged
    'decommissioned': '#6b7280',  # gray    — retired
}


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    system_name = Column(String, nullable=False, default="MyNet")
    auth_required = Column(Boolean, nullable=False, default=True)
    encryption_enabled = Column(Boolean, nullable=False, default=False)
    encryption_salt = Column(String, nullable=True)          # base64-encoded random salt
    encryption_verification = Column(String, nullable=True)  # Fernet token — proves passphrase is correct

    # Pi-hole integration
    pihole_poll_interval_secs = Column(Integer, nullable=False, default=300)
    dns_domain = Column(String, nullable=True)  # e.g. "home.arpa" — applied as suffix to DNS entries

    # Colour settings — stored as {name: hex} dicts; NULL means use defaults
    location_type_colors = Column(JSON, nullable=True)
    device_category_colors = Column(JSON, nullable=True)
    device_status_colors = Column(JSON, nullable=True)
    wan_port_color = Column(String, nullable=True)  # hex — applied to all WAN ports
    mynet_url = Column(String, nullable=True)        # base URL for printable label QR codes

    # UniFi integration
    unifi_host = Column(String, nullable=True)           # IP or hostname, e.g. 10.10.10.1
    unifi_auth_type = Column(String, nullable=False, default="api_key")  # "api_key" | "credentials"
    unifi_api_key = Column(String, nullable=True)        # encrypted; requires Network App >= 8.1
    unifi_username = Column(String, nullable=True)       # for credentials auth
    unifi_password = Column(String, nullable=True)       # encrypted; for credentials auth
    unifi_write_enabled = Column(Boolean, nullable=False, default=False)  # when False, integration is read-only
    # https:// is always used; SSL verification is always disabled (local self-signed cert)
