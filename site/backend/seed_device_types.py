"""
Seeds the DeviceType table with the standard set of types.
Run once on first startup (called from main.py lifespan).
"""
from sqlalchemy.orm import Session
from models.device_type import DeviceType

# Compact field-schema helpers
def _compute(wol=True):
    return {"show_cpu": True, "show_ram": True, "show_gpu": True, "show_os": True,
            "show_hostname": True, "show_credentials": True, "show_ssh": True,
            "show_url": True, "show_wol": wol}

def _server():
    return {"show_cpu": True, "show_ram": True, "show_gpu": False, "show_os": True,
            "show_hostname": True, "show_credentials": True, "show_ssh": True,
            "show_url": True, "show_wol": True}

def _mobile():
    return {"show_cpu": True, "show_ram": True, "show_gpu": False, "show_os": True,
            "show_hostname": True, "show_credentials": False, "show_ssh": False,
            "show_url": False, "show_wol": False}

def _network(infra=False):
    return {"show_cpu": False, "show_ram": False, "show_gpu": False, "show_os": False,
            "show_hostname": True, "show_credentials": True, "show_ssh": True,
            "show_url": True, "show_wol": False, "show_network_fields": True}

def _net_simple():
    return {"show_cpu": False, "show_ram": False, "show_gpu": False, "show_os": False,
            "show_hostname": True, "show_credentials": True, "show_ssh": False,
            "show_url": True, "show_wol": False}

def _iot():
    return {"show_cpu": False, "show_ram": False, "show_gpu": False, "show_os": False,
            "show_hostname": True, "show_credentials": False, "show_ssh": False,
            "show_url": False, "show_wol": False, "show_ha": True}

def _iot_web():
    return {"show_cpu": False, "show_ram": False, "show_gpu": False, "show_os": False,
            "show_hostname": True, "show_credentials": True, "show_ssh": False,
            "show_url": True, "show_wol": False, "show_ha": True}

def _minimal():
    return {"show_cpu": False, "show_ram": False, "show_gpu": False, "show_os": False,
            "show_hostname": True, "show_credentials": False, "show_ssh": False,
            "show_url": False, "show_wol": False}

def _minimal_web():
    return {"show_cpu": False, "show_ram": False, "show_gpu": False, "show_os": False,
            "show_hostname": True, "show_credentials": True, "show_ssh": False,
            "show_url": True, "show_wol": False}


