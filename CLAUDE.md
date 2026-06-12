# reitrn Video Agent

Electron tray app (zero-config, no settings UI) for warehouse inspection-station
PCs. Receives webcam inspection videos recorded in the browser, queues them on
disk, and uploads them to R2 via ReturnHub. Repo: github.com/reitrn/reitrn-video-agent.
Windows-only. Current version 1.0.3.

## Working rules (regression prevention)

This runs unattended on live warehouse station PCs — a broken release silently
stops video evidence from uploading.

1. **Plain JS, no compiler net**: after ANY change, run `node --check` on every
   touched file and start the app (`npm start`) before declaring done. CI
   syntax-checks all JS on push (`.github/workflows/ci.yml`).
2. **One concern per change**; do not reformat or refactor adjacent code.
3. The store-and-forward pipeline (watch folder → upload → orphan backup) is the
   product. Never make an upload path that can drop a file on failure — files
   move to `orphaned/`, never get deleted on error.
4. Releases ship via tag-triggered build (`v*`); warehouse PCs don't auto-update
   — coordinate installs with the user.

## Stack

- Electron 31 + electron-builder (NSIS, publishes GitHub releases to
  `reitrn/video-agent` — note repo name in `package.json` `publish` block)
- `busboy` (multipart parsing), `chokidar` (folder watching). No renderer/window —
  tray only.

## How it works

1. ReturnHub in the browser records webcam video at the inspection station and
   POSTs it to the agent: **HTTPS server on port 3011** (`src/server.js`,
   `0.0.0.0`, cert for `local.reitrn.com` bundled in `assets/` — self-contained,
   no print-agent dependency). Endpoints: `/ping`, `POST /queue-video`
   (multipart: `sidecar` JSON field + webm file, 2GB limit).
2. Files land in **`C:\reitrn-uploads`** as `<name>.webm` + `<name>.json` sidecar
   (inspectionId, storagePath, sessionId, staffName, …).
3. `src/watcher.js` (chokidar on `*.json`) queues uploads: concurrency 2, retry 5x
   with exponential backoff, re-enqueue after 5 min if all retries fail. Files are
   deleted only after successful upload.
4. `src/uploader.js` uploads via **ReturnHub** (app.reitrn.com): get R2 signed URL
   (`/api/storage/r2-signed-url`) → streamed PUT webm to R2 (stall-based
   timeout: aborts only if no bytes move for 2 min, 60 min absolute cap) → mark
   uploaded in Firestore (`/api/storage/mark-uploaded`). Auth via `X-Agent-Key`
   header (key baked into `src/config.js` at build time — never copy it into docs).

## Commands

- `npm start` — run locally
- `npm run build` — installer, no publish
- `npm run build:release` — build and publish GitHub release

## Decisions & gotchas

- **Zero-config install**: setup screen was removed; all config is baked into
  `src/config.js` (watch folder, hub URL, agent key). Change there before building.
- **Orphan backup upload**: a `.webm` with no `.json` sidecar (after 60s grace,
  scanned every 2 min) is uploaded to `orphaned/<filename>` in R2 so no video is
  ever lost. Normal flow waits up to 30s for the webm after seeing the sidecar.
- Logs go to **`C:\reitrn-uploads\agent.log.txt`** (deliberate — visible to staff
  next to the videos). Tray menu has "Open upload folder".
- Tray icon is **white** to distinguish it from the print agent in the same tray.
- All API `fetch` calls are wrapped in 30s abort timeouts; the R2 PUT uses a
  streamed `https.request` with a stall-based timeout instead — Node's `fetch`
  has a hidden 5-minute `headersTimeout` (R2 sends headers only after the full
  body arrives) that made any upload longer than 5 min impossible (v1.0.5 fix).
  Keep timeouts on any new network call, and never use `fetch` for large PUTs.
- Port 3011 (print agent uses 3010). Auto-starts at login, single-instance lock.
