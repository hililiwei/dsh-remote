#!/usr/bin/env node
/**
 * Generates the DSH Remote application and tray icons.
 *
 * Everything except the final .ico/.icns conversion is done with the Node
 * standard library: a tiny analytic-anti-aliased rasterizer draws the artwork
 * into premultiplied RGBA buffers and a minimal encoder writes the PNGs.
 * `png2icons` (a devDependency) then produces build/icon.ico and
 * build/icon.icns from build/icon.png.
 *
 * The artwork is original: a dark rounded tile, a white terminal prompt
 * chevron and a blue accent cursor. No DSH trademark assets are copied.
 *
 * Usage: npm run icons
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(ROOT, 'build')

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t

// ---------------------------------------------------------------------------
// Rasterizer (premultiplied RGBA, float channels in 0..1)
// ---------------------------------------------------------------------------

function createCanvas(width, height) {
  return { width, height, data: new Float64Array(width * height * 4) }
}

/** Signed distance to a rounded rectangle; negative inside. */
function roundedRectSdf(px, py, x0, y0, x1, y1, radius) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const qx = Math.abs(px - cx) - ((x1 - x0) / 2 - radius)
  const qy = Math.abs(py - cy) - ((y1 - y0) / 2 - radius)
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  )
}

/** Signed distance to a round-capped line segment; negative inside. */
function segmentSdf(px, py, ax, ay, bx, by, halfWidth) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const lenSq = bax * bax + bay * bay
  const h = lenSq === 0 ? 0 : clamp01((pax * bax + pay * bay) / lenSq)
  return Math.hypot(pax - bax * h, pay - bay * h) - halfWidth
}

/** Composite one SDF shape over the canvas with 1px analytic AA. */
function paint(canvas, sdf, colorAt, alphaScale = 1) {
  const { width, height, data } = canvas
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const coverage = clamp01(0.5 - sdf(x + 0.5, y + 0.5))
      if (coverage <= 0) continue
      const color = colorAt(x + 0.5, y + 0.5)
      const sa = color[3] * coverage * alphaScale
      if (sa <= 0) continue
      const i = (y * width + x) * 4
      const inv = 1 - sa
      data[i] = color[0] * sa + data[i] * inv
      data[i + 1] = color[1] * sa + data[i + 1] * inv
      data[i + 2] = color[2] * sa + data[i + 2] * inv
      data[i + 3] = sa + data[i + 3] * inv
    }
  }
}

/** Box-downsample a premultiplied canvas by an integer factor. */
function downsample(source, factor) {
  const width = Math.floor(source.width / factor)
  const height = Math.floor(source.height / factor)
  const out = createCanvas(width, height)
  const area = factor * factor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * source.width
        for (let dx = 0; dx < factor; dx++) {
          const i = (row + x * factor + dx) * 4
          r += source.data[i]
          g += source.data[i + 1]
          b += source.data[i + 2]
          a += source.data[i + 3]
        }
      }
      const o = (y * width + x) * 4
      out.data[o] = r / area
      out.data[o + 1] = g / area
      out.data[o + 2] = b / area
      out.data[o + 3] = a / area
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, payload) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0)
  return Buffer.concat([length, typeBuffer, payload, crc])
}

