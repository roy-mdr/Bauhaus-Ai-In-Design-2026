import { insideRing, pointSegmentDistance } from './reach.js'

// Parks are the plots with land use "recreation". The kit has no tree data: the trees are
// an illustration, scattered over the parks so they read as parks, not surveyed trees.
export const PARK_LANDUSE = 'recreation'
const SPACING_M = 9 // about one tree per 9 × 9 m
const FILL = 0.8 // share of the spots that get a tree, so the parks look less like an orchard
const CLEAR_OF_PATHS_M = 3.5 // trunks stay off the walking network
const CLEAR_OF_BUILDINGS_M = 2

// A seeded random number generator, so the trees stand in the same places every time.
function random(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// HSL to RGB, all from 0 to 1.
function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}

const openRing = (ring) => {
  const [a, b] = [ring[0], ring[ring.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring
}

// The park outlines in metres, and a point cloud of trees inside them.
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
        if (near.some(([a, b]) => pointSegmentDistance(p, a, b) < CLEAR_OF_PATHS_M) || insideBuilding(p)) continue
        trees.push(p)
      }
  }

  // Each tree: a trunk of points, and a crown of points, denser towards its surface and lighter on top.
  const positions = [], colors = [], lifts = [] // lifts: height of each point above its tree's foot, for the wind
  for (const [x, y] of trees) {
    const ground = terrain.heightAt(x, y)
    const height = 8 + rand() * 10
    const radius = 2.5 + rand() * 2.5
    const crownZ = height - radius
    const hue = 0.24 + rand() * 0.12, sat = 0.4 + rand() * 0.2, light = 0.3 + rand() * 0.12

    for (let z = 0; z < crownZ; z += 0.35) {
      positions.push(x + (rand() - 0.5) * 0.3, y + (rand() - 0.5) * 0.3, ground + z)
      lifts.push(z)
      colors.push(...hsl(0.08, 0.35, 0.22 + rand() * 0.08))
    }
    const count = Math.round(40 + radius * 30)
    for (let i = 0; i < count; i++) {
      // A random direction, and a distance from the centre pushed towards the surface.
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = radius * rand() ** 0.35
      const s = Math.sqrt(1 - u * u)
      const dz = u * r * 0.85
      positions.push(x + s * Math.cos(a) * r, y + s * Math.sin(a) * r, ground + crownZ + dz)
      lifts.push(crownZ + dz)
      colors.push(...hsl(hue + (rand() - 0.5) * 0.04, sat, light + (dz / radius) * 0.1 + (rand() - 0.5) * 0.08))
    }
  }

  return { parks, treeCount: trees.length, positions: new Float32Array(positions), colors: new Float32Array(colors), lifts: new Float32Array(lifts) }
}