DEVICE_TYPES = [
    # ── User Devices ─────────────────────────────────────────────────────────
    {"name": "Windows PC (Desktop)",  "category": "User Devices",  "icon": "monitor",       "color": "#3b82f6", "fields_schema": _compute(wol=True)},
    {"name": "Windows PC (Laptop)",   "category": "User Devices",  "icon": "laptop",        "color": "#3b82f6", "fields_schema": _compute(wol=False)},
    {"name": "Mac (Desktop)",         "category": "User Devices",  "icon": "monitor",       "color": "#a855f7", "fields_schema": _compute(wol=False)},
    {"name": "Mac (Laptop)",          "category": "User Devices",  "icon": "laptop",        "color": "#a855f7", "fields_schema": _compute(wol=False)},
    {"name": "Linux PC (Desktop)",    "category": "User Devices",  "icon": "terminal",      "color": "#f97316", "fields_schema": _compute(wol=True)},
    {"name": "Linux PC (Laptop)",     "category": "User Devices",  "icon": "laptop",        "color": "#f97316", "fields_schema": _compute(wol=False)},
    {"name": "Chromebook",            "category": "User Devices",  "icon": "laptop",        "color": "#34d399", "fields_schema": {**_compute(wol=False), "show_gpu": False}},
    {"name": "Phone",                 "category": "User Devices",  "icon": "smartphone",    "color": "#06b6d4", "fields_schema": _mobile()},
    {"name": "Tablet",                "category": "User Devices",  "icon": "tablet",        "color": "#06b6d4", "fields_schema": _mobile()},
    {"name": "Watch / Wearable",      "category": "User Devices",  "icon": "watch",         "color": "#64748b", "fields_schema": _mobile()},

    # ── Entertainment ─────────────────────────────────────────────────────────
    {"name": "TV",                      "category": "Entertainment", "icon": "tv",            "color": "#06b6d4", "fields_schema": {**_minimal_web(), "show_os": True}},
    {"name": "Games Console",           "category": "Entertainment", "icon": "gamepad-2",     "color": "#ec4899", "fields_schema": {**_minimal_web(), "show_cpu": True, "show_ram": True, "show_gpu": True}},
    {"name": "Projector",               "category": "Entertainment", "icon": "projector",     "color": "#64748b", "fields_schema": _minimal_web()},
    {"name": "Media Player",            "category": "Entertainment", "icon": "play-circle",   "color": "#8b5cf6", "fields_schema": {**_minimal_web(), "show_os": True}},
    {"name": "Streaming Stick / Dongle","category": "Entertainment", "icon": "cast",          "color": "#8b5cf6", "fields_schema": {**_minimal_web(), "show_os": True}},
    {"name": "Set-top Box",             "category": "Entertainment", "icon": "tv-2",          "color": "#64748b", "fields_schema": {**_minimal_web(), "show_os": True}},
    {"name": "eReader",                 "category": "Entertainment", "icon": "book-open",     "color": "#64748b", "fields_schema": {**_minimal(), "show_os": True}},
    {"name": "Hi-Fi / Amplifier",       "category": "Entertainment", "icon": "music",         "color": "#64748b", "fields_schema": _minimal_web()},
    {"name": "Headphones / Audio",      "category": "Entertainment", "icon": "headphones",    "color": "#64748b", "fields_schema": _minimal()},

    # ── Peripherals ───────────────────────────────────────────────────────────
    {"name": "Printer (Document)",  "category": "Peripherals", "icon": "printer",      "color": "#3b82f6", "fields_schema": _minimal_web()},
    {"name": "Printer (Label)",     "category": "Peripherals", "icon": "tag",          "color": "#3b82f6", "fields_schema": _minimal_web()},
    {"name": "Printer (3D)",        "category": "Peripherals", "icon": "layers",       "color": "#3b82f6", "fields_schema": {**_minimal_web(), "show_cpu": True, "show_ram": True, "show_ssh": True, "show_printer_fields": True}},
    {"name": "Scanner",             "category": "Peripherals", "icon": "scan",         "color": "#3b82f6", "fields_schema": _minimal_web()},
    {"name": "Plotter",             "category": "Peripherals", "icon": "pen-tool",     "color": "#3b82f6", "fields_schema": _minimal_web()},
    {"name": "Dock / Hub",          "category": "Peripherals", "icon": "plug",         "color": "#64748b", "fields_schema": _minimal()},
    {"name": "KVM Switch",          "category": "Peripherals", "icon": "monitor",      "color": "#64748b", "fields_schema": _minimal_web()},
    {"name": "Webcam",              "category": "Peripherals", "icon": "camera",       "color": "#64748b", "fields_schema": _minimal_web()},
    {"name": "Drawing Tablet",      "category": "Peripherals", "icon": "pen-tool",     "color": "#64748b", "fields_schema": _minimal()},
    {"name": "External Storage",    "category": "Peripherals", "icon": "hard-drive",   "color": "#64748b", "fields_schema": _minimal()},

    # ── Network ───────────────────────────────────────────────────────────────
    {"name": "Network Switch",          "category": "Network", "icon": "network",          "color": "#0ea5e9", "is_infrastructure": True,  "fields_schema": _network()},
    {"name": "Router / Gateway",        "category": "Network", "icon": "router",           "color": "#0ea5e9", "is_infrastructure": True,  "fields_schema": _network()},
    {"name": "Access Point",            "category": "Network", "icon": "wifi",             "color": "#0ea5e9", "is_infrastructure": False, "fields_schema": _network()},
    {"name": "Access Point - With Switch","category": "Network","icon": "wifi",            "color": "#0ea5e9", "is_infrastructure": True,  "fields_schema": _network()},
    {"name": "Firewall",                "category": "Network", "icon": "shield",           "color": "#0ea5e9", "is_infrastructure": True,  "fields_schema": _network()},
    {"name": "NAS",                     "category": "Network", "icon": "database",         "color": "#0ea5e9", "fields_schema": {**_server(), "show_network_fields": True}},
    {"name": "VPN Appliance",           "category": "Network", "icon": "lock",             "color": "#0ea5e9", "fields_schema": _network()},
    {"name": "Load Balancer",           "category": "Network", "icon": "git-branch",       "color": "#0ea5e9", "fields_schema": _network()},
    {"name": "Proxy / Cache",           "category": "Network", "icon": "filter",           "color": "#0ea5e9", "fields_schema": _net_simple()},
    {"name": "4G / 5G Router",          "category": "Network", "icon": "signal",           "color": "#0ea5e9", "is_infrastructure": True,  "fields_schema": _network()},
    {"name": "Cable / DSL Modem",       "category": "Network", "icon": "router",           "color": "#0ea5e9", "fields_schema": _net_simple()},

    # ── Servers & VMs ─────────────────────────────────────────────────────────
    {"name": "Server (Linux)",           "category": "Servers & VMs", "icon": "server",  "color": "#6366f1", "fields_schema": _server()},
    {"name": "Server (Windows)",         "category": "Servers & VMs", "icon": "server",  "color": "#6366f1", "fields_schema": _server()},
    {"name": "Server (Mac)",             "category": "Servers & VMs", "icon": "server",  "color": "#6366f1", "fields_schema": {**_server(), "show_wol": False}},
    {"name": "Virtual Machine (Linux)",  "category": "Servers & VMs", "icon": "box",     "color": "#6366f1", "fields_schema": {**_server(), "show_wol": False, "show_vm_host": True}},
    {"name": "Virtual Machine (Windows)","category": "Servers & VMs", "icon": "box",     "color": "#6366f1", "fields_schema": {**_server(), "show_wol": False, "show_vm_host": True}},
    {"name": "Virtual Machine (Mac)",    "category": "Servers & VMs", "icon": "box",     "color": "#6366f1", "fields_schema": {**_server(), "show_wol": False, "show_vm_host": True}},
    {"name": "Container Host",           "category": "Servers & VMs", "icon": "layers",  "color": "#6366f1", "fields_schema": _server()},
    {"name": "Media Server",             "category": "Servers & VMs", "icon": "film",    "color": "#6366f1", "fields_schema": _server()},

    # ── Security ─────────────────────────────────────────────────────────────
    {"name": "IP Camera",       "category": "Security", "icon": "camera",       "color": "#ef4444", "fields_schema": {**_minimal_web(), "show_credentials": True, "show_ha": True}},
    {"name": "PTZ Camera",      "category": "Security", "icon": "camera",       "color": "#ef4444", "fields_schema": {**_minimal_web(), "show_credentials": True, "show_ha": True}},
    {"name": "NVR",             "category": "Security", "icon": "hard-drive",   "color": "#ef4444", "fields_schema": {**_server(), "show_gpu": False}},
    {"name": "DVR",             "category": "Security", "icon": "hard-drive",   "color": "#ef4444", "fields_schema": {**_server(), "show_gpu": False}},
    {"name": "Video Doorbell",  "category": "Security", "icon": "bell",         "color": "#ef4444", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Smart Lock",      "category": "Security", "icon": "lock",         "color": "#ef4444", "fields_schema": {**_minimal(), "show_ha": True}},
    {"name": "Alarm Panel",     "category": "Security", "icon": "shield-alert", "color": "#ef4444", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Access Control",  "category": "Security", "icon": "scan-line",    "color": "#ef4444", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Intercom",        "category": "Security", "icon": "phone-call",   "color": "#ef4444", "fields_schema": _minimal_web()},
    {"name": "Motion Sensor",   "category": "Security", "icon": "activity",     "color": "#ef4444", "fields_schema": {**_minimal(), "show_ha": True}},

    # ── IoT ──────────────────────────────────────────────────────────────────
    {"name": "Camera",                "category": "IoT", "icon": "camera",        "color": "#f59e0b", "fields_schema": _iot_web()},
    {"name": "Display",               "category": "IoT", "icon": "monitor",       "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Doorbell",              "category": "IoT", "icon": "bell",          "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Energy Monitor",        "category": "IoT", "icon": "zap",           "color": "#f59e0b", "fields_schema": _iot_web()},
    {"name": "Heating / Thermostat",  "category": "IoT", "icon": "thermometer",   "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Hub / Bridge",          "category": "IoT", "icon": "radio",         "color": "#f59e0b", "fields_schema": _iot_web()},
    {"name": "Light",                 "category": "IoT", "icon": "lightbulb",     "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Lock",                  "category": "IoT", "icon": "lock",          "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Sensor",                "category": "IoT", "icon": "activity",      "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Smart Speaker",         "category": "IoT", "icon": "volume-2",      "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Switch / Plug",         "category": "IoT", "icon": "toggle-right",  "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Vacuum / Robot",        "category": "IoT", "icon": "loader",        "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Air Purifier",          "category": "IoT", "icon": "wind",          "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Blinds / Curtains",     "category": "IoT", "icon": "layout",        "color": "#f59e0b", "fields_schema": _iot()},
    {"name": "Smart Appliance",       "category": "IoT", "icon": "cpu",           "color": "#f59e0b", "fields_schema": _iot_web()},
    {"name": "Irrigation Controller", "category": "IoT", "icon": "droplets",      "color": "#f59e0b", "fields_schema": _iot_web()},

    # ── Power ─────────────────────────────────────────────────────────────────
    {"name": "UPS",                  "category": "Power", "icon": "battery-charging", "color": "#fbbf24", "fields_schema": _minimal_web()},
    {"name": "PDU",                  "category": "Power", "icon": "power-square",     "color": "#fbbf24", "fields_schema": _minimal_web()},
    {"name": "Power Strip",          "category": "Power", "icon": "plug",             "color": "#fbbf24", "fields_schema": _minimal()},
    {"name": "USB Charger",          "category": "Power", "icon": "plug-zap",         "color": "#fbbf24", "fields_schema": _minimal()},
    {"name": "Wall Adapter",         "category": "Power", "icon": "plug-zap",         "color": "#fbbf24", "fields_schema": _minimal()},
    {"name": "PoE Injector",         "category": "Power", "icon": "zap",              "color": "#fbbf24", "fields_schema": _minimal()},
    {"name": "EV Charger",           "category": "Power", "icon": "car",              "color": "#fbbf24", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Solar Inverter",       "category": "Power", "icon": "sun",              "color": "#fbbf24", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Battery Storage",      "category": "Power", "icon": "battery",          "color": "#fbbf24", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Smart Meter",          "category": "Power", "icon": "gauge",            "color": "#fbbf24", "fields_schema": {**_minimal_web(), "show_ha": True}},
    {"name": "Generator",            "category": "Power", "icon": "zap-off",          "color": "#fbbf24", "fields_schema": _minimal()},
    {"name": "Other (Power)",        "category": "Power", "icon": "power",            "color": "#fbbf24", "fields_schema": _minimal()},

    # ── Maker & Projects ──────────────────────────────────────────────────────
    {"name": "SBC (Raspberry Pi)", "category": "Maker & Projects", "icon": "circuit-board", "color": "#ef4444", "fields_schema": {**_server(), "show_gpu": False}},
    {"name": "SBC (Other)",        "category": "Maker & Projects", "icon": "circuit-board", "color": "#ef4444", "fields_schema": {**_server(), "show_gpu": False}},
    {"name": "Microcontroller",    "category": "Maker & Projects", "icon": "cpu",           "color": "#10b981", "fields_schema": {**_minimal_web(), "show_ssh": True}},
    {"name": "FPGA",               "category": "Maker & Projects", "icon": "cpu",           "color": "#10b981", "fields_schema": {**_minimal_web(), "show_credentials": True}},
    {"name": "Development Board",  "category": "Maker & Projects", "icon": "circuit-board", "color": "#10b981", "fields_schema": _minimal_web()},
    {"name": "Other (Maker)",      "category": "Maker & Projects", "icon": "wrench",        "color": "#10b981", "fields_schema": _minimal_web()},

    # ── Other ─────────────────────────────────────────────────────────────────
    {"name": "Other",              "category": "Other",            "icon": "package",       "color": "#64748b", "fields_schema": _minimal()},

]


def seed_device_types(db: Session):
    # ── 1. Category + name moves for existing system types ───────────────────
    # Format: (current_name, current_category, new_name, new_category)
    # Use None for current_category to match null.
    migrations = [
        # Moves to Entertainment
        ("TV",                "User Devices", "TV",                "Entertainment"),
        ("Games Console",     "User Devices", "Games Console",     "Entertainment"),
        ("Projector",         "User Devices", "Projector",         "Entertainment"),
        ("eReader",           "User Devices", "eReader",           "Entertainment"),
        ("Headphones / Audio","User Devices", "Headphones / Audio","Entertainment"),
        ("Media Player",      "IoT",          "Media Player",      "Entertainment"),
        # Moves to Peripherals
        ("Printer (Document)","User Devices", "Printer (Document)","Peripherals"),
        ("Printer (Label)",   "User Devices", "Printer (Label)",   "Peripherals"),
        ("Printer (3D)",      "User Devices", "Printer (3D)",      "Peripherals"),
        ("Scanner",           "User Devices", "Scanner",           "Peripherals"),
        ("Plotter",           "User Devices", "Plotter",           "Peripherals"),
        ("Dock / Peripheral", "User Devices", "Dock / Hub",        "Peripherals"),
        ("KVM Switch",        "Network",      "KVM Switch",        "Peripherals"),
        # Moves to Power
        ("UPS",               "Network",      "UPS",               "Power"),
        ("PDU",               "Network",      "PDU",               "Power"),
        # Moves to Servers & VMs
        ("Media Server",      "Network",      "Media Server",      "Servers & VMs"),
        # Renames within same category
        ("Watch",             "User Devices", "Watch / Wearable",  "User Devices"),
        ("Heating",           "IoT",          "Heating / Thermostat","IoT"),
    ]
    for old_name, old_cat, new_name, new_cat in migrations:
        dt = db.query(DeviceType).filter_by(name=old_name, category=old_cat).first()
        if dt:
            dt.name = new_name
            dt.category = new_cat
    db.commit()

    # ── 2. Seed any types not yet in the DB ──────────────────────────────────
    existing = {(dt.name, dt.category) for dt in db.query(DeviceType).all()}
    for dt_data in DEVICE_TYPES:
        key = (dt_data["name"], dt_data.get("category"))
        if key not in existing:
            fields = {k: v for k, v in dt_data.items() if k != "is_infrastructure"}
            dt = DeviceType(**fields, is_system=True)
            if dt_data.get("is_infrastructure"):
                dt.is_infrastructure = True
            db.add(dt)
    db.commit()

    # ── 3. Ensure is_infrastructure is correct on all infra types ────────────
    infra_names = {"Network Switch", "Router / Gateway", "Access Point - With Switch",
                   "Firewall", "4G / 5G Router"}
    for dt in db.query(DeviceType).all():
        should_be = dt.name in infra_names
        if dt.is_infrastructure != should_be:
            dt.is_infrastructure = should_be
    db.commit()

    # ── 4. Legacy name replacements (same-category renames from older schema) ─
    from models.device import Device
    replacements = [
        ("Windows PC",      "User Devices",  "Windows PC (Desktop)"),
        ("Mac",             "User Devices",  "Mac (Desktop)"),
        ("Linux PC",        "User Devices",  "Linux PC (Desktop)"),
        ("Laptop",          "User Devices",  "Windows PC (Laptop)"),
        ("Server",          "Servers & VMs", "Server (Linux)"),
        ("Virtual Machine", "Servers & VMs", "Virtual Machine (Linux)"),
    ]
    for old_name, category, new_name in replacements:
        old_type = db.query(DeviceType).filter_by(name=old_name, category=category).first()
        if not old_type:
            continue
        new_type = db.query(DeviceType).filter_by(name=new_name, category=category).first()
        if new_type:
            db.query(Device).filter(Device.device_type_id == old_type.id).update(
                {"device_type_id": new_type.id}, synchronize_session=False
            )
            db.delete(old_type)
    db.commit()
