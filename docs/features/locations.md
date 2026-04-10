<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Locations

<div align="center">
  <img src="../../docs/images/locations.png" alt="Location tree" width="100%" />
</div>

> Organise your devices with a hierarchical location tree. Model anything from a simple room layout to a multi-floor building with racks and shelves.

---

## Contents

- [Location Hierarchy](#location-hierarchy)
- [Managing Locations](#managing-locations)
- [Assigning Devices to Locations](#assigning-devices-to-locations)
- [Location Types](#location-types)
- [Storage Locations](#storage-locations)

---

## Location Hierarchy

Locations form a tree structure where each location can have a parent. There is no fixed depth limit — nest as deeply as you need.

**Example hierarchies:**

```
Home
├── Ground Floor
│   ├── Living Room
│   ├── Kitchen
│   └── Utility Room
├── First Floor
│   ├── Office
│   └── Bedroom
└── Loft
    └── Server Rack
        ├── Shelf 1
        └── Shelf 2
```

```
Lab
├── Rack A
│   ├── U1 – U10
│   └── U11 – U20
└── Rack B
```

---

## Managing Locations

Navigate to **Settings → Locations** (`/settings/locations`).

The locations page shows the full tree. Actions:

| Action | How |
|---|---|
| **Add location** | Click **+ Add** and select the parent location |
| **Edit** | Click the pencil icon on any location |
| **Delete** | Click the bin icon — only possible if no devices are assigned to this location or any of its descendants |
| **Move** | Edit the location and change its parent |

The **device count** on each location row includes all devices in that location and all its descendants.

> The **Storage** location is built-in and cannot be deleted. It is used for stock and undeployed devices that have not been assigned a specific location.

---

## Assigning Devices to Locations

On any device's edit form:

- **Location** — where the device is currently deployed (e.g. `Office`, `Rack A / U3`)
- **Storage Location** — where a spare or decommissioned device is physically stored

Both fields show the full location path (e.g. `Home / First Floor / Office`) for clarity.

Devices inherit location context from their ancestors — the device list and subnet map both show the full path.

---

## Location Types

Each location has a **type label** — a short string describing what kind of location it is (e.g. `Room`, `Rack`, `Floor`, `Building`, `Cabinet`).

Type labels are free text. MyNet collects distinct type labels across all locations and shows them in a legend with customisable colors. Configure location type colors in **Settings → Colours**.

---

## Storage Locations

The **Storage Location** field on a device is separate from its deployed location. Use it to track where spare hardware lives when it is not in service:

- `Loft / Storage Box A`
- `Office / Drawer 2`
- `Server Room / Shelf 3`

Storage locations appear on the Stock page, making it easy to find a specific spare without searching physically.

---

*← [Switch Ports](switches.md) · [Search →](search.md)*
