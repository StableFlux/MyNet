<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Pi-hole Integration

> Connect MyNet to your Pi-hole instances to see live DNS statistics, manage custom DNS records, sync DNS entries from device NICs, and control ad-blocking — all without leaving MyNet.

---

## Contents

- [Setup](#setup)
- [Pi-hole Dashboard Stats](#pi-hole-dashboard-stats)
- [Custom DNS Records](#custom-dns-records)
- [DNS Sync (MyNet ↔ Pi-hole)](#dns-sync-mynet--pi-hole)
- [Query History](#query-history)
- [Blocking Control](#blocking-control)
- [Multiple Pi-holes](#multiple-pi-holes)
- [Troubleshooting](#troubleshooting)

---

## Setup

### Step 1 — Mark a device as a Pi-hole

1. Edit the device that runs Pi-hole
2. Enable **Pi-hole** in the device form
3. Select the **Pi-hole NIC** — the network interface MyNet should poll (the one with the Pi-hole IP address)
4. Enter the **Pi-hole password** (the admin panel password, or the app password from Pi-hole v6+)
5. Save

### Step 2 — Configure the poll interval (optional)

In **Settings → General**, set the **Pi-hole Poll Interval** (default: 5 minutes, minimum: 1 minute). This controls how frequently MyNet fetches stats from all Pi-hole devices.

### Step 3 — Trigger an initial poll

In **Settings → Pi-hole**, click **Poll Now** next to each Pi-hole device to fetch stats immediately without waiting for the next scheduled poll.

---

## Pi-hole Dashboard Stats

The **Settings → Pi-hole** page shows a summary panel for each Pi-hole device:

| Stat | Description |
|---|---|
| Queries today | Total DNS queries processed today |
| Blocked today | Queries blocked today |
| Block percentage | Percentage of queries blocked |
| Domains on blocklist | Total domains in the block list |
| Blocking enabled | Whether ad-blocking is currently active |
| Version | Pi-hole software version |
| Reachable | Whether MyNet can reach this Pi-hole |
| Last polled | Timestamp of the most recent successful poll |

**Aggregated stats** (when multiple Pi-holes are configured) are shown at the top:

- Combined queries and blocks across all instances
- Top 10 blocked domains (counts merged across all Pi-holes)
- Top DNS clients (non-Pi-hole devices, by query count)
- Overall block percentage

---

## Custom DNS Records

MyNet can view and manage the custom DNS (local DNS) records stored in your Pi-hole.

Navigate to **Settings → Pi-hole → DNS Records**.

The DNS records panel shows all custom A records from Pi-hole, with options to:

| Action | Description |
|---|---|
| **Push DNS entry to Pi-hole** | Send a NIC's `dns_entry` from MyNet to Pi-hole as a new A record |
| **Update DNS IP** | Update the IP address for an existing Pi-hole DNS record when a device's IP changes |
| **Remove DNS entry** | Delete a DNS record from Pi-hole |

---

## DNS Sync (MyNet ↔ Pi-hole)

The **DNS Comparison** view shows a side-by-side comparison of your MyNet NIC DNS entries versus the records stored in Pi-hole.

### Comparison columns

| Column | Description |
|---|---|
| **Hostname** | The DNS name (e.g. `nas.home.arpa`) |
| **MyNet IP** | The IP address recorded against the NIC in MyNet |
| **Pi-hole IP** | The IP address stored in Pi-hole for this hostname |
| **Status** | Match, mismatch, MyNet-only, or Pi-hole-only |

### Sync actions

| Action | What it does |
|---|---|
| **Push to Pi-hole** | Add a MyNet NIC DNS entry to Pi-hole (creates the record) |
| **Update on Pi-hole** | Update the IP in Pi-hole to match MyNet |
| **Pull to MyNet** | Update the MyNet NIC `dns_entry` to match Pi-hole |
| **Remove from Pi-hole** | Delete the record from Pi-hole |

### Apply DNS domain suffix

The **Apply domain suffix** action updates all DNS entries in Pi-hole (or MyNet NICs) to include the configured DNS domain suffix. For example, changing from `nas` to `nas.home.arpa` if your DNS domain is `home.arpa`.

This operation is a bulk update — it applies to all entries that do not already have the suffix.

---

## Query History

On any device detail page, click **DNS Queries** (available when Pi-hole integration is configured) to fetch recent DNS queries attributed to that device's IP.

The query history shows:

| Column | Description |
|---|---|
| Domain | The domain queried |
| Status | Allowed, Blocked, or Cached |
| Query type | A, AAAA, PTR, etc. |
| Client IP | The source IP of the query |
| Timestamp | When the query was made |

---

## Blocking Control

Toggle ad-blocking on or off for a specific Pi-hole instance from **Settings → Pi-hole**. Click **Enable** or **Disable** next to the Pi-hole device.

This calls the Pi-hole API to enable or disable blocking. The new state is reflected in the dashboard immediately.

> Requires Admin role.

---

## Multiple Pi-holes

MyNet supports up to two Pi-hole instances (configured separately). Each is polled independently and shown as a separate card on the Pi-hole settings page.

For more than two Pi-holes, configure them as separate MyNet devices each marked with the Pi-hole flag. All will be polled and their stats aggregated.

---

## Troubleshooting

| Problem | Check |
|---|---|
| Pi-hole shows as unreachable | Verify the NIC IP is correct and reachable from the MyNet server |
| No stats appearing | Click **Poll Now** and check the Last Polled timestamp |
| DNS records not showing | Ensure the Pi-hole password is correct — Pi-hole v6 uses an app password |
| DNS push fails | Check that the MyNet URL resolves correctly from the Pi-hole |

---

*← [Settings](settings.md) · [UniFi →](unifi.md)*
