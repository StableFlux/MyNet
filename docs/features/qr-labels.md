<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# QR Codes & Labels

> Generate printable QR code labels for any device. Scan the label to jump straight to the device detail page in MyNet, or link to the device's web interface.

---

## Contents

- [Requirements](#requirements)
- [MyNet Link QR Code](#mynet-link-qr-code)
- [Service URL QR Code](#service-url-qr-code)
- [Printed Labels](#printed-labels)
- [Label Dimensions](#label-dimensions)
- [Custom URL Labels](#custom-url-labels)

---

## Requirements

Before generating QR codes, set the **MyNet URL** in **Settings → General**:

- Example: `http://192.168.1.100` or `https://mynet.example.com`
- This is the base URL that will be encoded in QR codes for device links

Without the MyNet URL set, device label generation will show an error.

---

## MyNet Link QR Code

A **MyNet Link QR** encodes the URL to the device's detail page in MyNet. When scanned with a phone or tablet, it opens the device directly.

### How to generate

1. Open any device detail page
2. Click **QR Code** in the Quick Actions panel (or the QR icon in the header)
3. A modal opens showing the QR code
4. Right-click or long-press to save the QR code image

This QR code links to `<MyNet URL>/devices/<device-id>`.

---

## Service URL QR Code

A **Service URL QR** encodes the device's URL field — the web interface of the device itself (e.g. a router admin panel, a NAS web UI, or a media server).

### How to generate

1. The device must have a **URL** configured (e.g. `http://192.168.1.1`, `https://nas.home.arpa:5001`)
2. Open the device detail page
3. Click the **Service QR** button (appears only if a URL is set)

This is useful for printing a label that links directly to the device's own management interface.

---

## Printed Labels

MyNet can generate a **ready-to-print PNG label** containing:

- The device name
- The primary IP address
- A QR code linking to the MyNet device page

### How to generate a label

1. Open a device detail page
2. Click **Download Label** (or the label icon in Quick Actions)
3. A PNG file is downloaded: `label_<device-name>.png`

Print this label on a **Brother P950NW** (or compatible) label printer using 24mm tape at 300 dpi.

---

## Label Dimensions

Default dimensions are optimised for **Brother P950NW, 24mm tape, 300 dpi**:

| Dimension | Default | Environment variable |
|---|---|---|
| Width | 696 px | `QR_LABEL_WIDTH_PX` |
| Height | 272 px | `QR_LABEL_HEIGHT_PX` |

To adjust for a different printer or tape size, set the environment variables in `/opt/mynet/.env` and restart the service. Or configure them in **Settings → Label Export**.

---

## Custom URL Labels

You can also generate a label for any URL and name — not just devices in MyNet. This is useful for labelling infrastructure that is not tracked in MyNet, or for printing labels for external services.

From the **QR Labels** section in Settings (or via the API at `GET /api/qr/label?url=<url>&name=<name>`), generate a label PNG for any URL/name combination.

---

*← [UniFi](unifi.md) · [Network Scanner →](network-scan.md)*
