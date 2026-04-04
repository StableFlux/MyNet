"""
Migration: add a unique constraint on (name, parent_id) for locations,
so that the same name can't appear twice under the same parent, but CAN
appear under different parents (including different top-level containers).

SQLite treats NULL as distinct in UNIQUE indexes, so two top-level locations
with the same name would not violate UNIQUE(name, parent_id). We work around
this with COALESCE(parent_id, 0), treating NULL parent as 0 (no location has id=0).

Run once via:
  docker exec mynet_dev_backend python migrations/add_locations_name_parent_unique.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine

with engine.connect() as conn:
    try:
        conn.execute(text("""
            CREATE UNIQUE INDEX uq_locations_name_parent
            ON locations (name, COALESCE(parent_id, 0))
        """))
        conn.commit()
        print("Created unique index on (name, COALESCE(parent_id, 0)).")
    except Exception as e:
        if "already exists" in str(e).lower():
            print("Index already exists, skipping.")
        else:
            raise
