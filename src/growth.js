// City growth: from a chosen point, buildings gain storeys, most at the point and none at the edge of the radius.
export const STOREY_M = 3
export const RADII = [100, 200, 300, 500, 800]
export const GRADIENTS = [
  { id: 'linear', label: 'Even', curve: (t) => t },
  { id: 'smooth', label: 'Soft edge', curve: (t) => t * t * (3 - 2 * t) },
  { id: 'peak', label: 'Sharp peak', curve: (t) => t * t * t },
]

// Footprint area in m²: the outer ring minus the courtyards.
function footprintArea(rings) {
  const ringArea = (r) => {
    let a = 0
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]
      a += x1 * y2 - x2 * y1
    }
    return Math.abs(a) / 2
  }
  const [outer, ...holes] = rings
  return ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0)
}

export function computeGrowth(city, centre, { radius, storeys, gradient }) {
  const curve = GRADIENTS.find((g) => g.id === gradient).curve
  const added = new Float32Array(city.buildings.length) // added height in metres, per building
  const share = new Float32Array(city.buildings.length) // 0 to 1, for the colour
  let count = 0, totalStoreys = 0, floorArea = 0, tallest = 0

  city.buildings.forEach((b, i) => {
    // Distance from the point to the middle of the building.
    const { minX, minY, maxX, maxY } = b.bbox
    const d = Math.hypot((minX + maxX) / 2 - centre[0], (minY + maxY) / 2 - centre[1])
    if (d >= radius) return
    // Whole storeys only, so the gradient steps down like real buildings would.
    const n = Math.round(storeys * curve(1 - d / radius))
    if (n === 0) return
    b.area ??= footprintArea(b.rings)
    added[i] = n * STOREY_M
    share[i] = n / storeys
    count++
    totalStoreys += n
    floorArea += b.area * n
    tallest = Math.max(tallest, b.height + n * STOREY_M)
  })

  return { centre, radius, added, share, count, totalStoreys, floorArea, tallest }
}
