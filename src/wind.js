// Wind at street level: an indicative model built from rules of thumb, not a wind simulation (CFD).
// 1. Air flows around the building footprints like water around stones (2D "potential flow").
// 2. Each building shelters a wake behind it, longer the taller it is.
// 3. A tall building, above all one taller than its neighbours, pulls fast upper wind down to its corners.
export const CELL_M = 5
export const WIND_DIRS = [
  { id: 'N', label: 'North', deg: 0 },
  { id: 'NE', label: 'North-east', deg: 45 },
  { id: 'E', label: 'East', deg: 90 },
  { id: 'SE', label: 'South-east', deg: 135 },
  { id: 'S', label: 'South', deg: 180 },
  { id: 'SW', label: 'South-west', deg: 225 },
  { id: 'W', label: 'West', deg: 270 },
  { id: 'NW', label: 'North-west', deg: 315 },
]
const WAKE_PER_M = 4 // a building shelters about four times its height downwind
const WAKE_MAX_M = 150 // in a dense city, the next buildings break the wake up
const WAKE_STRENGTH = 0.65 // right behind a building, wind drops by up to 65 %
const NEIGHBOUR_M = 150 // "neighbours" for comparing heights
const COURTYARD_SPEED = 0.15

function insideRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Everything that depends only on the footprints and the wind direction: the grid, the flow around buildings, the courtyards.
export function windBase(city, [w, h], fromDeg) {
  const c = CELL_M
  const nx = Math.ceil(w / c), ny = Math.ceil(h / c), n = nx * ny
  const x0 = (-nx * c) / 2, y0 = (-ny * c) / 2
  const cx = (i) => x0 + (i + 0.5) * c, cy = (j) => y0 + (j + 0.5) * c

  // Which cells are inside a building.
  const solid = new Uint8Array(n)
  for (const b of city.buildings) {
    const [outer, ...holes] = b.rings
    for (let j = Math.max(0, Math.floor((b.bbox.minY - y0) / c)); j <= Math.min(ny - 1, Math.floor((b.bbox.maxY - y0) / c)); j++)
      for (let i = Math.max(0, Math.floor((b.bbox.minX - x0) / c)); i <= Math.min(nx - 1, Math.floor((b.bbox.maxX - x0) / c)); i++) {
        const p = [cx(i), cy(j)]
        if (insideRing(p, outer) && !holes.some((r) => insideRing(p, r))) solid[j * nx + i] = 1
      }
  }

  // Open ground reached from the edge of the map; what's left are closed courtyards.
  const open = new Uint8Array(n)
  const queue = []
  for (let i = 0; i < nx; i++) queue.push(i, (ny - 1) * nx + i)
  for (let j = 0; j < ny; j++) queue.push(j * nx, j * nx + nx - 1)
  while (queue.length) {
    const k = queue.pop()
    if (open[k] || solid[k]) continue
    open[k] = 1
    const i = k % nx, j = (k - i) / nx
    if (i > 0) queue.push(k - 1)
    if (i < nx - 1) queue.push(k + 1)
    if (j > 0) queue.push(k - nx)
    if (j < ny - 1) queue.push(k + nx)
  }

  // The direction the wind blows towards, and the flow around the footprints.
  const wx = -Math.sin((fromDeg * Math.PI) / 180), wy = -Math.cos((fromDeg * Math.PI) / 180)
  const phi = new Float32Array(n)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) phi[j * nx + i] = wx * cx(i) + wy * cy(j)
  for (let it = 0; it < 250; it++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i
        if (!open[k]) continue
        let sum = 0, count = 0
        if (!solid[k - 1]) { sum += phi[k - 1]; count++ }
        if (!solid[k + 1]) { sum += phi[k + 1]; count++ }
        if (!solid[k - nx]) { sum += phi[k - nx]; count++ }
        if (!solid[k + nx]) { sum += phi[k + nx]; count++ }
        if (count) phi[k] += 1.85 * (sum / count - phi[k])
      }

  // Flow direction and speed (1 = the wind over open ground) in each open cell.
  const vx = new Float32Array(n), vy = new Float32Array(n), flow = new Float32Array(n)
  const slope = (k, a, b) => {
    const okA = a >= 0 && a < n && !solid[a], okB = b >= 0 && b < n && !solid[b]
    if (okA && okB) return (phi[b] - phi[a]) / (2 * c)
    if (okB) return (phi[b] - phi[k]) / c
    if (okA) return (phi[k] - phi[a]) / c
    return 0
  }
  for (let k = 0; k < n; k++) {
    if (!open[k]) continue
    const i = k % nx
    vx[k] = slope(k, i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1)
    vy[k] = slope(k, k - nx, k + nx)
    flow[k] = Math.min(2, Math.hypot(vx[k], vy[k]))
  }

  // For each building, the others within NEIGHBOUR_M, to compare heights.
  const centres = city.buildings.map((b) => [(b.bbox.minX + b.bbox.maxX) / 2, (b.bbox.minY + b.bbox.maxY) / 2])
  const near = centres.map(([x, y], a) => {
    const list = []
    centres.forEach(([x2, y2], b) => b !== a && Math.abs(x2 - x) < NEIGHBOUR_M && Math.hypot(x2 - x, y2 - y) < NEIGHBOUR_M && list.push(b))
    return list
  })

  return { nx, ny, x0, y0, cell: c, solid, open, vx, vy, flow, wx, wy, near }
}

