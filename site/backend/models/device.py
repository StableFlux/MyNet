from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
    ForeignKey, Enum as SAEnum, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class DeviceStatus(str, enum.Enum):
    in_service = "in_service"
    undeployed = "undeployed"
    stock = "stock"
    decommissioned = "decommissioned"


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    use = Column(String, nullable=True)              # short description / label
    device_type_id = Column(Integer, ForeignKey("device_types.id"), nullable=True)

    # Hardware
    hardware_type = Column(String, nullable=True)   # e.g. "SBC", "NUC", "Network Switch", "Camera"
    brand = Column(String, nullable=True)
    model = Column(String, nullable=True)
    cpu = Column(String, nullable=True)
    ram = Column(String, nullable=True)
    gpu = Column(String, nullable=True)

    # Software
    os = Column(String, nullable=True)
    os_version = Column(String, nullable=True)
    hostname = Column(String, nullable=True, index=True)
    username = Column(String, nullable=True)
    password = Column(String, nullable=True)
    ssh_enabled = Column(Boolean, default=False)
    ssh_port = Column(Integer, default=22, nullable=True)
    ssh_key = Column(Text, nullable=True)

    # Status & location
    status = Column(SAEnum(DeviceStatus), nullable=False, default=DeviceStatus.in_service)
    location = Column(String, nullable=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    storage_location = Column(String, nullable=True)   # for stock items (legacy name string)
    storage_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    purchase_date = Column(String, nullable=True)      # ISO date string

    # Services
    url = Column(String, nullable=True)                # primary web GUI URL
    service_name = Column(String, nullable=True)
    service_port = Column(Integer, nullable=True)

    # VM fields
    hypervisor_device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)

    # 3D Printer fields
    firmware_type = Column(String, nullable=True)      # "Klipper", "Marlin", "RRF"
    bed_size = Column(String, nullable=True)
    mcu_board = Column(String, nullable=True)

    # Storage drives — JSON array of {label, capacity, type}
    drives = Column(JSON, nullable=False, default=list)

    # Services — JSON array of {name, url, port}
    services = Column(JSON, nullable=True)

    # Home Assistant
    ha_entity_id = Column(String, nullable=True)

    # Pi-hole
    pihole_enabled  = Column(Boolean, default=False)
    pihole_nic_id   = Column(Integer, ForeignKey("nics.id"), nullable=True)
    pihole_password = Column(String, nullable=True)   # encrypted, separate from SSH password

    # Wake on LAN
    wol_enabled = Column(Boolean, default=False)

    # Monitoring
    monitoring_enabled = Column(Boolean, default=False)
    monitor_interval_secs = Column(Integer, default=60)
    monitor_target_nic_id = Column(Integer, ForeignKey("nics.id"), nullable=True)
    monitor_nic_ids = Column(JSON, nullable=True)  # list of NIC IDs to monitor

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    device_type = relationship("DeviceType", back_populates="devices")
    location_rel = relationship("Location", foreign_keys=[location_id])
    storage_location_rel = relationship("Location", foreign_keys=[storage_location_id])
    nics = relationship("Nic", back_populates="device",
                        foreign_keys="Nic.device_id", cascade="all, delete-orphan")
    monitor_target_nic = relationship("Nic", foreign_keys=[monitor_target_nic_id])
    hypervisor = relationship("Device", remote_side="Device.id",
                              foreign_keys=[hypervisor_device_id])
    vm_guests = relationship("Device", foreign_keys=[hypervisor_device_id], overlaps="hypervisor")

    monitoring_results = relationship(
        "MonitoringResult", back_populates="device", cascade="all, delete-orphan"
    )
    pihole_cache = relationship(
        "PiHoleCache", back_populates="device", uselist=False, cascade="all, delete-orphan"
    )
    switch_ports = relationship(
        "SwitchPort", back_populates="device", cascade="all, delete-orphan",
        order_by="SwitchPort.port_number",
        foreign_keys="SwitchPort.device_id",
    )

    # Port diagram display settings
    port_display_rows = Column(Integer, default=2)           # 1 or 2
    port_numbering    = Column(String, default='alternating') # 'alternating' | 'sequential'

    # Uplink topology
    uplink_port_id     = Column(Integer, ForeignKey("switch_ports.id"), nullable=True)
    upstream_device_id = Column(Integer, ForeignKey("devices.id"),      nullable=True)
    upstream_port_id   = Column(Integer, ForeignKey("switch_ports.id"), nullable=True)

    uplink_port     = relationship("SwitchPort", foreign_keys=[uplink_port_id])
    upstream_device = relationship("Device",     foreign_keys=[upstream_device_id], remote_side="Device.id")
    upstream_port   = relationship("SwitchPort", foreign_keys=[upstream_port_id])
