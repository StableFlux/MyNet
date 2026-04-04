"""
Migration: introduce location_categories table with self-referential nesting.

- Creates location_categories table
- Promotes existing string `category` values from locations to LocationCategory rows
- Adds category_id FK column to locations
- Maps each location's old category string → new category_id
- Drops the old category text column

Run once via:
  docker exec mynet_dev_backend python migrations/migrate_location_categories.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, SessionLocal, Base
from models import *  # noqa — ensures all models are registered
from models.location_category import LocationCategory
from models.location import Location

# Create new table
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# 1. Collect distinct old category strings
with engine.connect() as conn:
    try:
        rows = conn.execute(text("SELECT DISTINCT category FROM locations WHERE category IS NOT NULL AND category != ''")).fetchall()
        old_categories = [r[0] for r in rows]
    except Exception:
        old_categories = []

print(f"Found {len(old_categories)} existing category strings: {old_categories}")

# 2. Create a LocationCategory row for each (top-level, no parent)
cat_map: dict[str, int] = {}
for name in sorted(old_categories):
    existing = db.query(LocationCategory).filter(LocationCategory.name == name, LocationCategory.parent_id == None).first()
    if existing:
        cat_map[name] = existing.id
    else:
        lc = LocationCategory(name=name, parent_id=None)
        db.add(lc)
        db.flush()
        cat_map[name] = lc.id

db.commit()
print(f"Category map: {cat_map}")

# 3. Add category_id column if it doesn't exist
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE locations ADD COLUMN category_id INTEGER REFERENCES location_categories(id)"))
        conn.commit()
        print("Added category_id column")
    except Exception as e:
        print(f"category_id column already exists or error: {e}")

# 4. Populate category_id from old category string
with engine.connect() as conn:
    for name, cat_id in cat_map.items():
        conn.execute(text("UPDATE locations SET category_id = :cid WHERE category = :name"), {"cid": cat_id, "name": name})
    conn.commit()
    print("Populated category_id values")

# 5. Drop old category text column (SQLite requires recreating the table)
with engine.connect() as conn:
    try:
        # Check if column exists
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(locations)")).fetchall()]
        if 'category' in cols:
            conn.execute(text("ALTER TABLE locations DROP COLUMN category"))
            conn.commit()
            print("Dropped old category column")
        else:
            print("Old category column not present, skipping drop")
    except Exception as e:
        print(f"Could not drop category column: {e}")

db.close()
print("Migration complete.")
