from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Network(Base):
    __tablename__ = "networks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    vlan_id = Column(Integer, nullable=True, index=True)
    cidr = Column(String, nullable=True)          # e.g. "10.10.20.0/24"
    gateway = Column(String, nullable=True)        # e.g. "10.10.20.1"
    dhcp_range_start = Column(String, nullable=True)
    dhcp_range_end = Column(String, nullable=True)
    dns_auto = Column(Boolean, nullable=False, default=False, server_default=text('0'))
    dns_primary = Column(String, nullable=True)
    dns_secondary = Column(String, nullable=True)
    dns_extra = Column(JSON, nullable=True)          # list[str] — any servers beyond primary/secondary
    purpose = Column(String, nullable=True)        # e.g. "Trusted user devices"
    ssids = Column(JSON, nullable=True)            # ["HomeNet-20", "HomeNet-20-5G"]
    color = Column(String, nullable=False, default="#6366f1")  # hex colour
    icon = Column(String, nullable=True)           # e.g. "shield", "wifi"
    inter_vlan_rules = Column(JSON, nullable=True) # [{to_vlan: 1, allow: false}, ...]
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    nics = relationship("Nic", back_populates="network", lazy="dynamic")
