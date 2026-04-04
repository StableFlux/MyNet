# Archived Migration Scripts

These scripts were one-shot migration tools written during early development.
They are **no longer executed at startup** and should **not be run manually**.

All schema migrations are now handled idempotently by `migrations/apply.py`,
which is called automatically on every application startup.

## Why kept

Retained for historical reference only — they document what each migration did
and in what order the schema evolved.

## Scripts

| File | Purpose |
|---|---|
| migrate_location_categories.py | Migrated old location_categories table into unified locations self-referential tree |
| migrate_unified_locations.py | Follow-up pass for the unified locations migration |
| migrate_switch_ports.py | Initial switch port data migration |
| add_hardware_type.py | Added hardware_type column to devices |
| add_locations_name_parent_unique.py | Added unique constraint on (name, parent_id) |
| drop_locations_name_unique.py | Dropped the old single-column name unique constraint |
