# MyNet

Home network device management application.

> Full documentation coming soon.

## Notes

**Ping monitoring scale (Raspberry Pi 3B+):** Safe ceiling is ~300 monitored devices before the 30-second batch tick starts taking noticeable time. The internal `concurrent_tasks` cap in `monitoring_scheduler.py` should be raised from 150 to 256 if monitoring more than 150 devices simultaneously. Beyond 300 devices, consider reducing monitoring result retention from 48h to 24h.

**SD card storage and write wear:** Total install footprint is ~500MB (venv ~400MB, static files ~5MB, DB ~80MB at steady state with 85 devices). Capacity is not a concern on 32GB cards. The main risk is write wear — at 85 devices the scheduler writes ~70–100MB/day to the SQLite DB (monitoring results + 2-hourly cleanup). Standard SD cards may last 2–4 years under this load; high-endurance cards (Samsung Pro Endurance, SanDisk High Endurance) are strongly recommended. To reduce wear: move `DB_PATH` in `.env` to a USB drive, increase `TICK_SECS` in `monitoring_scheduler.py` from 30s to 60s, or reduce retention from 48h to 12h. These are code-level tuning options to be documented properly later.
