from sqlalchemy import (
    Column, Integer, String, Boolean, ForeignKey,
    DateTime, Text, Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class NicType(str, enum.Enum):
    eth = "ETH"
    wifi = "WIFI"
    virt = "VIRT"
    sfp = "SFP"
    qsfp = "QSFP"


class AddressType(str, enum.Enum):
    reserved = "reserved"
    static = "static"
    dhcp = "dhcp"


class WifiBand(str, enum.Enum):
    band_2_4ghz = "2.4GHz"
    band_5ghz = "5GHz"
    band_6ghz = "6GHz"


class Nic(Base):
    __tablename__ = "nics"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    label = Column(String, nullable=True)                 # "eth0", "wlan0", "en0", "Ethernet"
    nic_type = Column(SAEnum(NicType), nullable=False)
    mac = Column(String, nullable=True, index=True)       # "aa:bb:cc:dd:ee:ff"
    ip_address = Column(String, nullable=True, index=True)
    dns_entry = Column(String, nullable=True)
    network_id = Column(Integer, ForeignKey("networks.id"), nullable=True, index=True)
    address_type = Column(SAEnum(AddressType), nullable=True, default=AddressType.reserved)

    # Static address fields
    gateway = Column(String, nullable=True)
    subnet_mask = Column(String, nullable=True)
    dns_server_1 = Column(String, nullable=True)
    dns_server_2 = Column(String, nullable=True)

    # ETH-only fields
    switch_port = Column(String, nullable=True)           # legacy text — kept for migration fallback
    switch_port_id = Column(Integer, ForeignKey("switch_ports.id"), nullable=True, index=True)
    poe_enabled = Column(Boolean, nullable=True, default=False)

    # WiFi-only fields
    ssid = Column(String, nullable=True)
    band = Column(SAEnum(WifiBand), nullable=True)

    # ETH/WiFi connection type and speed
    connection_type = Column(String, nullable=True)    # built-in, usb
    nic_speed = Column(String, nullable=True)          # 1GbE, WiFi6, etc.

    # SFP/QSFP-only fields
    transceiver_type = Column(String, nullable=True)   # fiber-sm, fiber-mm, dac, aoc, copper
    transceiver_speed = Column(String, nullable=True)  # 1G, 10G, 25G, 40G, 100G, 200G, 400G

    is_active = Column(Boolean, nullable=False, default=True)
    mac_conflict_suppressed = Column(Boolean, nullable=False, default=False)

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    device = relationship("Device", back_populates="nics", foreign_keys=[device_id])
    network = relationship("Network", back_populates="nics")
    switch_port_rel = relationship("SwitchPort", back_populates="nics", foreign_keys=[switch_port_id])
