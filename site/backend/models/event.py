from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Enum as SAEnum
from sqlalchemy.sql import func
import enum
from database import Base


class EventSeverity(str, enum.Enum):
    system = "system"
    info = "info"
    warning = "warning"
    critical = "critical"


class EventCategory(str, enum.Enum):
    device = "device"
    network = "network"
    monitoring = "monitoring"
    conflict = "conflict"
    security = "security"
    system = "system"


class EventType(str, enum.Enum):
    # Device
    device_created = "device_created"
    device_updated = "device_updated"
    device_deleted = "device_deleted"
    device_deployed = "device_deployed"
    device_imported = "device_imported"
    # Network
    network_created = "network_created"
    network_updated = "network_updated"
    network_deleted = "network_deleted"
    # Monitoring
    device_offline = "device_offline"
    device_recovered = "device_recovered"
    wan_offline = "wan_offline"
    wan_recovered = "wan_recovered"
    # Conflict
    ip_conflict = "ip_conflict"
    ip_conflict_resolved = "ip_conflict_resolved"
    ip_out_of_subnet = "ip_out_of_subnet"
    mac_conflict = "mac_conflict"
    mac_conflict_resolved = "mac_conflict_resolved"
    mac_conflict_suppressed = "mac_conflict_suppressed"
    # Security
    user_login = "user_login"
    user_login_failed = "user_login_failed"
    user_created = "user_created"
    user_deleted = "user_deleted"
    # System
    system_startup = "system_startup"
    backup_created = "backup_created"
    backup_restored = "backup_restored"


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    severity = Column(SAEnum(EventSeverity), nullable=False, index=True)
    category = Column(SAEnum(EventCategory), nullable=False, index=True)
    event_type = Column(SAEnum(EventType), nullable=False, index=True)

    # Entity reference (optional — system events may have none)
    entity_type = Column(String(50), nullable=True, index=True)
    entity_id = Column(Integer, nullable=True, index=True)
    entity_name = Column(String(255), nullable=True)

    message = Column(Text, nullable=False)
    detail = Column(JSON, nullable=True)  # structured data: old/new values, IPs, MACs etc.

    # Who triggered it (null = system-generated)
    username = Column(String(100), nullable=True)
    user_id = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Lifecycle for warning/critical events
    # None = still active; set = auto-resolved or acknowledged
    resolved_at = Column(DateTime(timezone=True), nullable=True, index=True)
    resolved_by = Column(String(100), nullable=True)  # username or "system"
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(Integer, nullable=True)  # user_id
