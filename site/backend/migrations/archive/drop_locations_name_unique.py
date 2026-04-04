"""
Migration: remove the UNIQUE constraint on locations.name so that multiple
locations can share the same name (e.g. "Office" under both Home and Storage).

SQLite does not support DROP CONSTRAINT, so we recreate the table.

Run once via:
  docker exec mynet_dev_backend python migrations/drop_locations_name_unique.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine

with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS locations_new (
            id        INTEGER PRIMARY KEY,
            name      VARCHAR NOT NULL,
            type      VARCHAR,
            parent_id INTEGER REFERENCES locations_new(id)
        )
    """))
    conn.execute(text("""
        INSERT INTO locations_new (id, name, type, parent_id)
        SELECT id, name, type, parent_id FROM locations
    """))
    conn.execute(text("DROP TABLE locations"))
    conn.execute(text("ALTER TABLE locations_new RENAME TO locations"))
    conn.commit()
    print("Done — UNIQUE constraint on locations.name removed.")
