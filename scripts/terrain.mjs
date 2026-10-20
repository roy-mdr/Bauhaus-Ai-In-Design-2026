// Makes public/data/terrain.json from the DGM1 tiles of Thuringia.
//
// 1. Download the tiles dgm1_32_<east>_<north>_1_th_2020-2025.zip for east 662–664 and north
//    5649–5651 from https://geoportal.geoportal-th.de/hoehendaten/DGM/dgm_2020-2025/
// 2. Unzip the .xyz files into one folder.
// 3. Run: node scripts/terrain.mjs <that folder>
//
// The tiles are 1 × 1 km with one height per metre, in ETRS89 / UTM zone 32N (EPSG:25832),
// heights in metres above sea level (DHHN2016). This script averages them onto a 5 m grid in the
// kit's own metres: x east and y north of the kit centre, as the app uses.
import fs from 'fs'
import path from 'path'

const folder = process.argv[2]
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const kit = JSON.parse(fs.readFileSync(path.join(root, 'public/data/kit.json'), 'utf8'))

const STEP = 5 // metres between grid points
const MARGIN = 300 // the ground in the app reaches this far beyond the kit
const [E0, N0, SIZE] = [662000, 5649000, 3000] // the 3 × 3 tiles, in metres

// Read every tile into one 3000 × 3000 m mosaic.
const mosaic = new Float32Array(SIZE * SIZE).fill(NaN)
for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.xyz'))) {
  const values = fs.readFileSync(path.join(folder, file), 'utf8').trim().split(/\s+/).map(Number)
  for (let k = 0; k < values.length; k += 3) {
    const i = Math.floor(values[k] - E0), j = Math.floor(values[k + 1] - N0)
    if (i >= 0 && i < SIZE && j >= 0 && j < SIZE) mosaic[j * SIZE + i] = values[k + 2]
  }
  console.log('read', file)
}

// The kit's projection (as in src/project.js), turned around: metres to longitude and latitude.
const EARTH_RADIUS_M = 6371008.8
const [lon0, lat0] = kit.center
const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M
const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180)

// Longitude and latitude to UTM zone 32N (the standard series formulas, accurate to millimetres here).
function utm32(lon, lat) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2)
  const phi = (lat * Math.PI) / 180, lam = ((lon - 9) * Math.PI) / 180
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = lam * Math.cos(phi)
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi))
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000
  const y = k0 * (M + N * Math.tan(phi) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720))
  return [x, y]
}

// The grid, from the south-west corner, row by row northwards.
const [w, h] = kit.size_m
const halfX = Math.ceil((w / 2 + MARGIN) / STEP) * STEP, halfY = Math.ceil((h / 2 + MARGIN) / STEP) * STEP
const cols = (2 * halfX) / STEP + 1, rows = (2 * halfY) / STEP + 1
const heights = new Float64Array(cols * rows)
let missing = 0
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const x = -halfX + c * STEP, y = -halfY + r * STEP
    const [E, N] = utm32(lon0 + x / mPerDegLon, lat0 + y / mPerDegLat)
    // The average of the 5 × 5 one-metre cells around the grid point.
    let sum = 0, n = 0
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const i = Math.floor(E - E0) + di, j = Math.floor(N - N0) + dj
        const v = i >= 0 && i < SIZE && j >= 0 && j < SIZE ? mosaic[j * SIZE + i] : NaN
        if (!Number.isNaN(v)) [sum, n] = [sum + v, n + 1]
      }
    if (n === 0) missing++
    heights[r * cols + c] = n ? sum / n : NaN
  }
if (missing) throw new Error(`${missing} grid points have no height: download more tiles`)

let [low, high] = [Infinity, -Infinity]
for (const v of heights) [low, high] = [Math.min(low, v), Math.max(high, v)]
const base = Math.floor(low)
fs.writeFileSync(
  path.join(root, 'public/data/terrain.json'),
  JSON.stringify({
    origin: [-halfX, -halfY],
    step_m: STEP,
    cols,
    rows,
    base_m: base,
    heights_dm: Array.from(heights, (v) => Math.round((v - base) * 10)),
  }),
)
console.log(`terrain.json: ${cols} × ${rows} points, ${low.toFixed(1)} to ${high.toFixed(1)} m above sea level`)
