<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Networks

<div align="center">
  <img src="../../docs/images/networks.png" alt="Networks and VLANs" width="100%" />
</div>
<div align="center">
  <img src="../../docs/images/subnet-lists-1.png" alt="Subnet list" width="49%" />
  <img src="../../docs/images/subnet-lists-2.png" alt="Subnet detail" width="49%" />
</div>

> Define your VLANs and subnets, configure DNS and DHCP ranges, and visualise IP allocation across every subnet with the interactive subnet map.

---

## Contents

- [Network List](#network-list)
- [Creating a Network](#creating-a-network)
- [Network Fields Reference](#network-fields-reference)
- [Subnet Map](#subnet-map)
- [DNS Configuration](#dns-configuration)
- [SSIDs / Wireless Networks](#ssids--wireless-networks)

---

## Network List

The Networks page (`/networks`) lists all your VLANs and subnets sorted by VLAN ID. Each card shows:

- Network name and color
- VLAN ID
- CIDR subnet
- Number of devices connected
- Links to view the subnet map and edit the network

---

## Creating a Network

Click **+ Add Network** from the Networks page.

At minimum, give your network a **name**. Everything else is optional but recommended for full functionality.

---

## Network Fields Reference

### Identity

| Field | Description | Example |
|---|---|---|
| **Name** | Human-readable label for this network | `Home LAN`, `IoT VLAN`, `Guest WiFi` |
| **VLAN ID** | 802.1Q VLAN tag (1–4094). Leave blank for untagged. | `10`, `20`, `100` |
| **Color** | Hex color used for this network in the UI, topology graph, and subnet map | `#6366f1` |
| **Icon** | Optional icon from the icon set | *(selected in the form)* |
| **Purpose** | Free-text description | `Smart home devices, isolated from LAN` |
| **Notes** | Any additional notes | |

### Subnet

| Field | Description | Example |
|---|---|---|
| **CIDR** | Subnet in CIDR notation | `192.168.1.0/24`, `10.0.20.0/24` |
| **Gateway** | Default gateway IP | `192.168.1.1` |
| **DHCP Range Start** | First IP issued by DHCP | `192.168.1.100` |
| **DHCP Range End** | Last IP issued by DHCP | `192.168.1.199` |

> **Validation:** CIDR notation, gateway, and DHCP range values are all validated before saving. Invalid IP addresses or subnets are rejected.

### DNS

| Field | Description |
|---|---|
| **Auto DNS** | MyNet will suggest DNS entries for devices on this network using the system DNS domain (configured in [Settings](settings.md)) |
| **Primary DNS** | Primary DNS server IP for this network |
| **Secondary DNS** | Secondary DNS server IP |
| **Extra DNS Servers** | Additional DNS server IPs (comma-separated list) |

---

## Subnet Map

Click **View Map** on any network card to open the subnet map (`/subnet-map?network=<id>`).

The subnet map shows every IP address in the subnet as a grid cell:

| Color | Meaning |
|---|---|
| **Blue** | Gateway address |
| **Green** | Occupied — a device NIC is assigned this IP |
| **Amber** | Reserved — marked as reserved in the DHCP range |
| **Purple** | In DHCP pool — within the configured DHCP range |
| **Grey** | Free — unassigned and outside the DHCP range |

Click any occupied row to navigate to the device page.

> **Large subnets:** The map truncates at 1,024 hosts. For /16 and larger subnets, use the search page to find specific IPs.

> **Mobile:** On small screens the subnet list switches to compact expandable rows — tap a row to reveal MAC, DNS, switch port, and other details. See [Mobile & Responsive UI](mobile.md#subnet-lists).

---

## DNS Configuration

MyNet does not act as a DNS server itself, but it tracks the intended DNS entries for every NIC and can sync them to Pi-hole.

**Auto DNS** (enabled per network): When a device on this network has a hostname, MyNet suggests a DNS entry in the format `<hostname>.<dns-domain>`. The DNS domain suffix is configured in [Settings](settings.md).

For full DNS management with Pi-hole, see [Pi-hole Integration](pihole.md).

---

## SSIDs / Wireless Networks

Each network can have one or more SSIDs associated with it. The Wireless SSIDs section is expanded by default when adding or editing a network.

Each SSID entry has:

| Field | Description |
|---|---|
| **SSID** | The WiFi network name |
| **Password** | Optional, stored for reference (encrypted if encryption is enabled) |
| **Hidden** | Whether the SSID is broadcast or hidden |
| **Bands** | Radio bands the SSID runs on — any combination of 2.4GHz, 5GHz, 6GHz |
| **Security** | Open, WPA2, WPA3, WPA2/WPA3, WPA2-Enterprise, or WPA3-Enterprise |

These SSIDs appear on the network detail and are shown when editing devices that use a WiFi NIC on this network.

### UniFi sync

When [UniFi integration](unifi.md) is configured, MyNet pulls WLANs from the controller, matches them to networks by `networkconf_id`, and reconciles each SSID against the network's `ssids` list. The comparison view provides per-SSID actions to copy UniFi values into MyNet, push MyNet values to UniFi, or delete from either side. See [SSID Reconciliation](unifi.md#ssid-reconciliation) for details.

Creating a network via UniFi's **Add to MyNet** button pre-fills the Wireless SSIDs section with every SSID bound to that network on UniFi, so you don't have to re-enter them manually.

---

*← [Devices](devices.md) · [Monitoring →](monitoring.md)*
