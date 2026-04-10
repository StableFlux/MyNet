# Security Policy

## Scope

MyNet is designed to run on a private LAN and is not intended to be exposed to the public internet. The primary threat model is an attacker with access to your local network.

## Supported versions

Only the latest commit on `main` is supported. There are no versioned releases at this time.

## Reporting a vulnerability

If you discover a security vulnerability, please **do not open a public issue**.

Instead, report it via GitHub's private vulnerability reporting:
[https://github.com/StableFlux/MyNet/security/advisories/new](https://github.com/StableFlux/MyNet/security/advisories/new)

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix, if you have one

You can expect an acknowledgement within a few days and a fix or response within a reasonable timeframe depending on severity.

## Security notes

- Authentication can be enabled/disabled in Settings — enable it if anyone else has access to your LAN
- Credential encryption (AES-128-CBC via Fernet, PBKDF2-HMAC-SHA256 key derivation) is optional but recommended if you store device passwords
- The SQLite database file contains all device data including any stored credentials — restrict file system access accordingly
- MyNet should be run behind a reverse proxy (nginx) if exposed beyond localhost
