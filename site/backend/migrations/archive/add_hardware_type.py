"""
Migration: add hardware_type column to devices table.

Run once via:
  docker exec mynet_dev_backend python migrations/add_hardware_type.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE devices ADD COLUMN hardware_type VARCHAR"))
        conn.commit()
        print("Added hardware_type column to devices.")
    except Exception as e:
        if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
            print("Column already exists, skipping.")
        else:
            raise
