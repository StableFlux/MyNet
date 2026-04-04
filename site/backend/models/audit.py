from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON, Enum as SAEnum
from sqlalchemy.sql import func
import enum
from database import Base


class AuditAction(str, enum.Enum):
    create = "create"
    update = "update"
    delete = "delete"
    import_csv = "import"
    deploy = "deploy"


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String, nullable=False, index=True)  # "device", "network", "nic", ...
    entity_id = Column(Integer, nullable=True, index=True)
    entity_name = Column(String, nullable=True)               # snapshot of name at time of event
    action = Column(SAEnum(AuditAction), nullable=False, index=True)
    changed_fields = Column(JSON, nullable=True)              # ["name", "status"]
    old_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String, nullable=True)                  # snapshot
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
