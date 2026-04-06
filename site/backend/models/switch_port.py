import enum
from sqlalchemy import Column, Integer, String, Boolean, Float, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from database import Base


class PortType(str, enum.Enum):
    eth      = "eth"
    sfp      = "sfp"
    sfp_plus = "sfp+"
    dac      = "dac"
    qsfp     = "qsfp"


class SwitchPort(Base):
    __tablename__ = "switch_ports"

    id            = Column(Integer, primary_key=True, index=True)
    device_id     = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    port_number   = Column(Integer, nullable=False)           # global sequential position (1-based)
    port_name     = Column(String, nullable=True)             # optional descriptive label ("Uplink", "Server Farm")
    port_type     = Column(SAEnum(PortType), nullable=False, default=PortType.eth)
    poe_enabled   = Column(Boolean, nullable=False, default=False)
    poe_budget_w  = Column(Float, nullable=True)              # max PoE wattage for this port
    speed         = Column(String, nullable=True)             # "1G", "2.5G", "10G"
    notes         = Column(String, nullable=True)

    port_mode       = Column(String, nullable=False, default="lan")  # lan | wan

    is_management   = Column(Boolean, nullable=False, default=False)
    mgmt_network_id = Column(Integer, ForeignKey("networks.id"), nullable=True)
    mgmt_ip_address = Column(String, nullable=True)

    device       = relationship("Device", back_populates="switch_ports", foreign_keys=[device_id])
    nics         = relationship("Nic", back_populates="switch_port_rel", foreign_keys="Nic.switch_port_id")
    mgmt_network = relationship("Network", foreign_keys=[mgmt_network_id])
    downstream_devices = relationship("Device", foreign_keys="[Device.upstream_port_id]", overlaps="upstream_port")

    @property
    def label(self) -> str:
        """Constructed display label: 'Port 13', 'Port 13 / Uplink', 'Port 49 (SFP+)'"""
        base = f"Port {self.port_number}"
        if self.port_name:
            base = f"{base} / {self.port_name}"
        return base
