# MyNet

Home network device management application.

> Full documentation coming soon.

## Notes

**Ping monitoring scale (Raspberry Pi 3B+):** Safe ceiling is ~300 monitored devices before the 30-second batch tick starts taking noticeable time. The internal `concurrent_tasks` cap in `monitoring_scheduler.py` should be raised from 150 to 256 if monitoring more than 150 devices simultaneously. Beyond 300 devices, consider reducing monitoring result retention from 48h to 24h.
