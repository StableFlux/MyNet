<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# UniFi Integration

> Connect MyNet to your UniFi Network controller to discover connected clients, compare your MyNet inventory against live UniFi data, sync network configuration, and optionally manage clients and networks — all from a unified interface.

---

## Contents

- [Setup & Connection](#setup--connection)
- [Read vs Write Access](#read-vs-write-access)
- [Client Discovery](#client-discovery)
- [Network Comparison](#network-comparison)
- [Device Comparison](#device-comparison)
- [Syncing Fields (MyNet ↔ UniFi)](#syncing-fields-mynet--unifi)
- [Adding Devices from UniFi](#adding-devices-from-unifi)
- [Managing UniFi Clients](#managing-unifi-clients)
- [Managing UniFi Networks](#managing-unifi-networks)
- [SSID Reconciliation](#ssid-reconciliation)
- [WiFi Path Association](#wifi-path-association)
- [Auth Types: API Key vs Credentials](#auth-types-api-key-vs-credentials)

---

## Setup & Connection

Navigate to **Settings → UniFi** (`/settings/unifi`).

### Configure the connection

| Field | Description | Example |
|---|---|---|
| **Controller Host** | Hostname or IP of your UniFi Network controller, with optional port | `192.168.1.1`, `unifi.local:8443` |
| **Auth Type** | How to authenticate | `API Key` or `Credentials` |
| **API Key** | Your UniFi API key (for API Key auth) | Generated in UniFi → Settings → API |
| **Username / Password** | Controller admin credentials (for Credentials auth) | |

### Test the connection

Click **Test Connection** to verify connectivity without saving. MyNet will connect to the controller and report success or an error message.

### Save

Click **Save** to store the configuration. The integration is now active.

---

## Read vs Write Access

By default, the UniFi integration is **read-only**. MyNet fetches data from UniFi but does not make any changes.

To enable write operations (create clients, update fields, delete records):

1. In **Settings → UniFi**, toggle **Enable Write Access** on
2. Click **Save**

When write access is disabled, all buttons that would modify UniFi data are **greyed out** with a tooltip explaining that write access is not enabled.

> Write access requires Credentials auth for most operations. API Key auth supports read-only operations only.

---

## Client Discovery

The UniFi integration shows all clients currently known to the controller — both wired and wireless.

Each client displays:

| Field | Description |
|---|---|
| Name | Alias set in UniFi, or MAC address if unnamed |
| IP Address | Last seen IP |
| MAC Address | Hardware address |
| Connection | Wired or wireless |
| Network | VLAN / network the client is on |
| Last Seen | When the controller last saw this client |

---

## Network Comparison

The **Comparison** view shows your MyNet networks side-by-side with UniFi networks, matched by:

1. Network name (exact match)
2. VLAN ID (if names differ)
3. Gateway IP (fallback)

### Match statuses

| Status | Meaning |
|---|---|
| **Matched** | Network exists in both MyNet and UniFi |
| **MyNet only** | Defined in MyNet but not in UniFi |
| **UniFi only** | Exists in UniFi but not in MyNet |

### Visible differences

For matched networks, MyNet highlights fields that differ between the two systems:

- VLAN ID
- CIDR subnet
- Gateway IP
- DHCP range (start/end)
- Network name

---

## Device Comparison

The **Comparison** view also shows devices side-by-side, matched by MAC address (primary) or IP address (fallback).

### Match statuses

| Status | Meaning |
|---|---|
| **Matched** | Device exists in both MyNet and UniFi |
| **MyNet only** | In MyNet but not seen by UniFi |
| **UniFi only** | Seen by UniFi but not in MyNet |

### Visible differences

For matched devices, highlighted fields include:

- IP address
- MAC address
- DNS entry (hostname)
- Connection type (wired vs wireless)

---

## Syncing Fields (MyNet ↔ UniFi)

### Sync a NIC field from UniFi → MyNet

On a matched device in the comparison view, click the sync arrow next to a differing field to pull the UniFi value into MyNet. Supported fields:

| Field | What is updated |
|---|---|
| **IP** | Updates the NIC's `ip_address` in MyNet |
| **MAC** | Updates the NIC's `mac` in MyNet |
| **DNS** | Updates the NIC's `dns_entry` in MyNet |

### Sync a NIC field from MyNet → UniFi

Click the reverse sync arrow to push the MyNet value to UniFi. This updates the UniFi client record.

### Sync network fields from UniFi → MyNet

In the network comparison, click the sync arrow next to a differing field to pull the UniFi value into MyNet. Supported fields: name, CIDR, gateway, DHCP start/end, VLAN ID.

> All field sync operations that write to UniFi require **write access enabled**.

---

## Adding Devices from UniFi

For **UniFi-only** clients (seen by UniFi but not in MyNet):

Click **Add to MyNet** on the client row. This opens the [Device Form](devices.md) pre-filled with:

| Field | Source |
|---|---|
| Device name | UniFi client alias |
| Hostname | UniFi client alias (normalised) |
| NIC MAC | UniFi client MAC |
| NIC IP | UniFi client IP |
| Network | Matched from UniFi network ID |
| NIC type | ETH or WIFI based on connection type |
| SSID | UniFi SSID (for wireless clients) |
| DNS entry | UniFi local DNS record (if set) |

Review the pre-filled form, make any adjustments, and save.

---

## Managing UniFi Clients

> Requires write access and Credentials auth.

### Create a known client

Add a device to UniFi's known client list (useful for setting fixed IPs and hostnames):

1. In the comparison view, click **Create in UniFi** for a MyNet-only device
2. Confirm the details (MAC, name, fixed IP, network, note)
3. Click **Create**

### Delete / forget a client

Remove a client from UniFi's known client list:

1. Find the client in the comparison view or client list
2. Click **Remove from UniFi**
3. Confirm

---

## Managing UniFi Networks

> Requires write access and Credentials auth.

### Create a network in UniFi

For a MyNet-only network, click **Create in UniFi**. The network is created in UniFi with the VLAN ID, gateway, CIDR, and DHCP range from MyNet.

### Delete a network from UniFi

Click **Delete from UniFi** on a UniFi-only or matched network. This removes the network definition from the controller.

> Deleting a network from UniFi does not delete the corresponding network in MyNet.

### Add a UniFi-only network to MyNet

For a **UniFi-only** network, click **Add to MyNet**. This opens the [Network Form](networks.md) pre-filled with the UniFi values: name, VLAN ID, CIDR, gateway, DHCP range, DNS servers — and every SSID bound to that network on UniFi (name, password, hidden flag, radio bands, security). Review the form and save.

After saving, the comparison table auto-refreshes on your next visit so the network shows as **Matched** instead of **UniFi only**.

---

## SSID Reconciliation

Underneath each network row in the comparison view, MyNet lists every SSID bound to that network on UniFi alongside the SSIDs configured in MyNet. SSIDs are matched by name (case-sensitive) and each row carries its own status and sync controls.

### SSID statuses

| Status | Meaning |
|---|---|
| **Matched** | Same SSID name on both sides, all fields agree |
| **Differences** | Same SSID name, but one or more fields differ |
| **MyNet only** | Defined in MyNet but no matching UniFi WLAN |
| **UniFi only** | Configured on UniFi but not yet in MyNet's network |

### Tracked fields

For each SSID MyNet compares:

- **Password** (PSK) — only compared when both sides have a value; API Key auth omits passphrases, so an empty UniFi password is treated as "unavailable", not a difference
- **Hidden** — whether the SSID is broadcast
- **Bands** — 2.4GHz, 5GHz, 6GHz (set comparison; order doesn't matter)
- **Security** — Open, WPA2, WPA3, WPA2/WPA3, WPA2-Enterprise, WPA3-Enterprise

### Per-SSID actions

Each SSID has its own buttons based on its status:

| Status | Available actions |
|---|---|
| **Differences** | **Use UniFi** (overwrite MyNet's SSID with UniFi values) · **Use MyNet** (push MyNet's password, hidden flag, bands, and security to UniFi) |
| **UniFi only** | **Add to MyNet** (copy the UniFi SSID into MyNet's network) · **Delete from UniFi** (remove the WLAN from the controller) |
| **MyNet only** | **Delete from MyNet** (remove the SSID from MyNet's network). *Creating a WLAN on UniFi from a MyNet-only SSID is not yet supported — it requires AP group discovery and is tracked as a follow-up.* |

> Write operations to UniFi (**Use MyNet**, **Delete from UniFi**) require **write access enabled** and **Credentials auth**.

### Band and security mapping

MyNet's canonical values are mapped to UniFi's internal fields on the fly:

| MyNet bands | UniFi `wlan_band` / `radio_bands` |
|---|---|
| `2.4GHz` | `ng` |
| `5GHz` | `na` |
| `2.4GHz + 5GHz` | `both` / `[ng, na]` |
| `6GHz` | `[6e]` |

| MyNet security | UniFi `x_security` |
|---|---|
| Open | `open` |
| WPA2 | `wpapsk` |
| WPA3 | `wpa3` |
| WPA2/WPA3 | `wpapsk` (with controller auto-upgrading) |
| WPA2-Enterprise | `wpaeap` |
| WPA3-Enterprise | `wpa3eap` |

---

## WiFi Path Association

When UniFi integration is configured with **Credentials auth**, MyNet fetches live WiFi association data from the controller (`/stat/sta` endpoint). This tells MyNet exactly which Access Point each WiFi client is currently connected to.

This data is used by the [Path Tracer](topology.md) to show the precise AP a device is associated with, rather than making a best-effort guess.

API Key auth does not support the association endpoint — credential auth is required for accurate WiFi paths.

---

## Auth Types: API Key vs Credentials

| Feature | API Key | Credentials |
|---|---|---|
| Fetch clients | ✓ | ✓ |
| Fetch networks | ✓ | ✓ |
| Fetch SSIDs | ✓ (names only) | ✓ (full, incl. passphrases) |
| Compare MyNet ↔ UniFi | ✓ | ✓ |
| Read WiFi associations | — | ✓ |
| Create / update clients | — | ✓ |
| Delete clients | — | ✓ |
| Create / delete networks | — | ✓ |
| Sync fields to UniFi | — | ✓ |
| Update / delete WLANs | — | ✓ |

Use **API Key** for a safe, read-only integration. Use **Credentials** for full bidirectional sync and precise WiFi topology.

---

*← [Pi-hole](pihole.md) · [QR Codes & Labels →](qr-labels.md)*
