<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Backup & Restore

> Export a complete snapshot of your MyNet data to a JSON file. Restore it on the same instance or migrate to a new server. Factory reset returns the system to a blank state.

> **Not the same thing as hourly SD snapshots.** The Backup & Restore feature is a manual JSON export you download to your browser, designed for archival and cross-version migrations. The hourly snapshots written by the [Storage](storage.md) feature are raw SQLite binaries written to the SD card to protect against USB failure; they don't leave the server unless you download them explicitly.

---

## Contents

- [Exporting a Backup](#exporting-a-backup)
- [What is Included](#what-is-included)
- [What is Not Included](#what-is-not-included)
- [Importing a Backup](#importing-a-backup)
- [Restoring During First Run](#restoring-during-first-run)
- [Factory Reset](#factory-reset)
- [Security Warning](#security-warning)

---

## Exporting a Backup

Navigate to **Settings → Backup & Restore** (`/backup`).

Click **Download JSON Backup**. A file named `mynet-backup-YYYY-MM-DD-HHMMSS.json` is saved to your browser's download folder.

An event is logged recording that a backup was downloaded, with the timestamp and your username.

> **Requires Admin role.**

---

## What is Included

The backup contains a complete snapshot of:

| Data | Details |
|---|---|
| **System settings** | System name, auth settings, colors, DNS domain, MyNet URL, UniFi config |
| **Users** | All user accounts with bcrypt-hashed passwords |
| **Networks** | All VLANs, subnets, DNS config, SSID lists |
| **Device types** | All built-in and custom device types |
| **Locations** | Full location hierarchy with parent relationships |
| **Devices** | All device records including all fields |
| **NICs** | All network interfaces with IP, MAC, DNS, switch port assignments |
| **Switch ports** | All switch port definitions |
| **WAN configs** | All WAN port configurations |

---

## What is Not Included

The following are intentionally excluded:

| Excluded | Reason |
|---|---|
| **Monitoring results** | High-volume time-series data — not useful to migrate |
| **Events** | Historical log — not useful to migrate |
| **Pi-hole cache** | Ephemeral, re-populated automatically |
| **Encryption keys** | Keys are derived from your passphrase — never stored anywhere |

> **Important:** If encryption is enabled, device passwords are exported as **ciphertext**. Restoring this backup on a different instance (with a different passphrase or no encryption) will leave those password fields unreadable. You would need to re-enter passwords after restore.

---

## Importing a Backup

> ⚠️ **This is a destructive operation.** All current data is deleted before the backup is restored. There is no undo.

1. Navigate to **Settings → Backup & Restore**
2. Click **Choose Backup File…**
3. Select your `.json` backup file
4. Confirm the warning dialog

MyNet will:
1. Delete all existing devices, networks, NICs, users, locations, settings, and switch ports
2. Restore everything from the backup file
3. Re-seed the standard device types (merging with any custom types in the backup)
4. Invalidate all active sessions (including your own — you will need to log in again)

When complete, a summary shows how many records were restored in each category.

> **Requires Admin role.**

---

## Restoring During First Run

If you are setting up a new MyNet instance and want to restore from a backup rather than starting fresh:

1. Complete the installation (`sudo bash setup.sh`)
2. Open MyNet in your browser — you will see the first-run setup screen
3. Click **Restore from backup** instead of creating a new account
4. Upload your backup file

The restore runs before any users are created, so the restored users (including your admin account) will be available to log in with immediately.

---

## Factory Reset

> ⚠️ **Permanently destroys all data.** There is no undo. Take a backup first if you have any data you want to keep.

1. Navigate to **Settings → Backup & Restore** (scroll to the bottom)
2. Click **Factory Reset**
3. Type `RESET` in the confirmation field
4. Click **Confirm Reset**

After reset:
- All devices, networks, locations, users, and settings are deleted
- **Integration credentials are cleared** — UniFi (host, API key, username, password, write-enabled flag) and Pi-hole passwords are wiped, and any in-memory session caches held by those integrations are dropped
- Standard device types are re-seeded
- The system returns to the first-run setup state
- You are logged out

> **Requires Admin role.**

---

## Security Warning

Backup files contain sensitive data:

- **Password hashes** for all user accounts
- **Device credentials** (plaintext if encryption was not enabled; ciphertext if it was)
- **UniFi credentials** stored in system settings
- **Pi-hole passwords** for managed Pi-hole devices

**Store backups securely.** Do not share backup files, post them publicly, or leave them in unsecured locations. Treat a backup with the same care as a password vault export.

---

*← [Search](search.md) · [Users →](users.md)*
