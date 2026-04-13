<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Mobile & Responsive UI

> MyNet is fully usable on phones and tablets. The layout switches at the **768 px breakpoint** — below that, every page adapts to a single-column view optimised for touch.

---

## Contents

- [Navigation](#navigation)
- [Page-by-page behaviour](#page-by-page-behaviour)
  - [Dashboard](#dashboard)
  - [Devices](#devices)
  - [Networks](#networks)
  - [Subnet Lists](#subnet-lists)
  - [Monitoring](#monitoring)
  - [Switches](#switches)
  - [Events](#events)
  - [Pi-hole Settings](#pi-hole-settings)
  - [UniFi Settings](#unifi-settings)

---

## Navigation

On desktop, the sidebar is always visible on the left. On mobile it is replaced by two controls:

| Control | Location | Purpose |
|---|---|---|
| **Bottom bar** | Fixed to the bottom of the screen | Quick access to the five most-used pages |
| **Hamburger menu** | Top-left corner | Opens a full-screen drawer with all pages |

Tap any link in the drawer to navigate — the drawer closes automatically.

---

## Page-by-page behaviour

### Dashboard

The summary cards (Devices, Monitoring, Networks, Events) stack into a 2×2 grid on mobile rather than a single row. All cards are equal width. The rest of the dashboard content scrolls as a single column.

---

### Devices

- The filter dropdowns (network, type, status, location, NIC type) are arranged in a **2-column grid** on mobile instead of a single row
- The search bar moves below the dropdowns
- Device cards and the compact list view both reflow to full width

---

### Networks

Each network is shown as a card. On **desktop**, the CIDR, gateway, DHCP range, DNS, and SSIDs are always visible inside the card.

On **mobile**, this detail is hidden by default to keep the list scannable. A **chevron strip** on the right edge of each card expands or collapses it:

- Tap the strip to reveal the full network detail
- Tap again to collapse
- Only one card can be expanded at a time

---

### Subnet Lists

The subnet list (`/subnet-map`) behaves differently depending on screen size:

**Desktop** — full table with all columns always visible:

| IP | Name | NIC | MAC | DNS | Brand / Model | Switch Port | Location | Type |
|---|---|---|---|---|---|---|---|---|

Click any occupied row to navigate directly to the device page.

**Mobile** — a compact expandable row showing only IP and device name. Tap the row to expand a detail drawer with NIC, MAC, DNS, brand/model, switch port, and location, plus a **View device** link.

---

### Monitoring

- Network filter tiles wrap into multiple rows if needed
- The device search bar spans full width
- Summary stat cards (Devices Up, Uptime, etc.) are equal-width and wrap to a 2×2 grid
- Device monitoring cards reflow to full width; the WAN sparkline moves below the header row on mobile

---

### Switches

The switch port diagram scrolls horizontally on mobile. Port cards stack into a single column on narrow screens.

---

### Events

The events table reflows to full width. Less-critical columns (timestamp detail, entity type) compress or truncate to keep the most important information — message and severity — readable on small screens.

---

### Pi-hole Settings

- The configuration panel (DNS servers, blocking mode, etc.) is **hidden by default** on mobile and shown with a toggle button
- Pi-hole instance rows are collapsed by default; tap a row to expand its stats and controls
- On desktop, the full configuration table and all instance details are always visible

---

### UniFi Settings

The Networks and Devices tabs switch to a **card-per-row** layout on mobile rather than a dense table. Each card shows the key fields and can be tapped to see full detail. On desktop, the original table view is preserved.

---

*← [Settings](settings.md) · [Back to README](../../README.md)*
