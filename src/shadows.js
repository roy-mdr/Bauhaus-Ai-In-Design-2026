// Shadows: where the sun is over the city, and which ground the raised buildings newly put in shade.
// The ground is a grid of small square cells; a cell is in shade or not.
const CELL_M = 2
const rad = Math.PI / 180

// Days of the year that frame the seasons, with the clock's offset from UTC in Germany on that day.
export const DAYS = [
  { id: 'mar', label: '21 March', month: 2, day: 21, utcOffset: 1 },
  { id: 'jun', label: '21 June', month: 5, day: 21, utcOffset: 2 },
  { id: 'sep', label: '23 September', month: 8, day: 23, utcOffset: 2 },
  { id: 'dec', label: '21 December', month: 11, day: 21, utcOffset: 1 },
]
// Below this sun height shadows get endlessly long, so we treat the sun as down.
export const MIN_SUN_ALTITUDE = 3

// The sun's position for a day and a local clock time (hours) at [lon, lat].
// Returns its height above the horizon and its compass direction, both in degrees (0° = north, 90° = east).
export function sunPosition(dayId, hours, [lon, lat]) {
  const day = DAYS.find((d) => d.id === dayId)
  const utc = Date.UTC(2026, day.month, day.day) + (hours - day.utcOffset) * 3600000
  const d = utc / 86400000 - 10957.5 // days since 1 January 2000, noon
  const g = (357.529 + 0.98560028 * d) * rad
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * d) * rad
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const siderealDeg = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lon
  const H = siderealDeg * rad - ra
  const phi = lat * rad
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad
  const azimuth = (Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)) / rad + 360) % 360
  return { altitude, azimuth }
}

function insideRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// The grid, and for each building the cells under its footprint and the cells along its outline. Made once per city.
const footprintCache = new WeakMap()
function footprints(city, [w, h]) {
  if (footprintCache.has(city)) return footprintCache.get(city)
  const c = CELL_M
  const nx = Math.ceil(w / c), ny = Math.ceil(h / c)
  const grid = { nx, ny, x0: (-nx * c) / 2, y0: (-ny * c) / 2, cell: c }
  const under = new Uint8Array(nx * ny)
  const cells = city.buildings.map((b) => {
    const [outer, ...holes] = b.rings
    const all = [], edge = []
    const i1 = Math.max(0, Math.floor((b.bbox.minX - grid.x0) / c)), i2 = Math.min(nx - 1, Math.floor((b.bbox.maxX - grid.x0) / c))
    const j1 = Math.max(0, Math.floor((b.bbox.minY - grid.y0) / c)), j2 = Math.min(ny - 1, Math.floor((b.bbox.maxY - grid.y0) / c))
    for (let j = j1; j <= j2; j++)
      for (let i = i1; i <= i2; i++) {
        const p = [grid.x0 + (i + 0.5) * c, grid.y0 + (j + 0.5) * c]
        if (insideRing(p, outer) && !holes.some((r) => insideRing(p, r))) all.push(j * nx + i)
      }
    // Cells whose neighbour is outside the footprint form the outline. A tiny building is all outline.
    const inside = new Set(all)
    for (const k of all) if (!inside.has(k - 1) || !inside.has(k + 1) || !inside.has(k - nx) || !inside.has(k + nx)) edge.push(k)
    if (!all.length) {
      const k = Math.floor(((b.bbox.minY + b.bbox.maxY) / 2 - grid.y0) / c) * nx + Math.floor(((b.bbox.minX + b.bbox.maxX) / 2 - grid.x0) / c)
      all.push(k)
      edge.push(k)
    }
    for (const k of all) under[k] = 1
    return { all, edge }
  })
  const result = { grid, cells, under }
  footprintCache.set(city, result)
  return result
}

// Marks the ground shadow of one building in `mask`: its footprint swept away from the sun.
// Sweeping the outline, plus the footprint at the start and the end, covers the whole shadow.
function castShadow(mask, grid, { all, edge }, [dx, dy]) {
  const { nx, ny, cell } = grid
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (0.7 * cell)))
  const stamp = (list, s) => {
    const di = Math.round((dx * s) / steps / cell), dj = Math.round((dy * s) / steps / cell)
    for (const k of list) {
      const i = (k % nx) + di, j = Math.floor(k / nx) + dj
      if (i >= 0 && i < nx && j >= 0 && j < ny) mask[j * nx + i] = 1
    }
  }
  stamp(all, 0)
  for (let s = 1; s < steps; s++) stamp(edge, s)
  stamp(all, steps)
}

// The ground that is in shade after the growth but was not before, at the sun's current position.
export function newShadow(city, size, growth, sun) {
  if (!growth?.count || sun.altitude < MIN_SUN_ALTITUDE) return null
  const { grid, cells, under } = footprints(city, size)
  // Shadow length per metre of height, pointing away from the sun.
  const k = 1 / Math.tan(sun.altitude * rad)
  const dir = [-Math.sin(sun.azimuth * rad) * k, -Math.cos(sun.azimuth * rad) * k]

  const after = new Uint8Array(grid.nx * grid.ny)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  city.buildings.forEach((b, i) => {
    if (!growth.added[i]) return
    const h = b.height + growth.added[i]
    castShadow(after, grid, cells[i], [dir[0] * h, dir[1] * h])
    minX = Math.min(minX, b.bbox.minX, b.bbox.minX + dir[0] * h); maxX = Math.max(maxX, b.bbox.maxX, b.bbox.maxX + dir[0] * h)
    minY = Math.min(minY, b.bbox.minY, b.bbox.minY + dir[1] * h); maxY = Math.max(maxY, b.bbox.maxY, b.bbox.maxY + dir[1] * h)
  })

  // The shadows that were already there, from every building that could reach the affected ground.
  const pad = 40 * Math.hypot(...dir)
  const before = new Uint8Array(grid.nx * grid.ny)
  city.buildings.forEach((b, i) => {
    const { bbox } = b
    if (bbox.maxX < minX - pad || bbox.minX > maxX + pad || bbox.maxY < minY - pad || bbox.minY > maxY + pad) return
    castShadow(before, grid, cells[i], [dir[0] * b.height, dir[1] * b.height])
  })

  // New shadow: shaded now, not before, and on open ground rather than on a roof.
  let count = 0
  for (let m = 0; m < after.length; m++) {
    after[m] = after[m] && !before[m] && !under[m] ? 1 : 0
    count += after[m]
  }
  return { grid, mask: after, area: count * grid.cell * grid.cell }
}
