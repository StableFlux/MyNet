from sqlalchemy import Column, Integer, String, JSON, DateTime, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class DeviceType(Base):
    __tablename__ = "device_types"

    __table_args__ = (UniqueConstraint('name', 'category', name='uq_device_type_name_category'),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                   # sub-type: "Windows PC", "Energy Monitor", etc.
    category = Column(String, nullable=True)                # grouping: "User Devices", "IoT", etc.
    icon = Column(String, nullable=True)
    color = Column(String, nullable=False, default="#64748b")

    # JSON schema describing which field groups are visible for this device type.
    # Example: {"show_cpu": true, "show_gpu": true, "show_os": true,
    #           "show_ssh": true, "show_vm_host": false, "show_printer_fields": false}
    fields_schema = Column(JSON, nullable=False, default={})

    is_system = Column(Boolean, default=False)          # true = seeded, not deletable
    is_infrastructure = Column(Boolean, default=False)  # true = switch/router/AP/firewall
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    devices = relationship("Device", back_populates="device_type", lazy="dynamic")
