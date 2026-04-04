"""
Migration: unify location_categories + locations into a single self-referential locations table.

- Adds parent_id and type columns to locations
- Promotes each location_category row into a Location row (type='Group')
- Sets parent_id on existing locations from their old category_id
- Drops the category_id column

Run once via:
  docker exec mynet_dev_backend python migrations/migrate_unified_locations.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, SessionLocal, Base
from models.location import Location

Base.metadata.create_all(bind=engine)
db = SessionLocal()

with engine.connect() as conn:
    existing_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(locations)")).fetchall()]

    # 1. Add parent_id if missing
    if "parent_id" not in existing_cols:
        conn.execute(text("ALTER TABLE locations ADD COLUMN parent_id INTEGER REFERENCES locations(id)"))
        conn.commit()
        print("Added parent_id column")

    # 2. Add type if missing
    if "type" not in existing_cols:
        conn.execute(text("ALTER TABLE locations ADD COLUMN type TEXT"))
        conn.commit()
        print("Added type column")

# 3. Migrate location_categories → locations (if the table exists)
with engine.connect() as conn:
    tables = [r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]

    if "location_categories" in tables:
        cats = conn.execute(text("SELECT id, name, parent_id FROM location_categories ORDER BY id")).fetchall()
        print(f"Found {len(cats)} categories to migrate")

        # Map old category id → new location id
        cat_id_to_loc_id: dict[int, int] = {}

        for cat_id, cat_name, cat_parent_id in cats:
            existing = db.query(Location).filter(Location.name == cat_name, Location.type == "Group").first()
            if existing:
                cat_id_to_loc_id[cat_id] = existing.id
            else:
                new_loc = Location(name=cat_name, type="Group", parent_id=None)
                db.add(new_loc)
                db.flush()
                cat_id_to_loc_id[cat_id] = new_loc.id

        db.commit()

        # Wire up parent_id for migrated category nodes
        for cat_id, cat_name, cat_parent_id in cats:
            if cat_parent_id and cat_parent_id in cat_id_to_loc_id:
                loc = db.get(Location, cat_id_to_loc_id[cat_id])
                loc.parent_id = cat_id_to_loc_id[cat_parent_id]
        db.commit()
        print(f"Category id map: {cat_id_to_loc_id}")

        # 4. Migrate locations' category_id → parent_id
        if "category_id" in [r[1] for r in conn.execute(text("PRAGMA table_info(locations)")).fetchall()]:
            locs_with_cat = conn.execute(text("SELECT id, category_id FROM locations WHERE category_id IS NOT NULL")).fetchall()
            for loc_id, cat_id in locs_with_cat:
                new_parent = cat_id_to_loc_id.get(cat_id)
                if new_parent:
                    conn.execute(text("UPDATE locations SET parent_id = :pid WHERE id = :lid"), {"pid": new_parent, "lid": loc_id})
            conn.commit()
            print(f"Migrated {len(locs_with_cat)} locations' category_id → parent_id")

            # 5. Drop category_id column
            try:
                conn.execute(text("ALTER TABLE locations DROP COLUMN category_id"))
                conn.commit()
                print("Dropped category_id column")
            except Exception as e:
                print(f"Could not drop category_id: {e}")
    else:
        print("No location_categories table found — nothing to migrate")

db.close()
print("Migration complete.")
