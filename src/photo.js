import { distanceToFootprint } from './shapes.js'

// Photo mode: you stand in the city at eye height and look through a wide-angle lens.
export const EYE_HEIGHT_M = 1.65
export const FOCAL_MM = 15
// The vertical field of view of a 15 mm lens on a full-frame (36 × 24 mm) sensor, stretched to
// the screen's shape the way three.js does with a 35 mm film gauge: about 99° across at 16:10.
export const fovFor = (aspect, focal = FOCAL_MM) => (2 * Math.atan(35 / Math.max(aspect, 1) / 2 / focal) * 180) / Math.PI

function closestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return [ax + t * dx, ay + t * dy]
}

// Where a citizen stands for a click: right there, unless the click is inside a building;
// then on the nearest point of a street.
export function standPoint(city, p) {
  const box = { minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] }
  const inside = [...city.buildingsNear(box, 0)].some((i) => distanceToFootprint(p, city.buildings[i].rings) === 0)
  if (!inside) return p
  let best = p, bestD = Infinity
  for (const e of city.edges)
    for (let k = 1; k < e.points.length; k++) {
      const q = closestOnSegment(p, e.points[k - 1], e.points[k])
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d < bestD) (bestD = d), (best = q)
    }
  return best
}
