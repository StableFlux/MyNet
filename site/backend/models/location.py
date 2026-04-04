from database import Base
from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=True)   # user-defined: "Room", "Premises", "Storage", etc.
    parent_id = Column(Integer, ForeignKey("locations.id"), nullable=True)

    parent = relationship("Location", remote_side="Location.id", backref="children")