// Wind speed at street level for given building heights (1 = the wind over open ground).
export function windSpeed(city, base, heights) {
  const { nx, ny, x0, y0, cell: c, solid, open, flow, wx, wy, near } = base
  const n = nx * ny
  const shelter = new Float32Array(n).fill(1)
  const boost = new Float32Array(n)
  // Wind coordinates: u along the wind, v across it.
  const toU = (x, y) => x * wx + y * wy, toV = (x, y) => -x * wy + y * wx

  // Run `fn(k, u, v)` for every open cell whose centre lies in the u/v box.
  const eachCell = (u1, u2, v1, v2, fn) => {
    const corners = [[u1, v1], [u1, v2], [u2, v1], [u2, v2]].map(([u, v]) => [u * wx - v * wy, u * wy + v * wx])
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1])
    const i1 = Math.max(0, Math.floor((Math.min(...xs) - x0) / c)), i2 = Math.min(nx - 1, Math.floor((Math.max(...xs) - x0) / c))
    const j1 = Math.max(0, Math.floor((Math.min(...ys) - y0) / c)), j2 = Math.min(ny - 1, Math.floor((Math.max(...ys) - y0) / c))
    for (let j = j1; j <= j2; j++)
      for (let i = i1; i <= i2; i++) {
        const k = j * nx + i
        if (solid[k]) continue
        const x = x0 + (i + 0.5) * c, y = y0 + (j + 0.5) * c
        const u = toU(x, y), v = toV(x, y)
        if (u >= u1 && u <= u2 && v >= v1 && v <= v2) fn(k, u, v)
      }
  }

  city.buildings.forEach((b, a) => {
    const H = heights[a]
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
    for (const [x, y] of b.rings[0]) {
      const u = toU(x, y), v = toV(x, y)
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v)
    }

    // The sheltered wake: weakest wind right behind the building, back to normal at the end.
    const L = Math.min(WAKE_PER_M * H, WAKE_MAX_M)
    eachCell(uMax - c, uMax + L, vMin, vMax, (k, u) => {
      const f = 1 - WAKE_STRENGTH * (1 - Math.max(0, u - uMax) / L)
      if (f < shelter[k]) shelter[k] = f
    })

    // Downdraught: for buildings above 15 m and taller than their neighbours, stronger the more they rise above both.
    const others = near[a]
    const mean = others.length ? others.reduce((s, o) => s + heights[o], 0) / others.length : 8
    const excess = H - Math.max(15, mean)
    if (excess <= 0) return
    const strength = 0.8 * Math.min(1, excess / 25)
    // A swirl at the foot of the face that meets the wind...
    const F = 0.5 * H
    eachCell(uMin - F, uMin + c, vMin, vMax, (k, u) => {
      boost[k] = Math.max(boost[k], 0.6 * strength * (1 - Math.max(0, uMin - u) / F))
    })
    // ...and fast streams around its two side corners.
    const R = 0.6 * H
    const uc = uMin + 0.25 * (uMax - uMin)
    for (const vc of [vMin, vMax])
      eachCell(uc - R, uc + R, vc - R, vc + R, (k, u, v) => {
        const d = Math.hypot(u - uc, v - vc)
        if (d < R) boost[k] = Math.max(boost[k], strength * (1 - d / R))
      })
  })

  const speed = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    if (solid[k]) continue
    speed[k] = (open[k] ? flow[k] * shelter[k] : COURTYARD_SPEED) * (1 + boost[k])
  }
  return speed
}

// Compare street-level wind before and after the growth: area that got windier or calmer by more than 10 %.
export function windChange(base, before, after) {
  const change = new Float32Array(before.length) // relative change: 0.25 = a quarter faster, -0.5 = half as fast
  let windier = 0, calmer = 0
  for (let k = 0; k < before.length; k++) {
    change[k] = (after[k] - before[k]) / Math.max(before[k], 0.1)
    if (change[k] > 0.1) windier++
    else if (change[k] < -0.1) calmer++
  }
  const cellArea = base.cell * base.cell
  return { change, windier: windier * cellArea, calmer: calmer * cellArea }
}
