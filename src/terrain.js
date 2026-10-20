// Simulated topography. The kit has no ground heights, so this is a plausible surface, not a survey:
// lowest along the water plots (the Ilm valley on the east edge), rising with distance from the water,
// with gentle rolling bumps. Heights are in metres above sea level, roughly in Weimar's range.
export const TERRAIN_CELL_M = 10
export const RIVER_M = 208 // ground level at the water
const RISE_M = 40 // how much higher the ground gets far from the water
const RISE_DISTANCE_M = 450 // how quickly it rises
export const EXAGGERATIONS = [
  { id: 0, label: 'Flat' },
  { id: 1, label: 'True scale' },
  { id: 3, label: '3× higher' },
]

function insideRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// `plots` is plots.geojson; `project` turns [lon, lat] into metres; the grid covers the kit plus `margin` on each side.
export function makeTerrain(plots, project, [w, h], margin = 300) {
  const c = TERRAIN_CELL_M
  const nx = Math.ceil((w + 2 * margin) / c) + 1, ny = Math.ceil((h + 2 * margin) / c) + 1
  const x0 = -((nx - 1) * c) / 2, y0 = -((ny - 1) * c) / 2 // grid points, not cells: point (i, j) is at x0 + i·c, y0 + j·c
  const n = nx * ny

  // 1. Mark the grid points on water.
  const water = plots.features
    .filter((f) => /water/.test(f.properties.landuse))
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates))
    .map((poly) => poly[0].map(project))
  const dist = new Float32Array(n).fill(Infinity)
  for (const ring of water) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
    for (let j = Math.max(0, Math.floor((Math.min(...ys) - y0) / c)); j <= Math.min(ny - 1, Math.ceil((Math.max(...ys) - y0) / c)); j++)
      for (let i = Math.max(0, Math.floor((Math.min(...xs) - x0) / c)); i <= Math.min(nx - 1, Math.ceil((Math.max(...xs) - x0) / c)); i++)
        if (insideRing([x0 + i * c, y0 + j * c], ring)) dist[j * nx + i] = 0
  }

  // 2. Distance from every point to the nearest water, in two sweeps over the grid.
  const D = Math.SQRT2 * c
  const relax = (k, m, d) => { if (dist[m] + d < dist[k]) dist[k] = dist[m] + d }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (i > 0) relax(k, k - 1, c)
      if (j > 0) {
        relax(k, k - nx, c)
        if (i > 0) relax(k, k - nx - 1, D)
        if (i < nx - 1) relax(k, k - nx + 1, D)
      }
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i
      if (i < nx - 1) relax(k, k + 1, c)
      if (j < ny - 1) {
        relax(k, k + nx, c)
        if (i < nx - 1) relax(k, k + nx + 1, D)
        if (i > 0) relax(k, k + nx - 1, D)
      }
    }

  // 3. Height: rising away from the water, plus soft bumps a few hundred metres across.
  let z = new Float32Array(n)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * c, y = y0 + j * c, k = j * nx + i
      const d = Number.isFinite(dist[k]) ? dist[k] : 2000
      const bumps = 3 * Math.sin(x / 170 + 1.3) * Math.cos(y / 230 - 0.7) + 1.5 * Math.sin((x + y) / 110)
      z[k] = RIVER_M + RISE_M * (1 - Math.exp(-d / RISE_DISTANCE_M)) + bumps * Math.min(1, d / 150)
    }

  // 4. Smooth away the creases the distance sweep leaves.
  for (let pass = 0; pass < 4; pass++) {
    const s = new Float32Array(n)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let sum = 0, count = 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const a = i + di, b = j + dj
            if (a >= 0 && a < nx && b >= 0 && b < ny) { sum += z[b * nx + a]; count++ }
          }
        s[j * nx + i] = sum / count
      }
    z = s
  }

  let min = Infinity, max = -Infinity
  for (const v of z) { if (v < min) min = v; if (v > max) max = v }

  // Height above sea level anywhere, blended between the four nearest grid points.
  const at = (x, y) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / c)), fy = Math.min(ny - 1.001, Math.max(0, (y - y0) / c))
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * nx + i
    return (z[k] * (1 - tx) + z[k + 1] * tx) * (1 - ty) + (z[k + nx] * (1 - tx) + z[k + nx + 1] * tx) * ty
  }
  return { nx, ny, x0, y0, cell: c, z, min, max, at }
}
