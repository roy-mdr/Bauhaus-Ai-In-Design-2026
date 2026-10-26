import { insideRing, pointSegmentDistance } from './reach.js'

// Parks are the plots with land use "recreation". The kit has no tree data: the trees are
// an illustration, scattered over the parks so they read as parks, not surveyed trees.
export const PARK_LANDUSE = 'recreation'
const SPACING_M = 9 // about one tree per 9 × 9 m
const FILL = 0.8 // share of the spots that get a tree, so the parks look less like an orchard
const CLEAR_OF_PATHS_M = 3.5 // trunks stay off the walking network
const CLEAR_OF_BUILDINGS_M = 2
const CONIFER_CLEAR_M = 5.5 // spruces keep further from paths: their branches reach down to the ground

// A seeded random number generator, so the trees stand in the same places, and look the same, every time.
export function random(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const openRing = (ring) => {
  const [a, b] = [ring[0], ring[ring.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring
}

// The park outlines in metres, and the trees inside them.
export function makeParks(city, plots, terrain) {
  const rand = random(1919) // the year the Bauhaus was founded in Weimar
  const parks = plots.features
    .filter((f) => f.properties.landuse === PARK_LANDUSE)
    .map((f) => f.geometry.coordinates.map((r) => openRing(r).map(city.project)))

  const insidePark = (p, [outer, ...holes]) => insideRing(p, outer) && !holes.some((h) => insideRing(p, h))

  const insideBuilding = ([x, y]) => {
    const pad = CLEAR_OF_BUILDINGS_M
    for (const i of city.buildingsNear({ minX: x, minY: y, maxX: x, maxY: y }, pad)) {
      const { rings, bbox } = city.buildings[i]
      if (x < bbox.minX - pad || x > bbox.maxX + pad || y < bbox.minY - pad || y > bbox.maxY + pad) continue
      if (insideRing([x, y], rings[0])) return true
      for (const ring of rings)
        for (let k = 0; k < ring.length; k++) if (pointSegmentDistance([x, y], ring[k], ring[(k + 1) % ring.length]) < pad) return true
    }
    return false
  }

  // Only the street pieces near the parks, so checking each tree stays quick.
  const segments = []
  for (const e of city.edges) for (let i = 1; i < e.points.length; i++) segments.push([e.points[i - 1], e.points[i]])

  // Tree spots: a grid with each spot moved a little at random.
  const trees = []
  for (const park of parks) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of park[0]) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)]
    const near = segments.filter(([a, b]) => Math.max(a[0], b[0]) > minX - 5 && Math.min(a[0], b[0]) < maxX + 5 && Math.max(a[1], b[1]) > minY - 5 && Math.min(a[1], b[1]) < maxY + 5)
    for (let x = minX + SPACING_M / 2; x < maxX; x += SPACING_M)
      for (let y = minY + SPACING_M / 2; y < maxY; y += SPACING_M) {
        const p = [x + (rand() - 0.5) * SPACING_M * 0.8, y + (rand() - 0.5) * SPACING_M * 0.8]
        if (rand() > FILL || !insidePark(p, park)) continue
        const pathDistance = Math.min(Infinity, ...near.map(([a, b]) => pointSegmentDistance(p, a, b)))
        if (pathDistance < CLEAR_OF_PATHS_M || insideBuilding(p)) continue
        trees.push([...p, pathDistance])
      }
  }

  // Each tree: where it stands, which species, how big, how it is turned, and a slight tint, so no two look alike.
  // Spruces only grow well away from the paths, so the walkthrough never brushes through their low branches.
  const out = trees.map(([x, y, pathDistance]) => {
    const roll = rand()
    let species = roll < 0.4 ? 'lime' : roll < 0.75 ? 'oak' : roll < 0.87 ? 'poplar' : 'spruce'
    if (species === 'spruce' && pathDistance < CONIFER_CLEAR_M) species = 'lime'
    return { x, y, z: terrain.heightAt(x, y), species, scale: 0.65 + rand() * 0.5, turn: rand() * Math.PI * 2, shade: 0.85 + rand() * 0.3, hue: rand() - 0.5 }
  })

  return { parks, treeCount: out.length, trees: out }
}
