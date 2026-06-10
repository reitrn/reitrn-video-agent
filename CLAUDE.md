# reitrn Video Agent

Electron tray app (zero-config, no settings UI) for warehouse inspection-station
PCs. Receives webcam inspection videos recorded in the browser, queues them on
disk, and uploads them to R2 via ReturnHub. Repo: github.com/reitrn/reitrn-video-agent.
Windows-only. Current version 1.0.3.

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
   (`/api/storage/r2-signed-url`) → PUT webm to R2 (10 min timeout) → mark
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
- All `fetch` calls are wrapped in timeouts (30s API / 10 min R2 PUT) after
  upload-reliability fixes — keep timeouts on any new network call.
- Port 3011 (print agent uses 3010). Auto-starts at login, single-instance lock.
