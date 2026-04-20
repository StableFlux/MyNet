<div align="center">
  <img src="../../site/frontend/public/logo.png" alt="MyNet" width="200" />
</div>

# Users & Roles

> MyNet supports multiple users with three permission levels. Admins can create and manage user accounts, assign roles, and enable or disable access.

---

## Contents

- [Roles & Permissions](#roles--permissions)
- [User Management](#user-management)
- [Creating a User](#creating-a-user)
- [Editing a User](#editing-a-user)
- [Disabling & Deleting Users](#disabling--deleting-users)
- [Authentication](#authentication)
- [Disabling Authentication](#disabling-authentication)

---

## Roles & Permissions

| Permission | Viewer | Editor | Admin |
|---|---|---|---|
| View all devices, networks, events | ✓ | ✓ | ✓ |
| View device credentials | — | ✓ | ✓ |
| Create, edit, delete devices | — | ✓ | ✓ |
| Create, edit, delete networks | — | ✓ | ✓ |
| Acknowledge events | — | ✓ | ✓ |
| Trigger on-demand ping | — | ✓ | ✓ |
| Manage locations | — | ✓ | ✓ |
| Manage switch ports | — | ✓ | ✓ |
| Run network scan | — | — | ✓ |
| Manage users | — | — | ✓ |
| Change system settings | — | — | ✓ |
| Enable/disable encryption | — | — | ✓ |
| Export/import backup | — | — | ✓ |
| Factory reset | — | — | ✓ |
| Manage UniFi / Pi-hole integration | — | — | ✓ |
| Manage USB Storage (migration, snapshots, download) | — | — | ✓ |

---

## User Management

Navigate to **Settings → Users** (`/users`).

The user list shows:

- Username and display name
- Email (if set)
- Role badge
- Last login timestamp
- Active/inactive status
- Edit and delete buttons

> **Requires Admin role to access.**

---

## Creating a User

Click **+ Add User** on the Users page.

| Field | Rules |
|---|---|
| **Username** | 1–50 characters, lowercase. Unique. Cannot be changed after creation. |
| **Display Name** | 1–100 characters. Shown in the UI and event log. |
| **Password** | 8–128 characters. |
| **Email** | Optional. Must be a valid email format if provided. |
| **Role** | Viewer, Editor, or Admin |

The new user can log in immediately at the MyNet login page.

---

## Editing a User

Click the edit icon on any user row. You can change:

| Field | Notes |
|---|---|
| **Display Name** | |
| **Email** | |
| **Role** | Cannot demote the last active admin |
| **Password** | Leave blank to keep the existing password |
| **Active** | Toggle to enable or disable the account |

> You cannot change a username after it is created.

---

## Disabling & Deleting Users

**Disable:** Prevents the user from logging in without deleting their account or history. All events attributed to this user are preserved. Use this when someone leaves rather than deleting the account.

**Delete:** Permanently removes the user account. Events attributed to this user retain the username string for historical accuracy.

**Safety guards:**

- You cannot delete your own account
- You cannot delete or demote the last active Admin — there must always be at least one active admin
- These guards apply to both the delete button and role change in the editor

---

## Authentication

MyNet uses **JWT tokens** stored as `httpOnly` cookies. Sessions expire after 8 hours by default (configurable via `JWT_EXPIRE_MINUTES` in `.env`).

**Login security:**

- Passwords are hashed with bcrypt (passlib)
- Login is rate-limited: **10 attempts per 60 seconds per IP address**
- After exceeding the limit, the IP is locked out for 5 minutes
- All login attempts are processed in constant time to prevent username enumeration via timing

**WebSocket connections** (used for real-time monitoring updates) require the same JWT token, passed as a query parameter or cookie.

---

## Disabling Authentication

For trusted, single-user LAN setups, you can turn off authentication entirely in **Settings → General**:

- Toggle **Require Login** off
- All UI and API requests are allowed without a session

> **Important:** Authentication cannot be disabled while [encryption](settings.md#encryption) is enabled. Disable encryption first, then disable auth if needed.

When auth is disabled, the login page is bypassed and all users have full admin access. Re-enable auth at any time from the Settings page.

---

*← [Backup & Restore](backup-restore.md) · [Settings →](settings.md)*
