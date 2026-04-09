<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Topology

> MyNet automatically builds a visual map of your network by deriving connections from switch port assignments, uplink configuration, and (optionally) live UniFi WiFi association data.

---

## Contents

- [Network Topology Graph](#network-topology-graph)
- [How Connections Are Derived](#how-connections-are-derived)
- [Path Tracer](#path-tracer)
- [WiFi Path Accuracy](#wifi-path-accuracy)

---

## Network Topology Graph

Navigate to `/path-tracer` (or use the topology link in the navigation) to see the full network graph.

The graph shows:

- **Device nodes** — each In Service device appears as a node with its name, primary IP, type icon, and location
- **Connection edges** — lines representing physical or logical connections between devices
- **Network colors** — edges are colored by the network/VLAN they traverse
- **Monitoring status** — nodes are highlighted if the device is currently offline

### Node types

| Node style | Meaning |
|---|---|
| Larger / highlighted | Infrastructure device (switch, router, access point) |
| Standard | End device (PC, phone, IoT, server, etc.) |
| Red border | Currently offline (monitoring enabled and failing) |

### Interactions

- **Pan** — click and drag the background
- **Zoom** — scroll or pinch
- **Click a node** — see device name, IP, type, and a link to the device detail page

---

## How Connections Are Derived

MyNet builds the topology graph from data you have already entered — no network scanning or SNMP required.

### Wired (Ethernet) connections

A wired edge is drawn between two devices when:

1. A NIC on Device A has its **Switch Port** assigned to a port on Switch B
2. Switch B has an **Uplink Port** configured pointing to Switch A (or a router/gateway)

This means: keep switch port assignments and uplink configurations up to date for accurate topology.

### VM / Hypervisor connections

An edge is drawn from a hypervisor device to any VM whose **Hypervisor Device** is set to that host.

### WiFi connections

A WiFi edge is drawn from an Access Point to a device when:

- The device has a WiFi NIC assigned to a network that matches the AP's coverage, **or**
- (More accurately) the UniFi integration is configured and active — MyNet fetches live association data from `/stat/sta` to determine exactly which AP each client is connected to

---

## Path Tracer

The path tracer finds the route between any two devices on your network.

### How to use it

1. Open `/path-tracer`
2. Select a **Source** device (e.g. your laptop)
3. Select a **Target** device (e.g. your NAS)
4. Click **Trace**

MyNet performs a breadth-first search through the derived connection graph and returns the shortest path.

### Path results

Each hop in the path shows:

| Field | Description |
|---|---|
| **Device** | Name and type of the device at this hop |
| **Connection Type** | `eth` (wired) or `wifi` |
| **Interface** | The NIC or port used at this hop |
| **Network** | The VLAN the connection traverses |

### Example path

```
MacBook Pro  →  AP Snug (WiFi)  →  Core Switch  →  NAS
```

---

## WiFi Path Accuracy

Without UniFi integration, MyNet makes a best-effort guess about which access point a WiFi device is connected to, based on network assignments. This may not be accurate if you have multiple APs on the same SSID/VLAN.

When the [UniFi integration](unifi.md) is configured with **credentials auth** (username/password), MyNet fetches live WiFi association data from the UniFi controller (`/stat/sta`). This tells MyNet exactly which AP each client MAC address is associated with, giving a precise path.

**Path accuracy indicator:** If any hop in a traced path used estimated (non-precise) WiFi association data, a **"Best estimate"** badge appears on the result. When all WiFi associations come from live UniFi data, no badge is shown.

> **Note:** API key auth does not support the association endpoint. Use credentials auth for precise WiFi paths.

---

*← [Events](events.md) · [Switch Ports →](switches.md)*
