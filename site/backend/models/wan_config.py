from sqlalchemy import Column, Integer, String, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from database import Base


class WanConfig(Base):
    __tablename__ = "wan_configs"

    id             = Column(Integer, primary_key=True, index=True)
    device_id      = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    switch_port_id = Column(Integer, ForeignKey("switch_ports.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    isp_name        = Column(String, nullable=True)
    connection_type = Column(String, nullable=True)  # dhcp, static, pppoe, 4g-lte, ds-lite
    vlan_id         = Column(Integer, nullable=True)

    # Static / PPPoE addressing
    ip_address  = Column(String, nullable=True)
    subnet_mask = Column(String, nullable=True)
    gateway     = Column(String, nullable=True)

    # PPPoE credentials
    pppoe_username = Column(String, nullable=True)
    pppoe_password = Column(String, nullable=True)

    mtu           = Column(Integer, nullable=True)
    dns_primary   = Column(String, nullable=True)
    dns_secondary = Column(String, nullable=True)
    notes         = Column(Text, nullable=True)

    # Expected speeds
    speed_down = Column(String, nullable=True)  # e.g. "100 Mbps", "1 Gbps"
    speed_up   = Column(String, nullable=True)

    # WAN connectivity monitoring — ping this IP to verify the link is up
    wan_ping_target = Column(String, nullable=True)  # defaults to 1.1.1.1 at API layer
    wan_monitoring_enabled = Column(Boolean, nullable=True)  # defaults to True at API layer

    device      = relationship("Device", foreign_keys=[device_id])
    switch_port = relationship("SwitchPort", foreign_keys=[switch_port_id])
