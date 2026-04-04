from sqlalchemy import Column, Integer, ForeignKey, DateTime, Text, Enum as SAEnum
from sqlalchemy.sql import func
import enum
from database import Base


class AlertType(str, enum.Enum):
    device_offline = "device_offline"
    device_recovered = "device_recovered"
    ip_conflict = "ip_conflict"
    deployment_due = "deployment_due"
    unknown_device = "unknown_device"


class AlertSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    alert_type = Column(SAEnum(AlertType), nullable=False, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True, index=True)
    message = Column(Text, nullable=False)
    severity = Column(SAEnum(AlertSeverity), nullable=False, default=AlertSeverity.warning)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
