<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Storage

> Move MyNet's database to a dedicated USB drive to reduce SD-card write wear on Raspberry Pi installs. Automatic hourly snapshots to the SD card protect against USB failure or accidental removal.

---

## Contents

- [Why](#why)
- [How it works](#how-it-works)
- [Activating USB storage](#activating-usb-storage)
- [Using an existing MyNet USB on a new server](#using-an-existing-mynet-usb-on-a-new-server)
- [Snapshots](#snapshots)
- [Recovery](#recovery)
- [Returning to the SD card](#returning-to-the-sd-card)
- [Uninstall](#uninstall)
- [Limitations](#limitations)

---

## Why

At 85 monitored devices MyNet's scheduler writes roughly **70–100 MB/day** to SQLite. On a Raspberry Pi, the SD card absorbs all of that. Standard SD cards tolerate 2–4 years of this before write wear becomes a risk; high-endurance cards last longer but still degrade.

Moving the database to a USB drive shifts the write load onto hardware that's easy to replace, and keeps the SD card read-mostly (Linux + MyNet code + hourly snapshots).

---

## How it works

MyNet's production install keeps `DB_PATH` at `/opt/mynet/data/mynet.db` regardless of storage mode:

- **SD mode (default)** — the path is a regular file on the SD card.
- **USB mode** — the path becomes a symlink pointing at `/mnt/mynet-storage/mynet.db` on a dedicated USB drive.

Runtime code never branches on storage mode; only the symlink target changes.

**Hourly snapshots** are written to `/opt/mynet/data/snapshots/` on the SD card. Two rotating files are kept (`mynet-current.db` + `mynet-previous.db`) so a single corrupted snapshot can't destroy the last good copy. The snapshot is taken via SQLite's online backup API, so no downtime for writers.

A privileged helper (`/usr/local/bin/mynet-storage`) handles the mount / format / symlink operations under a narrow `sudoers` rule. The MyNet backend never runs as root.

---

## Activating USB storage

**Requirements**
- A dedicated USB drive. MyNet will format it as **ext4** with label `MYNET-STORAGE`.
- The drive must be at least **twice the size of your current database** (for snapshot headroom).
- Supported platforms: Raspberry Pi OS / Ubuntu / Debian with systemd. Docker dev environments can't activate USB mode.

**Warning — read before proceeding**

> **Never insert or remove the USB drive while the server is powered on.** Doing so will corrupt your database. MyNet monitors for drive removal and will pause writes if the drive disappears, but corruption may already have started by the time the signal is detected.

**Steps**

1. Plug the USB drive into the server.
2. Navigate to **Settings → Storage** (`/settings/storage`).
3. In the **USB drives detected** section, your drive appears.
   - If it's already formatted as ext4, click **Select**.
   - If it's a different filesystem (exFAT, NTFS, FAT32), click **Initialise (erase)** to format it as ext4. *All existing data on the drive is destroyed.*
4. Click **Move database to USB…**
5. Read the warning modal. Type `MIGRATE` in the confirmation box, then click **Start migration**.
6. Watch the live status: snapshot → copy → verify → swap → restart.
7. The service restarts during the swap. If encryption is enabled you'll be prompted to unlock.

After migration:
- The SD card now holds only snapshots + MyNet's own files.
- The USB-mode warning banner is permanently visible in **Settings → Storage** until you revert to SD mode.

---

## Using an existing MyNet USB on a new server

The USB carries a full MyNet database with users, encryption salt, and all configuration. If you rebuild or replace your server:

1. Install MyNet fresh with `sudo bash setup.sh`.
2. On first boot, plug the USB in **before** opening the setup wizard in your browser.
3. The wizard shows a **USB database detected** screen instead of the normal create-admin form.
4. Click **Use this database**. The USB is mounted, the symlink swaps, the service restarts, and the browser is redirected to the login page.
5. Log in with your existing credentials. If encryption was enabled, enter the passphrase.

**Start fresh** is also offered — it dismisses the gate and takes you to the standard wizard; the USB stays unmounted and can be attached later via Settings.

---

## Snapshots

Snapshots are **point-in-time copies** of the live database, taken while writers are active (SQLite online backup API). They are **not** the same as the JSON Backup & Restore feature:

| | Hourly snapshot | JSON Backup & Restore |
|---|---|---|
| Format | Raw SQLite binary | JSON export |
| Location | `/opt/mynet/data/snapshots/` on SD | Downloaded to your browser |
| Trigger | Automatic | Manual |
| Use case | Recovery from USB failure | Migrations, off-device archive |
| Encryption | Preserved (DB is opaque) | Ciphertext (requires same passphrase to decrypt) |

**Interval** is configurable in Settings: 15 minutes / 30 minutes / 1 hour / 6 hours. Default 1 hour. Higher frequency reduces the worst-case data-loss window but increases SD wear.

**Snapshot now** forces an out-of-cycle snapshot. Useful before you make a large change and want a fresh anchor.

**Download latest snapshot** streams `mynet-current.db` to your browser as a regular SQLite file. Admin only. Useful for off-device backup paranoia.

Snapshots skip themselves when a migration is in progress or when the USB has been pulled — the pause is logged and resumes on the next scheduled tick.

---

## Recovery

If the USB drive is pulled, fails, or simply isn't mounted when the server starts, MyNet enters **degraded mode**:

- The UI shows a single "Database unavailable" screen instead of the normal application.
- Three recovery options are offered:
  - **Retry** — MyNet re-checks whether the drive has been re-inserted. Use this first; most accidental pulls can be fixed by plugging the drive back in and retrying.
  - **Restore from snapshot** — copies the most recent SD snapshot to the SD card, removes the USB symlink and mount dependency, and restarts MyNet in SD mode. At most one snapshot interval of data is lost.
  - *Manual recovery* — for situations where both the USB and the SD snapshots are unavailable, SSH to the server and restore a JSON backup through the setup wizard.

MyNet also detects USB removal **while running** via `/proc/mounts` polling. When the drive disappears, the monitoring scheduler pauses and a banner appears in the UI until the drive is re-inserted or the user chooses to restore from snapshot.

---

## Returning to the SD card

1. Navigate to **Settings → Storage**.
2. Click **Move database back to SD card…**.
3. Confirm with `MIGRATE`.
4. MyNet snapshots the USB, copies it to the SD card, removes the symlink, unmounts the USB, and restarts the service.
5. The USB can now be safely removed.

---

## Uninstall

If you uninstall MyNet while USB storage is active, `uninstall.sh` asks what to do with the USB-resident data:

- **Copy back to SD** (default) — copies the database to SD before teardown. The copy is then removed along with the rest of `/opt/mynet/` as part of uninstall.
- **Leave on USB** — the database stays on the USB drive. The drive remains portable and can seed a fresh MyNet install later.
- **Delete from USB** — wipes the database file from the USB.

---

## Limitations

- **ext4 only.** exFAT / NTFS / FAT32 are rejected because SQLite's write semantics aren't safe on those filesystems. Drives in those formats can be initialised as ext4 from Settings (erasing existing data).
- **Single drive.** MyNet uses one dedicated USB drive per install.
- **Feature disabled outside systemd Linux.** Docker dev environments and non-systemd hosts hide the Storage section entirely.
- **Creating a WLAN from a MyNet-only SSID on UniFi** — unrelated to Storage; noted here because the two features occupy similar mental space. The UniFi "Add to UniFi" button for SSIDs is still a follow-up; see [UniFi Integration](unifi.md).

---

*← [Backup & Restore](backup-restore.md) · [Users →](users.md)*
