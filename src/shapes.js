// Small plane geometry helpers, all in metres, points as [x, y].

export function polygonArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return a / 2
}

export function insideRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function pointSegmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Distance from a point to a footprint: 0 inside it, otherwise to its nearest wall.
export function distanceToFootprint(p, rings) {
  if (insideRing(p, rings[0]) && !rings.slice(1).some((h) => insideRing(p, h))) return 0
  let best = Infinity
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) best = Math.min(best, pointSegmentDistance(p, ring[i], ring[(i + 1) % ring.length]))
  return best
}

// The smallest rectangle around a footprint, tried along each of its walls.
// u runs along the rectangle, v across it; a point is at u * (ux, uy) + v * (-uy, ux).
export function orientedBox(ring) {
  let best = null
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length]
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 0.5) continue
    const ux = (bx - ax) / len, uy = (by - ay) / len
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [x, y] of ring) {
      const u = x * ux + y * uy, v = -x * uy + y * ux
      minU = Math.min(minU, u); maxU = Math.max(maxU, u)
      minV = Math.min(minV, v); maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV }
  }
  return best
}

export const boxPoint = (box, u, v) => [u * box.ux - v * box.uy, u * box.uy + v * box.ux]

// Which buildings get a pitched roof: narrow, nearly rectangular ones, like most of Weimar's old town.
// Big footprints, courtyard buildings and halls keep a flat roof.
const FLAT_USES = new Set(['transport', 'light_industrial', 'sport'])
const PITCH = Math.tan((42 * Math.PI) / 180)

export function roofOf(b) {
  const area = Math.abs(polygonArea(b.rings[0]))
  const box = orientedBox(b.rings[0])
  const short = Math.min(box.maxU - box.minU, box.maxV - box.minV)
  const pitched =
    b.rings.length === 1 && area / box.area > 0.82 && short >= 5 && short <= 18 && b.height >= 6 && !FLAT_USES.has(b.use)
  const rise = pitched ? Math.min((short / 2) * PITCH, b.height * 0.45) : 0
  return { area, box, pitched, rise, eave: b.height - rise }
}
