<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Network Scanner

> Ping-sweep your subnets to discover every responding host. MyNet cross-references results against your inventory to show you what is known, what is unknown, and what has disappeared.

---

## Contents

- [How It Works](#how-it-works)
- [Running a Scan](#running-a-scan)
- [Scan Results](#scan-results)
- [Adding Discovered Devices](#adding-discovered-devices)
- [Notes & Limitations](#notes--limitations)

---

## How It Works

The network scanner performs a **ping sweep** of all subnets with a defined CIDR in your network list. For each IP that responds:

1. MyNet sends an ICMP ping
2. It attempts a reverse DNS lookup for the IP
3. It looks up the MAC address from the system ARP table (Linux: `ip neigh show` or `/proc/net/arp`)
4. It cross-references the IP and MAC against all devices in your inventory

Results are returned in real time but **not saved** to the database — scanning is purely observational.

---

## Running a Scan

Navigate to **Settings → Network Scan** (`/settings/network-scan`).

> Requires Admin role.

### Scan all networks

Click **Scan All Networks** to sweep every network in your MyNet inventory that has a CIDR defined.

### Scan specific networks

Use the network selector to choose one or more specific networks to scan.

### Scan duration

Scan time depends on the number of IPs in your subnets and how many respond. A /24 subnet (254 hosts) typically completes in 10–30 seconds. Larger subnets take proportionally longer.

---

## Scan Results

Results are grouped into two categories:

### Known devices

Hosts whose IP or MAC address matches a device already in your MyNet inventory.

| Column | Description |
|---|---|
| IP | The responding IP address |
| MAC | Hardware address (from ARP) |
| Hostname | Reverse DNS name (if resolved) |
| Device | The matched MyNet device name |
| Status | Whether the IP/MAC match is exact |

### Unknown devices

Hosts that responded to a ping but are **not** in your inventory.

| Column | Description |
|---|---|
| IP | The responding IP address |
| MAC | Hardware address (from ARP, if available) |
| Hostname | Reverse DNS name (if resolved) |
| Action | **Add to MyNet** button |

---

## Adding Discovered Devices

For each unknown host, click **Add to MyNet** to open the [Device Form](devices.md) pre-filled with:

- IP address
- MAC address (if available from ARP)
- Hostname (from reverse DNS, if available)
- Network assignment (from which subnet the IP was found in)

Review and complete the form, then save to add it to your inventory.

---

## Notes & Limitations

| Limitation | Detail |
|---|---|
| **Read-only** | The scanner never modifies your database — it only reports what it finds |
| **ICMP required** | Devices that block ICMP ping will not appear in results even if they are online |
| **ARP table** | MAC lookup relies on the server's ARP cache. Devices on different subnets (not directly connected) may not have an ARP entry, so MAC addresses may not be available for all results |
| **Large subnets** | Scanning a /16 or larger subnet takes a long time and is generally impractical. Use targeted scans on specific /24 or smaller subnets |
| **Raspberry Pi** | On a Pi 3B+, scanning a full /24 takes about 15–25 seconds with default concurrency settings |

---

*← [QR Codes & Labels](qr-labels.md) · [Back to README](../../README.md)*
