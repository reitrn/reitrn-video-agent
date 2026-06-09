#!/usr/bin/env node
// Generates a minimal placeholder icon at assets/icon.ico
// Replace assets/icon.ico with the real reitrn logo (256x256 .ico) when ready.
// Run automatically via `npm install` (prepare script).

const fs = require('fs')
const path = require('path')

// Minimal valid 1x1 pixel ICO, indigo #6366f1 (BGRA: F1 66 63 FF)
// ICONDIR (6) + ICONDIRENTRY (16) + BITMAPINFOHEADER (40) + pixel (4) + AND mask (4) = 70 bytes
const ico = Buffer.from([
  // ICONDIR
  0x00, 0x00,              // reserved
  0x01, 0x00,              // type = ICO
  0x01, 0x00,              // image count = 1
  // ICONDIRENTRY
  0x01,                    // width = 1
  0x01,                    // height = 1
  0x00,                    // color count
  0x00,                    // reserved
  0x01, 0x00,              // planes = 1
  0x20, 0x00,              // bit count = 32
  0x30, 0x00, 0x00, 0x00, // size of image data = 48
  0x16, 0x00, 0x00, 0x00, // offset = 22 (6 + 16)
  // BITMAPINFOHEADER (40 bytes)
  0x28, 0x00, 0x00, 0x00, // biSize = 40
  0x01, 0x00, 0x00, 0x00, // biWidth = 1
  0x02, 0x00, 0x00, 0x00, // biHeight = 2 (XOR + AND masks)
  0x01, 0x00,              // biPlanes = 1
  0x20, 0x00,              // biBitCount = 32
  0x00, 0x00, 0x00, 0x00, // biCompression = BI_RGB
  0x08, 0x00, 0x00, 0x00, // biSizeImage = 8
  0x00, 0x00, 0x00, 0x00, // biXPelsPerMeter
  0x00, 0x00, 0x00, 0x00, // biYPelsPerMeter
  0x00, 0x00, 0x00, 0x00, // biClrUsed
  0x00, 0x00, 0x00, 0x00, // biClrImportant
  // XOR pixel: BGRA = indigo #6366f1
  0xF1, 0x66, 0x63, 0xFF,
  // AND mask (1 pixel padded to 32 bits, 0 = opaque)
  0x00, 0x00, 0x00, 0x00,
])

const outDir = path.join(__dirname, '..', 'assets')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)

const outPath = path.join(outDir, 'icon.ico')
if (!fs.existsSync(outPath)) {
  fs.writeFileSync(outPath, ico)
  console.log('Generated placeholder icon at assets/icon.ico — replace with the real reitrn logo.')
} else {
  console.log('assets/icon.ico already exists, skipping.')
}
