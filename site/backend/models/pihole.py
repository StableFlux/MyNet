from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON, Boolean
from sqlalchemy.orm import relationship
from database import Base


class PiHoleCache(Base):
    __tablename__ = "pihole_cache"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, unique=True, index=True)
    mac = Column(String, nullable=True)
    queries_today = Column(Integer, default=0)
    blocked_today = Column(Integer, default=0)
    domains_on_blocklist = Column(Integer, nullable=True)
    top_blocked = Column(JSON, nullable=True)   # [{domain, count}] for Pi-hole devices
    reachable = Column(Boolean, nullable=True)  # None = never polled, True = ok, False = error
    last_error = Column(String, nullable=True)  # human-readable reason for last failure, cleared on success
    blocking_enabled = Column(Boolean, nullable=True)  # Pi-hole blocking on/off, None if unknown
    version = Column(String, nullable=True)  # Pi-hole core version string e.g. "v6.4"
    last_seen = Column(DateTime(timezone=True), nullable=True)
    last_polled = Column(DateTime(timezone=True), nullable=True)

    device = relationship("Device", back_populates="pihole_cache")
