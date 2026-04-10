<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Monitoring

<div align="center">
  <img src="../../docs/images/monitoring-1.png" alt="Monitoring overview" width="100%" />
</div>

> MyNet pings every monitored device on a configurable schedule, tracks latency over time, and raises an alert when a device goes offline. WAN connections are monitored separately to track internet health.

---

## Contents

- [How Monitoring Works](#how-monitoring-works)
- [Enabling Monitoring on a Device](#enabling-monitoring-on-a-device)
- [Monitoring Page](#monitoring-page)
- [Device Monitoring Detail](#device-monitoring-detail)
- [WAN Monitoring](#wan-monitoring)
- [Real-Time Updates](#real-time-updates)
- [On-Demand Ping](#on-demand-ping)
- [Alerts & Events](#alerts--events)
- [Performance Tuning](#performance-tuning)

---

## How Monitoring Works

MyNet runs a background scheduler that pings all monitored devices at their configured intervals. Pings use ICMP (raw ping) via the **icmplib** library — no external tools required.

Each ping result records:

| Field | Description |
|---|---|
| **Status** | `up`, `down`, or `timeout` |
| **Latency** | Round-trip time in milliseconds (null on failure) |
| **Timestamp** | When the ping was sent |
| **IP Pinged** | The specific IP address that was pinged |

Results are stored in the database and retained for 48 hours. The scheduler runs a cleanup job every 2 hours to remove old results.

---

## Enabling Monitoring on a Device

1. Edit the device (or use the monitoring toggle on the device detail page)
2. Enable **Monitoring**
3. Configure:

| Setting | Description | Default |
|---|---|---|
| **Interval** | How often to ping (seconds) | 60 |
| **Monitor NICs** | Which NICs to ping | All Ethernet NICs |

When you save, the device is added to the monitoring scheduler immediately — no restart needed.

**Which NICs are monitored:** By default, all Ethernet (ETH) NICs with a valid IP address are monitored. You can select specific NICs in the device editor. Devices with only `DHCP` as their IP are skipped (no static IP to ping).

---

## Monitoring Page

The Monitoring page (`/monitoring`) shows all monitored devices in a sortable list.

Each row displays:

| Column | Description |
|---|---|
| **Device** | Name, type icon, and link to device detail |
| **Status** | Current status badge: Online / Offline / Unknown |
| **NICs** | Per-NIC status and latency sparkline |
| **Uptime** | Percentage of successful pings in the last 24 hours |
| **Avg Latency** | Mean round-trip time over the last 24 hours |
| **Last Seen** | Timestamp of the last successful ping |

Click a device row to expand it and see per-NIC latency history charts.

**Sorting:** Click column headers to sort by status, uptime, or latency.

---

## Device Monitoring Detail

On any device detail page, the **Monitoring** tab shows:

- Current status for each monitored NIC
- 48-point sparkline chart showing latency over the last 24 hours
- Uptime percentage
- Average latency
- Last seen timestamp
- Total pings sent / received

The **Ping Now** button (Quick Actions) triggers an immediate on-demand ping regardless of the scheduled interval.

---

## WAN Monitoring

WAN connections are monitored separately from LAN devices. WAN monitoring is configured on each [WAN port](switches.md#wan-configuration) of a router or gateway device.

**How it works:**

- Each WAN port can have a **ping target** IP (default: `1.1.1.1`)
- MyNet pings this target to test internet connectivity
- Results are tracked per WAN connection

**WAN Status** appears on the Dashboard and in the monitoring summary:

- Total WAN connections configured
- How many are currently reachable
- Per-connection status

When a WAN connection goes offline, a **warning event** is raised. When it recovers, a **recovery event** is logged.

---

## Real-Time Updates

Monitoring status updates are pushed to the browser via WebSocket. You do not need to refresh the page — status badges and sparklines update automatically.

The WebSocket connection requires authentication. If you are logged in, it connects automatically.

---

## On-Demand Ping

Click **Ping Now** on any device detail page to immediately send a ping, outside of the normal schedule. The result appears in the monitoring panel within a few seconds.

This is useful for:
- Testing whether a device just came online
- Verifying a network change took effect
- Checking latency after moving a device

Requires **Editor** role.

---

## Alerts & Events

MyNet raises events automatically based on monitoring results:

| Event | Trigger |
|---|---|
| **Device Offline** | A device fails `N` consecutive pings (default: 3) |
| **Device Recovered** | A previously-offline device responds again |
| **WAN Offline** | A WAN ping target becomes unreachable |
| **WAN Recovered** | A WAN connection is restored |

These events appear in the [Events](events.md) log and are included in the active alert count shown in the header.

The failure threshold (`N`) is configured via `MONITORING_FAILURE_THRESHOLD` in `.env` (default: 3).

---

## Performance Tuning

### Concurrent pings

By default, up to 20 pings run concurrently. For faster monitoring of many devices, increase this in `.env`:

```
MONITORING_MAX_CONCURRENT_PINGS=50
```

On a Raspberry Pi 3B+, a safe ceiling is about 150 concurrent pings. Beyond that, the 30-second scheduler tick may take longer than the tick interval.

### Monitoring interval

The scheduler ticks every 30 seconds. Each device is pinged no more frequently than its configured interval. The default interval for new devices is 60 seconds.

For large installations (300+ devices), consider:

- Setting intervals to 120s or longer
- Reducing result retention from 48h to 24h (edit `MONITORING_CLEANUP_AFTER_HOURS` in `monitoring_scheduler.py`)
- Moving the database to a faster medium (USB SSD instead of SD card on Pi)

### Raspberry Pi SD card wear

At 85 devices with 60-second intervals, MyNet writes approximately 70–100 MB/day to SQLite. Recommendations:

- Use a **high-endurance SD card** (Samsung Pro Endurance, SanDisk High Endurance)
- Move `DB_PATH` in `.env` to a USB drive
- Increase `TICK_SECS` from 30 to 60 in `monitoring_scheduler.py`

---

*← [Networks](networks.md) · [Events →](events.md)*
