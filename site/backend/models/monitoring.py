from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class PingStatus(str, enum.Enum):
    up = "up"
    down = "down"
    timeout = "timeout"


class MonitoringResult(Base):
    __tablename__ = "monitoring_results"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    ip_pinged = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    status = Column(SAEnum(PingStatus), nullable=False)
    latency_ms = Column(Float, nullable=True)

    device = relationship("Device", back_populates="monitoring_results")
