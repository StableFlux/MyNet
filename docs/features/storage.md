<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Storage

> Move MyNet's database onto a dedicated external drive, with automatic hourly snapshots on the host filesystem as a safety net. On Raspberry Pi installs this reduces SD-card write wear; on Debian/Ubuntu servers it isolates DB I/O to its own device or makes the database portable between hosts.

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

At 85 monitored devices MyNet's scheduler writes roughly **70–100 MB/day** to SQLite. Depending on where you've installed MyNet the motivation differs:

- **Raspberry Pi** — the SD card absorbs all of that. Standard SD cards tolerate 2–4 years before write wear becomes a risk; high-endurance cards last longer but still degrade. Moving the DB to USB shifts the writes onto hardware that's easy to replace and keeps the SD read-mostly (Linux + MyNet code + hourly snapshots).
- **Debian / Ubuntu server** — the motivation is less about wear and more about separation: isolating the DB onto its own dedicated disk (external SSD, NVMe, or USB) simplifies backups, lets you move the database between hosts without re-importing, and keeps the root filesystem untouched when you want to wipe or reinstall the OS.

The SD-card snapshot layer protects against drive failure or accidental removal regardless of platform — whatever your host filesystem is, the snapshots land there.

> **Tested platforms:** end-to-end validated on Raspberry Pi OS (64-bit, Pi 3B+/4/5). The feature is platform-neutral (relies only on systemd + standard util-linux/e2fsprogs tools) and should behave identically on Debian 12+ and Ubuntu 22.04+, but those haven't been exercised on real hardware yet.

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
6. Watch the live status: snapshot → copy → verify → swap → restart. Each phase is shown in a banner above the Current Storage card.
7. When migration completes, MyNet refreshes the app. You may be prompted to log in again (and to unlock the encryption passphrase if encryption is enabled); if your session is still valid you'll land back on the dashboard.

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

MyNet watches the USB drive at two levels: the underlying block device (via `/dev/disk/by-uuid/<uuid>`, the authoritative "drive is physically present" signal) and the mount state. When either fails, the backend emits a `usb_lost` event over the WebSocket, the frontend flips the entire app into **Degraded Mode**, and a cleanup pass runs to unmount any stale kernel entry so reinsertion can remount cleanly.

The Degraded Mode screen is what you see instead of the normal UI. The exact options shown depend on *which* kind of failure MyNet detected.

### Scenario 1 — USB removed (or not mounted at boot)

*Symptom:* Headline "Database unavailable". Error detail typically "database symlink target is missing (USB unmounted?)".

1. **Retry** (primary button). Plug the drive back in first, then click Retry. MyNet stops the service, cleans up the stale mount entry, re-mounts the drive, and restarts the service. The button label reads "Recovering — restarting service…" for ~5–10 s, then you drop back into the normal UI.
2. **Restore from snapshot and switch back to SD card** (secondary button). Use this when the drive has failed or you don't have it to hand. Restores the latest SD snapshot onto the SD card directly, removes the USB symlink and mount dependency, wipes the database file from the USB drive (if it comes back), and restarts the service in SD mode. Worst-case data loss equals one snapshot interval (default 1 hour).

### Scenario 2 — USB present but database corrupt

*Symptom:* Headline "Database corrupted". Detail shows the SQLite `PRAGMA quick_check` error. MyNet runs this integrity check on every startup; if it fails, the service refuses to touch the DB and goes straight into Degraded Mode.

1. **Restore from snapshot (Nm ago)** (primary button). Overwrites the corrupt DB **in place**, keeping USB mode. Stops the service, copies the current snapshot onto the USB file, chowns it correctly, drops any stale `-shm`/`-wal` siblings, restarts.
2. **Restore from previous snapshot** (secondary, only visible when both snapshots exist). Use if the current snapshot also appears corrupt — e.g., the corruption began before the most recent snapshot was taken.
3. **Restore from snapshot and move database to SD card** (fallback). Same as Scenario 1's secondary action — gives up on the USB, wipes the DB file from it, and reverts to SD mode.

### Scenario 3 — No snapshots available

If both SD snapshots are missing (fresh install that's never run a snapshot cycle, or SD failure), Degraded Mode says so and tells you to SSH to the server. Recovery then means reinstalling and restoring a JSON backup through the first-run wizard.

### Behind the scenes

- The pull detector runs a 1-second `/proc/mounts` + device-UUID poll. Loss is detected within ~1 s.
- Recovery runs in a transient `systemd-run` scope (e.g., `mynet-storage-remount-recovery.service`, `mynet-storage-restore-snapshot.service`, `mynet-storage-revert-to-sd.service`), **outside mynet.service's cgroup**, so it can safely stop and restart the main service as part of the recovery dance. If you watch `journalctl` during a recovery click you'll briefly see these units appear and then disappear — that's normal.
- The monitoring scheduler, Pi-hole poller, conflict scanner, and cleanup job all skip their ticks whenever the USB is gone (or a migration is in progress), so nothing tries to write to a zombie filesystem. This is gated by a single `should_pause_db_access()` helper in `services/storage.py`.

---

## Returning to the SD card

1. Navigate to **Settings → Storage**.
2. Click **Move database back to SD card…**.
3. Confirm with `MIGRATE`.
4. MyNet snapshots the USB, copies it to the SD card, removes the symlink, wipes the database file from the USB drive, unmounts it, and restarts the service. The SD pre-migration anchor (24h safety net) and hourly snapshots remain if you need to roll back.
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
- **Pull mid-write has a small corruption window.** MyNet quiesces writers the moment the drive is detected as gone, but anything already in-flight to the kernel's page cache at that instant can't be taken back. The hourly SD snapshot is what covers this case — worst case you revert to the snapshot and lose ≤ 1 snapshot interval of data.
- **Reinsertion may need a moment.** If the filesystem was mid-write when pulled, the ext4 journal can take a few seconds to settle on reinsert; the Retry button polls for up to 25 s before giving up. If Retry times out, plug the drive into a desktop machine briefly to let it fsck, then try again.

---

*← [Backup & Restore](backup-restore.md) · [Users →](users.md)*
