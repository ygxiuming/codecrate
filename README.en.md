<div align="center">

<img src="web/public/favicon.svg" alt="CodeCrate" width="88" height="88">

# CodeCrate

**An intranet resource distribution platform: software packages · VS Code resources · public file zone · pickup codes · comments**

Cache once on a connected admin network. Let isolated users browse, verify and download — no internet, no user accounts required.

[![Release](https://img.shields.io/github/v/release/ygxiuming/codecrate?style=flat-square)](https://github.com/ygxiuming/codecrate/releases)
[![CI](https://github.com/ygxiuming/codecrate/actions/workflows/ci.yml/badge.svg)](https://github.com/ygxiuming/codecrate/actions/workflows/ci.yml)
[![Docker](https://github.com/ygxiuming/codecrate/actions/workflows/docker.yml/badge.svg)](https://github.com/ygxiuming/codecrate/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![GHCR](https://img.shields.io/badge/ghcr.io-ygxiuming%2Fcodecrate-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/ygxiuming/codecrate/pkgs/container/codecrate)
[![GitHub stars](https://img.shields.io/github/stars/ygxiuming/codecrate?style=social)](https://github.com/ygxiuming/codecrate)

[简体中文](README.md) ｜ [Changelog](CHANGELOG.md) ｜ [Architecture](docs/ARCHITECTURE.md) ｜ [Issues](https://github.com/ygxiuming/codecrate/issues) ｜ [Releases](https://github.com/ygxiuming/codecrate/releases)

**If CodeCrate saves you from one more offline-deployment headache, please give it a ⭐ Star.**

<img src="docs/screenshots/home.png" alt="CodeCrate home page" width="100%">

</div>

## Table of contents

- [Why CodeCrate](#why-codecrate)
- [Features](#features)
- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [Automated image builds](#automated-image-builds)
- [Configuration](#configuration)
- [Usage workflow](#usage-workflow)
- [Offline image distribution](#offline-image-distribution)
- [Security design](#security-design)
- [API overview](#api-overview)
- [Development & testing](#development--testing)
- [Directory layout](#directory-layout)
- [Backup & password reset](#backup--password-reset)
- [Known limitations](#known-limitations)
- [Data sources & compliance](#data-sources--compliance)
- [Access logs & privacy](#access-logs--privacy)
- [Support the project](#support-the-project)
- [Contributing](#contributing)
- [License](#license)

## Why CodeCrate

Air-gapped environments usually hit the same three walls:

1. **Everyday software installers** must be prepared host by host, across many platforms and architectures, with versions drifting apart.
2. **Developer resources are unreachable** — VS Code installers, the extension marketplace (`.vsix`) and Remote-SSH servers all need manual collection, and metadata is easy to lose.
3. **Day-to-day file transfer is inefficient** — temp files lack a single sharing entry point, and there is no common space everyone can see.

CodeCrate pulls all of these inside the network: software packages archived by category, VS Code resources cached in one click, a public file zone visible to everyone, private transfers via pickup codes, and a comment board for feedback. It ships a searchable public site, an authenticated admin console, job progress, integrity verification, resumable downloads, automatic expiry cleanup and access analytics — as a single Docker container.

> **CodeCrate = Code + Crate**: pack your internet-only developer resources into one crate you can carry inside.

## Features

### Public site

- Browse cached VS Code builds with platform filters, search and pagination; each build shows version, build date, platforms, size and SHA256.
- Cached extensions list name, publisher, version, engine range, categories, download count and update time; search, categories and sorting included.
- Extension drawer shows description, dependencies, extension packs and multi-version downloads.
- Remote-SSH servers listed per version/platform with commit, size and SHA256; commits resolve even for uncached versions.
- Direct browser downloads with HTTP Range resume support.
- Built-in docs: install, verify, offline extension install, Remote-SSH setup, VS Code integration, FAQ.
- Announcement modal with severity levels, pinning, scheduling and remembered dismissal.
- GitHub repo / issues / Star links in header and footer, plus an open-source callout on the home page.
- "Admin login" entry in the top-right corner.
- Optional shared access code for browsing and downloads.
- **Software packages** — archived by category with search; details carry a Markdown description and SHA256, plus a checksum file download.
- **Public file zone** — anyone can upload; remaining retention time is shown and files are deleted automatically on expiry.
- **Pickup center** — enter a pickup code to download a private transfer, no login required.
- **Board & comments** — site-wide message board plus per-package feedback, two-level threaded replies, admin pinning; comments display the intranet IPv4 automatically (masking configurable).

### Admin console

- Account + password login; scrypt hashing, DB-backed sessions, login rate limiting, same-origin checks and audit logs.
- VS Code version list with multi-version/multi-platform selection (10 mainstream platforms by default), platform availability probing and batch caching.
- **Commit lookup** — paste a commit from VS Code "About" and the matching version is resolved and selected.
- `.vsix` upload with automatic parsing: ID, name, version, publisher, engine range, dependencies, extension packs, categories, keywords, license, repository and icon.
- Official Marketplace / Open VSX dual-source search (keyword, category, downloads/updated sorting) with one-click caching; the cache dialog lists every historical version and platform-specific packages can pick a target platform.
- Remote-SSH servers tied to versions with multi-platform caching; configure a mirror for automatic downloads or upload an offline server archive manually (version and commit are read from the bundled `product.json`).
- Native Remote-SSH integration via the update-server-compatible `/api/vscode-update/commit:<commit>/server-<platform>/stable` endpoint (`remote.SSH.useOSS` + `ossDownloadUrl`), or `manual-bootstrap` for client-side download plus automatic SCP.
- **Software package management** — upload manually (name/version/platform/category/Markdown description) or drop files into `data/files/software/<category>/<name>/<version>/` for automatic scanning (a sibling `readme.md` / `<same-name>.md` is imported as the description); categories can be renamed and entries edited.
- Task center: queued/running/succeeded/failed/cancelled stats, progress, automatic backoff retries, single & bulk retry/cancel, cleanup of finished/failed jobs, failure badge reminders, failure reasons and event logs.
- Storage management: per-category usage, free disk space, per-item SHA256 verification, deletion and temp-file cleanup; one-click cache-folder scan syncs manually copied or deleted files.
- Access analytics: PV/UV/download/click/search trends, top pages/resources/searches, event details and CSV export.
- Announcement management: create, edit, publish/unpublish, delete, pin, schedule and expire.
- Audit logs and download logs.
- **VS Code gallery gateway** — together with `product.json`'s `extensionsGallery`, the client's extension panel can search and install cached extensions directly (see the built-in docs).
- **File zone management** — full control over the public zone and private pickups (uploader IP visibility, extend, revoke, delete); expired files are cleaned automatically with an audit trail.
- **Comment management** — pin, delete (with replies), bulk delete, and search by content/IP/source.
- Online settings for data sources, concurrency, upload limits, public-zone limits (size/blocklist/quota/retention), pickup validity, comment toggles and IP masking, access code and log retention — with data-source connectivity tests.

### Engineering

- Single-container design: the backend serves the built frontend; multi-stage `Dockerfile` and `docker-compose.yml` included; `data/` is bind-mounted to the host and images are built automatically for GHCR (amd64/arm64) by GitHub Actions.
- SQLite (WAL) metadata + local-volume file storage; data survives restarts.
- Adapter-based data sources make it easy to swap mirrors or support other IDEs.
- SSRF protection: http/https only, per-hop redirect validation, DNS + connect-time address checks, private ranges rejected by default.
- Download links are DB-ID based with root-directory containment against path traversal; uploads validate zip magic/entries/size against zip bombs.
- MIT license, bilingual docs, GitHub Actions CI.

## Screenshots

| VS Code installers | Extension market |
| --- | --- |
| ![VS Code](docs/screenshots/vscode.png) | ![Extensions](docs/screenshots/extensions.png) |

| Software packages | Package details (docs + feedback) |
| --- | --- |
| ![Software](docs/screenshots/software.png) | ![Software detail](docs/screenshots/software-detail.png) |

| Public file zone | Pickup center |
| --- | --- |
| ![Public zone](docs/screenshots/public-zone.png) | ![Pickup](docs/screenshots/pickup.png) |

| Board | Analytics |
| --- | --- |
| ![Board](docs/screenshots/board.png) | ![Analytics](docs/screenshots/analytics.png) |

| Software admin | File zone admin |
| --- | --- |
| ![Software admin](docs/screenshots/admin-software.png) | ![Files admin](docs/screenshots/admin-files.png) |

## Quick start

Requirements: Docker 24+ (Compose v2 for the Compose path).

### Option 1: use the published image (recommended)

```bash
docker run -d --name codecrate \
  -p 3000:3000 \
  -v "$PWD/data:/data" \
  -e ADMIN_PASSWORD='change-me-strong' \
  ghcr.io/ygxiuming/codecrate:latest
```

Open <http://<host>:3000>; the admin console is at `/admin`. If `ADMIN_PASSWORD` is omitted, a random password is printed in the logs and written to `data/initial-admin-password`.

> GHCR package visibility follows the repository. If `docker pull` returns unauthorized, check visibility on the [Packages](https://github.com/ygxiuming/codecrate/pkgs/container/codecrate) page or run `docker login ghcr.io`.

### Option 2: clone and use Compose

```bash
git clone https://github.com/ygxiuming/codecrate.git
cd codecrate
cp .env.example .env
# Edit .env: at minimum change ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f registry
```

When using the published image, set `IMAGE_NAME` in `.env` to `ghcr.io/ygxiuming/codecrate:latest`, then `docker compose pull && docker compose up -d`.

### Data persistence

- The host `./data` directory is mounted at `/data`: the SQLite database, installers, extensions, icons and Remote-SSH servers all live there; recreating or upgrading the container keeps everything.
- On startup the entrypoint fixes directory ownership as root, then immediately drops to the unprivileged `node` user (UID 1000), so wrong host-side permissions won't break SQLite or uploads.
- To relocate, set `DATA_DIR_HOST=/srv/codecrate/data` in `.env` (relative paths resolve against `docker-compose.yml`).
- `data/` is gitignored. On SELinux hosts (CentOS/RHEL) also run `chcon -Rt container_file_t ./data`.

### First login

- Public site: <http://<host>:3000>
- Admin console: <http://<host>:3000/admin>
- Default user is `admin`. **Change the password immediately** and delete `data/initial-admin-password`.

### Upgrade

```bash
# GHCR image
docker compose pull
docker compose up -d

# Local build
docker compose build --pull
docker compose up -d
```

## Automated image builds

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) builds and pushes to GHCR:

| Trigger | Tags | Notes |
| --- | --- | --- |
| Push to `main` | `main`, `sha-<short>`, `latest` | Latest default-branch image |
| Push tag `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest` | Version release; an offline deployment bundle is attached to the GitHub Release |
| Pull request | none | amd64 build validation only |
| `workflow_dispatch` | same as above | Manual trigger |

Images are built for `linux/amd64` and `linux/arm64` with SLSA provenance and SBOM. See [Releases](https://github.com/ygxiuming/codecrate/releases).

```bash
# Pull a specific version
docker pull ghcr.io/ygxiuming/codecrate:1.1.0
```

> Compose keeps `build:` alongside `image:`; without `IMAGE_NAME`, `docker compose up -d --build` still builds locally, which suits fully offline environments.

## Configuration

`.env` is read by Docker Compose; local development uses environment variables directly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PORT` | `3000` | Published host port |
| `DATA_DIR_HOST` | `./data` | Host data directory mounted at `/data` |
| `IMAGE_NAME` | `codecrate:1.1.0` | Image used by Compose (GHCR address allowed) |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `/data` | Data root |
| `STORAGE_DIR` | `$DATA_DIR/files` | Artifact storage |
| `DB_PATH` | `$DATA_DIR/registry.db` | SQLite path |
| `WEB_DIST` | `/app/web/dist` | Built frontend assets |
| `SITE_NAME` | `CodeCrate 离线部署源` | Public site name |
| `ADMIN_USERNAME` | `admin` | Bootstrap admin |
| `ADMIN_PASSWORD` | empty | Random password if unset (≥10 chars) |
| `PUBLIC_ORIGIN` | empty | Canonical public URL for origin checks and docs |
| `ALLOWED_ORIGINS` | empty | Extra allowed write origins (comma-separated) |
| `TRUST_PROXY` | `false` | Number of trusted proxy hops |
| `COOKIE_SECURE` | `auto` | Cookie Secure: `auto`/`always`/`never` |
| `NETWORK_ALLOWED_PRIVATE_HOSTS` | empty | Explicitly allowed intranet source hosts (supports `*.example.com`) |
| `CACHE_CONCURRENCY` | `3` | Concurrent cache jobs (1–16) |
| `DOWNLOAD_CONCURRENCY_PER_IP` | `4` | Per-IP concurrent downloads |
| `UPLOAD_MAX_BYTES` | `209715200` | `.vsix` upload limit (200 MB) |
| `ACCESS_LOG_ENABLED` | `true` | Enable access logging |
| `ACCESS_LOG_RETENTION_DAYS` | `90` | Access log retention (0 = forever) |
| `CLAMSCAN_PATH` | empty | Optional ClamAV `clamscan` path |
| `SOURCE_TIMEOUT_MS` | `30000` | Upstream metadata timeout |
| `LOG_LEVEL` | `info` | pino log level |
| `TZ` | `Asia/Shanghai` | Container timezone |

Some options (data sources, concurrency, upload limits, access code, log retention) can also be changed in the admin console under "System settings".

### Reverse proxy & HTTPS

Nginx example:

```nginx
server {
  listen 443 ssl;
  server_name registry.corp.local;

  client_max_body_size 500m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
  }
}
```

Set `TRUST_PROXY=1` and `COOKIE_SECURE=auto`. If the proxy rewrites `Host` and login complains about cross-site requests, set `PUBLIC_ORIGIN=https://registry.corp.local` or add the browser origin to `ALLOWED_ORIGINS`. Trust only one proxy hop to prevent forged `X-Forwarded-For` headers.

### Proxy fake-IP mode & SSRF protection

Clash/Surge fake-IP maps public hostnames into `198.18.0.0/15`, which the SSRF guard rejects by default (loopback/private/reserved range). If collection through the proxy is intended, allow the official hosts explicitly:

```bash
NETWORK_ALLOWED_PRIVATE_HOSTS=update.code.visualstudio.com,*.microsoft.com,*.visualstudio.com,*.vsassets.io,*.open-vsx.org,*.eclipsecontent.org
```

Add intranet mirror hosts to the same list. The default allowlist is empty; unconfigured deployments keep rejecting private/reserved addresses.

## Usage workflow

### Admin

1. Log in at `/admin` and change the bootstrap password.
2. "VS Code cache": pick versions and platforms, optionally probe availability, then batch-create tasks.
3. "Extension admin": upload `.vsix` files, or search the marketplace and cache with one click.
4. "Remote-SSH cache": pick the version matching your client and cache servers for the remote architectures.
5. "Software admin": upload packages with a description, or drop files into `data/files/software/` for automatic scanning.
6. "File zone admin": review uploader IPs in the public zone and private pickups; extend, revoke or delete as needed.
7. "Comment admin": pin useful messages and remove abusive ones (replies included).
8. "Task center" shows progress and failure reasons; failed jobs can be retried.
9. "Storage admin" verifies SHA256 and prunes old versions periodically.
10. "System settings" configures data sources, access code, zone/pickup/comment policies and log retention.

### End users

1. Download the matching platform from "VS Code" and verify with the SHA256 shown on the page.
2. Download `.vsix` files from "Extensions" and install with `code --install-extension xxx.vsix`.
3. Follow "Docs → Remote-SSH" to pre-stage servers and configure the client.
4. Grab everyday software from "Packages" by category; details carry a description and SHA256.
5. Upload temp files to the "Public zone" (visible to everyone, auto-cleaned on expiry); for private files create a pickup code under "Public zone → Private transfer" and share it — the recipient downloads from "Pickup" without logging in.
6. Ask questions or request resources on the "Board"; if the access code is enabled, enter it first.

Full install/verify/extension/Remote-SSH/troubleshooting docs are built into `/docs`.

## Offline image distribution

Build or pull the image on a connected, Docker-capable machine:

```bash
# Option A: export a locally built image
docker compose build
docker save codecrate:1.1.0 | gzip > registry-image.tar.gz

# Option B: export the published image
docker pull ghcr.io/ygxiuming/codecrate:1.1.0
docker save ghcr.io/ygxiuming/codecrate:1.1.0 | gzip > registry-image.tar.gz
```

Carry `registry-image.tar.gz`, `docker-compose.yml` and `.env.example` into the isolated network:

```bash
gunzip -c registry-image.tar.gz | docker load
cp .env.example .env
# If you imported the GHCR image, set IMAGE_NAME to ghcr.io/ygxiuming/codecrate:1.1.0
docker compose up -d
```

> `data/` doesn't need to be created in advance: the container creates it and fixes ownership on startup. When Compose has both `image:` and `build:`, `up` reuses an existing local image; run `docker compose build` explicitly to rebuild.

## Security design

- **Auth**: scrypt (N=16384, r=8, p=1) + `timingSafeEqual`; sessions store only the SHA256 of the token; HttpOnly + SameSite=Lax; 12-hour expiry; login rate limit of 5 attempts / 15 minutes.
- **CSRF**: write operations validate `Origin/Referer` same-origin; non-browser clients must send `X-Requested-With: XMLHttpRequest`.
- **SSRF**: http/https only, URL credentials rejected; full DNS resolution rejects loopback/private/link-local/CGNAT/multicast/reserved ranges (IPv6 and v4-mapped included); redirects (≤5 hops) re-validated per hop; a custom `undici` `lookup` binds the validated IP at connect time to prevent DNS rebinding.
- **Uploads**: size/extension/zip magic/required entries/decompression budget checks; random temp names + atomic moves; archives are not fully extracted; optional ClamAV.
- **Public zone**: uploads limited by size/blocklist/total quota/frequency (all configurable); filenames sanitized and stored under a constrained root; expired files are deleted automatically with an audit trail; pickup codes are scrypt-hashed, redemption is rate-limited against brute force, and downloads use short-lived HMAC tokens.
- **Downloads**: routes accept only DB primary keys; relative paths with root containment; `nosniff`; per-IP concurrency limit.
- **Headers**: Helmet CSP, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`.
- **Audit**: logins, password changes, caching, uploads, deletions, verifications and setting changes are all recorded.

To report a security issue see [SECURITY.md](SECURITY.md) — please don't open public issues with exploitable details.

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/public/config` | Site config and access-code switch |
| `GET` | `/api/public/vscode` | Cached VS Code builds (aggregated per platform) |
| `GET` | `/api/public/extensions` | Extension list (search/category/sort/pagination) |
| `GET` | `/api/public/extensions/:id/versions` | Extension versions |
| `GET` | `/api/public/remote-servers` | Remote-SSH server list |
| `GET` | `/api/public/announcements` | Currently effective announcements |
| `GET` | `/api/public/software` | Software package list (search/category/pagination) |
| `GET` | `/api/public/files` | Public-zone file list |
| `POST` | `/api/public/files` | Public-zone upload |
| `POST` | `/api/public/share` | Upload and create a pickup code |
| `POST` | `/api/share/redeem` | Redeem a pickup code for a download link |
| `GET` | `/api/public/comments` · `POST` | Read/post comments (board and package details) |
| `GET` | `/api/download/:type/:id` | Download (Range/ETag; type includes software/public-file) |
| `GET` | `/api/vscode-update/commit:<commit>/server-<platform>/stable` | Remote-SSH-compatible server path |
| `POST` | `/api/gallery/extensionquery` | VS Code gallery-compatible search |
| `GET` | `/api/gallery/publishers/:publisher/vsextensions/:name/:version/vspackage` | Gallery-compatible download |
| `POST` | `/api/events` | Batched view/click/search events |
| `POST` | `/api/auth/login` | Admin login |
| `GET` | `/api/admin/overview` | Admin overview |
| `POST` | `/api/admin/vscode/cache` | Batch-cache VS Code |
| `POST` | `/api/admin/vscode/commit-lookup` | Commit → version lookup |
| `GET/POST` | `/api/admin/announcements` | List/create announcements |
| `PUT/DELETE` | `/api/admin/announcements/:id` | Update/delete announcement |
| `POST` | `/api/admin/extensions/upload` | Upload `.vsix` |
| `GET` | `/api/admin/marketplace/search` | Marketplace search |
| `POST` | `/api/admin/marketplace/cache` | Marketplace cache |
| `POST` | `/api/admin/remote/cache` | Cache server |
| `POST` | `/api/admin/remote/upload` | Upload server archive manually |
| `POST` | `/api/admin/software/upload` | Upload a software package |
| `POST` | `/api/admin/software/scan` | Scan the software directory |
| `GET/PUT/DELETE` | `/api/admin/files/public·shares/:id` | File-zone management (extend/revoke/delete) |
| `GET` | `/api/admin/comments` · `PUT/:id/pin` | Comment management/pinning |
| `GET` | `/api/admin/tasks/stats` · `POST /clear` | Task stats/cleanup |
| `POST` | `/api/admin/storage/scan` | Scan cache folder and sync the index |
| `GET` | `/api/admin/tasks` | Task list |
| `POST` | `/api/admin/tasks/:id/retry` | Retry task |
| `GET` | `/api/admin/analytics/overview` | Access analytics |
| `GET` | `/api/admin/access-events` | Access event details |
| `GET/PUT` | `/api/admin/settings` | System settings |

Full routes and validation logic live in [`server/src/routes/`](server/src/routes/).

## Development & testing

Requires Node.js ≥ 22.

```bash
npm install
ADMIN_PASSWORD='dev-password-123' npm run dev
```

- Backend: <http://127.0.0.1:3000>
- Frontend: <http://127.0.0.1:5173> (Vite proxies `/api` and `/icons`)
- Data directory: `./data`
- Production build: `npm run build && npm start`

```bash
npm run typecheck   # server + web type checks
npm run lint        # ESLint
npm test            # unit & integration tests
npm run build       # frontend + backend build
```

Integration tests use a local mock source (`127.0.0.1` is explicitly allowlisted for SSRF) and cover:

- Admin login, 401s and CSRF interception;
- VS Code batch cache → download → Range resume → download counting;
- Page view/click/search events, UV dedup, IP and visitor identity, CSV export, retention cleanup;
- `.vsix` upload, metadata parsing, icons and duplicate conflicts;
- Official marketplace and Open VSX caching (including gzip vsix parsing and SHA256 verification);
- Remote-SSH commit resolution and server downloads;
- Storage stats, SHA256 verification, artifact deletion and temp-file cleanup;
- Software packages: upload/directory scan/metadata edit/category rename/delete and Range downloads;
- Board & package comments: flattened two-level replies, pinning order, delete-with-replies, comment toggle and IP masking;
- Public file zone: upload/download/blocklist/quota/expiry cleanup and cross-resource upload dedup;
- Pickup codes: custom codes, redemption, token downloads, download caps, revocation and expiry cleanup;
- Access-code toggle and admin bypass.

## Directory layout

```text
.
├── server/                 # Express + SQLite backend
│   ├── src/
│   │   ├── adapters/       # VS Code / Marketplace / Open VSX / Remote-SSH
│   │   ├── analytics/      # Access events, stats, retention cleanup
│   │   ├── auth/           # Passwords, sessions, CSRF, rate limits
│   │   ├── db/             # Connection and migrations
│   │   ├── net/            # SSRF-safe fetch / IP checks
│   │   ├── routes/         # public / admin / downloads / events
│   │   ├── services/       # Downloader, task queue, vsix parsing, icons, software, file zone/pickup, comments
│   │   └── storage/        # Path containment, integrity, usage
│   └── test/               # vitest unit & integration tests
├── web/                    # React + Vite + Ant Design
│   └── src/
│       ├── pages/          # Public and /admin pages
│       ├── components/     # Layouts, charts, download buttons, etc.
│       └── content/docs/   # Built-in Chinese docs
├── docs/ARCHITECTURE.md
├── Dockerfile
├── docker/entrypoint.sh
├── docker-compose.yml
└── .env.example
```

## Backup & password reset

```bash
# Offline backup (SQLite plus all cached artifacts; adjust data/ if DATA_DIR_HOST changed)
docker compose stop
tar -czf registry-backup-$(date +%F).tar.gz data/
docker compose start
```

```bash
# Forgot the admin password (run as the app user to avoid root-owned files)
docker compose exec -u node -e ADMIN_PASSWORD='new-strong-password' registry \
  node server/dist/cli/reset-admin.js
```

A reset updates the hash and invalidates all existing sessions.

## Known limitations

- Single admin account (no multi-user RBAC); front the admin console with an SSO proxy if per-person auditing is needed.
- Extension search uses SQL `LIKE` + indexes, not FTS5; performance is fine up to thousands of extensions.
- Stable channel only; Insiders is not covered.
- Gallery integration requires editing the client's `product.json`; behavior varies across versions/platforms and may affect official signing and auto-update — test on a small scale first.
- Commit lookup probes the last 150 stable releases by default; for older versions search by version number.
- Storage backend is a local volume; S3/object storage is not supported.
- Extension signature chains are not verified (SHA256 integrity checks are implemented).
- Time trends aggregate by UTC date, while page times render in the browser's local timezone.

## Data sources & compliance

| Type | Default source | Configurable |
| --- | --- | --- |
| VS Code builds/installers | `update.code.visualstudio.com` | Admin settings or env vars |
| Extension marketplace | Official Marketplace | Switchable to Open VSX |
| Remote-SSH servers | `update.code.visualstudio.com` | Admin settings |

**Important**

- This project is not affiliated with Microsoft and does not use its trademarks as endorsement.
- The official Marketplace gallery API primarily serves VS Code clients; third-party clients may be subject to its terms. Switch to Open VSX or rely on manually uploaded `.vsix` files where compliance matters.
- The repository ships no Microsoft binaries, extension packages or keys; all resources are collected by the deployer in their own environment.
- Respect your organization's policies and the upstream data sources' terms.

## Access logs & privacy

- Public browsing, search, click and real-download events are stored in SQLite:
  - Each event records full IPv4/IPv6, User-Agent, Referer, an anonymous visitor ID and the timestamp;
  - Download events add the resource, byte count, HTTP status and duration;
  - Request bodies, passwords and cookie contents are never recorded.
- The anonymous visitor ID is a server-signed HttpOnly cookie (`vr_vid`) used only for UV counts and dedup — not cross-site tracking.
- Retention defaults to 90 days and can be set to 30/90/180 days or forever; overdue data is cleaned daily at 03:00.
- Set `ACCESS_LOG_ENABLED=false` or use the admin toggle to disable entirely.
- Admin operations never enter visitor analytics; they go to the audit log only.
- Deployers should inform users according to their organization's policy and pick a sensible retention window.

## Support the project

CodeCrate is MIT-licensed and maintained in the open:

- ⭐ Star the [GitHub repository](https://github.com/ygxiuming/codecrate) so more teams that need intranet distribution can find it;
- Share it with colleagues stuck on offline VS Code installs, an unreachable marketplace or Remote-SSH server downloads;
- Report problems and ideas in [Issues](https://github.com/ygxiuming/codecrate/issues), or send a pull request;
- Keep the GitHub entry in the public header/footer after deploying so the next user can find upstream.

## Contributing

Issues and pull requests are welcome:

- Please search existing [Issues](https://github.com/ygxiuming/codecrate/issues) first to avoid duplicates.
- Use the [Bug template](https://github.com/ygxiuming/codecrate/issues/new?template=bug_report.yml) with version, deployment mode and logs.
- Use the [Feature template](https://github.com/ygxiuming/codecrate/issues/new?template=feature_request.yml) for ideas.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before coding, and make sure `npm run typecheck && npm run lint && npm test && npm run build` passes.
- By participating you agree to the [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 CodeCrate contributors

VS Code and Visual Studio Marketplace are trademarks of Microsoft Corporation. This is an independent third-party tool with no affiliation to Microsoft.
