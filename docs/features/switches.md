<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Switch Ports

<div align="center">
  <img src="../../docs/images/switches.png" alt="Switch port diagram" width="100%" />
</div>

> Map every physical port on your managed switches, track what is plugged in where, and configure WAN uplink details — all from a visual port diagram.

---

## Contents

- [Switch Port Overview](#switch-port-overview)
- [Viewing Switch Diagrams](#viewing-switch-diagrams)
- [Managing Ports on a Switch](#managing-ports-on-a-switch)
- [Port Fields Reference](#port-fields-reference)
- [Connecting a NIC to a Port](#connecting-a-nic-to-a-port)
- [WAN Configuration](#wan-configuration)
- [Uplink Configuration](#uplink-configuration)

---

## Switch Port Overview

Every network switch, router, or access point can have its physical ports defined in MyNet. Once ports are mapped and NICs are connected to them, the data powers:

- The **Switch Ports page** (`/switches`) — visual port diagrams for all switches
- The **Topology graph** — accurate wired connection paths
- The **Path Tracer** — hop-by-hop route finding
- **Subnet maps** — shows switch port alongside each IP

---

## Viewing Switch Diagrams

Navigate to `/switches` to see all switches with defined ports.

Each switch shows a visual diagram of its ports laid out in rows (mirroring the physical front panel). Each port is color-coded:

| Color | Meaning |
|---|---|
| **Blue** | Occupied — a NIC is connected to this port |
| **Amber** | WAN port |
| **Grey** | Empty — no device connected |
| **Green border** | Management port |

Hover over a port to see the connected device name and NIC.

**Drag to reorder** switches on the page — the order is saved.

---

## Managing Ports on a Switch

1. Open any switch device's detail page
2. Click the **Ports** tab
3. Click **Edit Ports** to open the port editor

You can:
- Add individual ports or **bulk-create** all ports at once (enter the number of ports and click Generate)
- Edit port names, types, PoE, speed, and mode
- Delete unused ports

---

## Port Fields Reference

| Field | Description | Example |
|---|---|---|
| **Port Number** | The physical port number on the switch | `1`, `24`, `49` |
| **Name / Label** | Optional custom name | `Uplink`, `Server Room`, `AP Office` |
| **Type** | Port interface type | `eth`, `sfp`, `sfp+`, `rj45` |
| **PoE** | Whether this port supplies Power over Ethernet | Enabled / Disabled |
| **PoE Budget** | Maximum PoE power in watts | `15.4`, `30`, `60` |
| **Speed** | Port speed | `1G`, `2.5G`, `10G` |
| **Port Mode** | `lan` for standard ports, `wan` for uplink/ISP connections | `lan` |
| **Management** | Mark this as the management/IPMI port | Yes / No |
| **Management Network** | Network/VLAN for management traffic | *(select from list)* |
| **Management IP** | Static IP for switch management interface | `192.168.0.254` |
| **Notes** | Free-text notes | `Patch panel port 12` |

---

## Connecting a NIC to a Port

To record that a device's Ethernet NIC is plugged into a specific switch port:

1. Edit the device
2. Open the NIC editor for the relevant NIC
3. In the **Switch Port** field, select the switch and port number

Or, from the switch port editor:
1. Open the port
2. Use **Assign Device NIC** to pick the connected device and NIC

The connection appears on both the switch diagram and the device detail page.

---

## WAN Configuration

WAN ports carry traffic from your ISP to your router. MyNet stores the full configuration for each WAN connection.

### Setting up a WAN port

1. Edit the router or gateway device
2. Go to the **Ports** tab
3. Find the WAN port and click **Edit**
4. Set **Port Mode** to `wan`
5. Click **WAN Config** to configure the connection

### WAN Config fields

| Field | Description |
|---|---|
| **ISP Name** | Your internet service provider's name |
| **Connection Type** | `dhcp`, `static`, `pppoe`, `4g-lte`, `ds-lite` |
| **VLAN ID** | If the ISP connection uses a VLAN tag (e.g. for FTTC/VDSL) |
| **IP Address** | Static WAN IP (for static connections) |
| **Subnet Mask** | e.g. `255.255.255.252` |
| **Gateway** | ISP gateway IP |
| **PPPoE Username / Password** | For PPPoE connections |
| **MTU** | Maximum transmission unit (typically 1500 or 1492 for PPPoE) |
| **DNS Primary / Secondary** | ISP-provided or custom DNS servers |
| **Speed Down / Up** | Your contracted line speed (informational) |
| **WAN Monitoring Enabled** | Toggle ping monitoring for this connection |
| **WAN Ping Target** | IP to ping for internet health checks (default: `1.1.1.1`) |
| **Notes** | Free-text notes |

WAN connections with monitoring enabled appear in the WAN section of the [Dashboard](../../README.md) and the [Monitoring](monitoring.md) page.

---

## Uplink Configuration

To make the topology graph and path tracer aware of how switches connect to each other, configure the uplink on each switch:

1. Edit the switch device
2. Go to **Infrastructure** settings
3. Set:
   - **Uplink Port** — the port on *this* switch used for the uplink
   - **Upstream Device** — the switch or router this connects to
   - **Upstream Port** — the specific port on the upstream device

With uplinks configured, MyNet can trace the full path from any end device, through all intermediate switches, to any destination.

---

*← [Topology](topology.md) · [Locations →](locations.md)*