function encodePng(canvas) {
  const { width, height, data } = canvas
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const alpha = data[i + 3]
      const o = rowStart + 1 + x * 4
      if (alpha <= 0) continue
      raw[o] = Math.round(clamp01(data[i] / alpha) * 255)
      raw[o + 1] = Math.round(clamp01(data[i + 1] / alpha) * 255)
      raw[o + 2] = Math.round(clamp01(data[i + 2] / alpha) * 255)
      raw[o + 3] = Math.round(clamp01(alpha) * 255)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // color type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function pngSize(buffer) {
  if (buffer.length < 24) return null
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

const TILE_TOP = [42, 55, 76] // #2a374c
const TILE_BOTTOM = [11, 15, 22] // #0b0f16
const ACCENT_BRIGHT = [124, 184, 255]
const ACCENT = [47, 111, 228]

/**
 * @param {number} size canvas edge length in px
 * @param {'app'|'tray'|'template'} style
 */
function renderIcon(size, style) {
  const canvas = createCanvas(size, size)
  const template = style === 'template'
  const s = size

  if (!template) {
    const inset = s * (style === 'tray' ? 0.025 : 0.032)
    const radius = s * 0.215
    const x0 = inset
    const y0 = inset
    const x1 = s - inset
    const y1 = s - inset
    const tileSdf = (px, py) => roundedRectSdf(px, py, x0, y0, x1, y1, radius)

    // Dark tile with a soft vertical gradient.
    paint(canvas, tileSdf, (_px, py) => {
      const t = clamp01((py - y0) / (y1 - y0))
      return [
        lerp(TILE_TOP[0], TILE_BOTTOM[0], t) / 255,
        lerp(TILE_TOP[1], TILE_BOTTOM[1], t) / 255,
        lerp(TILE_TOP[2], TILE_BOTTOM[2], t) / 255,
        1
      ]
    })

    // Blue glow behind the prompt, clipped to the tile.
    const glowCx = s * 0.5
    const glowCy = s * 0.47
    const glowRadius = s * 0.58
    paint(
      canvas,
      tileSdf,
      (px, py) => {
        const d = Math.hypot(px - glowCx, (py - glowCy) * 0.92) / glowRadius
        const falloff = clamp01(1 - d)
        return [0.22, 0.52, 0.96, 0.26 * falloff * falloff]
      }
    )

    // Inner hairline highlight.
    const borderWidth = s * 0.0024
    paint(
      canvas,
      (px, py) => Math.abs(tileSdf(px, py)) - borderWidth,
      () => [1, 1, 1, 0.09]
    )
  }

  // Prompt geometry (normalized; template icons get a larger glyph).
  const prompt = template
    ? {
        chevron: [
          [0.115, 0.185],
          [0.47, 0.5],
          [0.115, 0.815]
        ],
        stroke: 0.145,
        cursor: [0.55, 0.755, 0.885, 0.885],
      }
    : {
        chevron: [
          [0.292, 0.292],
          [0.508, 0.5],
          [0.292, 0.708]
        ],
        stroke: 0.074,
        cursor: [0.55, 0.668, 0.752, 0.738],
      }

  const half = (s * prompt.stroke) / 2
  const [a, b, c] = prompt.chevron.map(([nx, ny]) => [nx * s, ny * s])
  const chevronSdf = (px, py) =>
    Math.min(
      segmentSdf(px, py, a[0], a[1], b[0], b[1], half),
      segmentSdf(px, py, b[0], b[1], c[0], c[1], half)
    )

  // Soft blue bloom behind the cursor for depth (app/tray only).
  if (!template) {
    const [cx0, cy0, cx1, cy1] = prompt.cursor.map((v) => v * s)
    const centerX = (cx0 + cx1) / 2
    const centerY = (cy0 + cy1) / 2
    const bloomRadius = s * 0.115
    paint(
      canvas,
      (px, py) =>
        Math.hypot(px - centerX, (py - centerY) * 1.4) - bloomRadius,
      (px, py) => {
        const d = Math.hypot(px - centerX, (py - centerY) * 1.4) / bloomRadius
        const falloff = clamp01(1 - d)
        return [0.37, 0.65, 0.98, 0.3 * falloff * falloff]
      }
    )
  }

  paint(canvas, chevronSdf, () =>
    template ? [0, 0, 0, 1] : [0.965, 0.976, 1, 1]
  )

  const [cx0, cy0, cx1, cy1] = prompt.cursor.map((v) => v * s)
  const cursorRadius = (cy1 - cy0) / 2
  const cursorSdf = (px, py) =>
    roundedRectSdf(px, py, cx0, cy0, cx1, cy1, cursorRadius)
  if (template) {
    paint(canvas, cursorSdf, () => [0, 0, 0, 1])
  } else {
    paint(canvas, cursorSdf, (_px, py) => {
      const t = clamp01((py - cy0) / (cy1 - cy0))
      return [
        lerp(ACCENT_BRIGHT[0], ACCENT[0], t) / 255,
        lerp(ACCENT_BRIGHT[1], ACCENT[1], t) / 255,
        lerp(ACCENT_BRIGHT[2], ACCENT[2], t) / 255,
        1
      ]
    })
  }

  return canvas
}

function renderSupersampled(size, style, factor = 4) {
  return downsample(renderIcon(size * factor, style), factor)
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function writePng(fileName, canvas, expectedSize) {
  const buffer = encodePng(canvas)
  writeFileSync(join(BUILD_DIR, fileName), buffer)
  const info = pngSize(buffer)
  if (!info || info.width !== expectedSize || info.height !== expectedSize) {
    throw new Error(
      `${fileName}: unexpected PNG dimensions ${info?.width}x${info?.height}`
    )
  }
  return { fileName, bytes: buffer.length, width: info.width, height: info.height }
}

function loadPng2icons() {
  try {
    return require('png2icons')
  } catch {
    throw new Error(
      'png2icons is not installed. Run `npm ci` (or `npm install`) first.'
    )
  }
}

function main() {
  mkdirSync(BUILD_DIR, { recursive: true })

  const results = []
  const icon1024 = renderIcon(1024, 'app')
  results.push(writePng('icon.png', icon1024, 1024))
  results.push(writePng('tray.png', renderSupersampled(32, 'tray'), 32))
  results.push(writePng('trayTemplate.png', renderSupersampled(16, 'template'), 16))
  results.push(
    writePng('trayTemplate@2x.png', renderSupersampled(32, 'template'), 32)
  )

  const png2icons = loadPng2icons()
  const source = readFileSync(join(BUILD_DIR, 'icon.png'))

  // ICO for Windows executables: BMP for small sizes, PNG for large ones.
  const ico = png2icons.createICO(source, png2icons.BICUBIC, 0, false, true)
  if (!ico) throw new Error('png2icons failed to create build/icon.ico')
  writeFileSync(join(BUILD_DIR, 'icon.ico'), ico)
  results.push({ fileName: 'icon.ico', bytes: ico.length })

  const icns = png2icons.createICNS(source, png2icons.BICUBIC, 0)
  if (!icns) throw new Error('png2icons failed to create build/icon.icns')
  writeFileSync(join(BUILD_DIR, 'icon.icns'), icns)
  results.push({ fileName: 'icon.icns', bytes: icns.length })

  let failed = false
  for (const result of results) {
    const target = join(BUILD_DIR, result.fileName)
    const sizeOnDisk = statSync(target).size
    const ok = sizeOnDisk > 0
    failed ||= !ok
    const dimensions = result.width ? ` ${result.width}x${result.height}` : ''
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} build/${result.fileName}${dimensions} ${sizeOnDisk} bytes`
    )
  }
  if (failed) throw new Error('one or more icon files are empty')

  console.log('icons written to build/')
}

try {
  main()
} catch (error) {
  console.error(`generate-icons failed: ${error.message}`)
  process.exitCode = 1
}