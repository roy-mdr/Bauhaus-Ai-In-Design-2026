import ClipperLib from 'clipper-lib'
import { makeProjection } from './project.js'

export const SPEED_M_PER_MIN = 80 // 4.8 km/h
export const MINUTES = [5, 10, 15]
export const BAND_M = 25
export const MAX_SNAP_M = 100

// Clipper, the shape library, works with whole numbers, so shapes go in as centimetres.
const SCALE = 100
const { Clipper, ClipperOffset, PolyTree, Paths } = ClipperLib
const { ptSubject, ptClip } = ClipperLib.PolyType
const { pftNonZero } = ClipperLib.PolyFillType

const toClipper = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
const fromClipper = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE])

function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

const bboxesOverlap = (a, b, pad = 0) =>
  a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY

// A GeoJSON ring repeats its first point at the end; drop that copy.
function openRing(ring) {
  const [a, b] = [ring[0], ring[ring.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring
}

// Turns the three data files into plain shapes in metres, ready for walking and counting.
export function prepareCity({ kit, buildings, graph, zensus }) {
  const project = makeProjection(kit.center)

  const nodeXY = new Map(graph.nodes.map((n) => [n.id, project([n.lon, n.lat])]))
  const edges = graph.edges
    .filter((e) => e.walkable)
    .map((e) => ({ from: e.from, to: e.to, length: e.length, points: e.coords.map(project) }))
  const neighbours = new Map()
  for (const e of edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!neighbours.has(a)) neighbours.set(a, [])
      neighbours.get(a).push({ node: b, length: e.length })
    }
  }

  const city = buildings.features.map((f) => {
    const rings = f.geometry.coordinates.map((r) => openRing(r).map(project))
    const p = f.properties
    return { id: p.id, use: p.use, height: p.height, floorArea: p.floor_area_m2 ?? {}, rings, bbox: bboxOf(rings[0]) }
  })

  // A coarse grid over the buildings, so each street piece only checks the buildings close to it.
  const GRID = 50
  const grid = new Map()
  city.forEach((b, i) => {
    const { minX, minY, maxX, maxY } = b.bbox
    for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++)
      for (let gy = Math.floor(minY / GRID); gy <= Math.floor(maxY / GRID); gy++) {
        const key = `${gx},${gy}`
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(i)
      }
  })
  const buildingsNear = (box, pad) => {
    const found = new Set()
    for (let gx = Math.floor((box.minX - pad) / GRID); gx <= Math.floor((box.maxX + pad) / GRID); gx++)
      for (let gy = Math.floor((box.minY - pad) / GRID); gy <= Math.floor((box.maxY + pad) / GRID); gy++)
        for (const i of grid.get(`${gx},${gy}`) ?? []) found.add(i)
    return found
  }

  const cells = zensus.features.map((f) => {
    const ring = openRing(f.geometry.coordinates[0]).map(project)
    const path = toClipper(ring)
    return { id: f.properties.id, population: f.properties.population, path, area: Math.abs(Clipper.Area(path)), bbox: bboxOf(ring) }
  })

  return { project, nodeXY, edges, neighbours, buildings: city, buildingsNear, cells }
}

// --- small geometry helpers, all in metres ---

function pointSegmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function segmentSegmentDistance(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function insideRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Shortest distance from a street piece to a building footprint (0 if it runs over the building).
function pieceBuildingDistance(piece, rings) {
  const a0 = piece[0]
  if (insideRing(a0, rings[0]) && !rings.slice(1).some((h) => insideRing(a0, h))) return 0
  let best = Infinity
  for (let k = 0; k < Math.max(1, piece.length - 1); k++) {
    const a = piece[k], b = piece[Math.min(k + 1, piece.length - 1)]
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        best = Math.min(best, segmentSegmentDistance(a, b, ring[i], ring[(i + 1) % ring.length]))
        if (best === 0) return 0
      }
  }
  return best
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

// Cuts a street line between fractions t0 and t1 of its length.
function cutLine(points, t0, t1) {
  const lengths = [0]
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const total = lengths[lengths.length - 1]
  const at = (t) => {
    const d = t * total
    let i = 1
    while (i < points.length - 1 && lengths[i] < d) i++
    const span = lengths[i] - lengths[i - 1]
    return lerp(points[i - 1], points[i], span === 0 ? 0 : (d - lengths[i - 1]) / span)
  }
  const out = [at(t0)]
  for (let i = 1; i < points.length - 1; i++) if (lengths[i] > t0 * total && lengths[i] < t1 * total) out.push(points[i])
  out.push(at(t1))
  return out
}

// --- walking ---

// Walking distance in metres from the start node to every node (Dijkstra's shortest paths).
function walkingDistances(city, start) {
  const dist = new Map([[start, 0]])
  const heap = [[0, start]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, node] = pop()
    if (d > dist.get(node)) continue
    for (const { node: next, length } of city.neighbours.get(node) ?? []) {
      const nd = d + length
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd)
        push([nd, next])
      }
    }
  }
  return dist
}

// The street pieces reached within a walking budget in metres, including the reached part of the last edge.
function reachedPieces(city, dist, budget) {
  const pieces = []
  for (const e of city.edges) {
    const left = Math.max(0, budget - (dist.get(e.from) ?? Infinity))
    const right = Math.max(0, budget - (dist.get(e.to) ?? Infinity))
    if (left + right >= e.length) pieces.push(e.points)
    else {
      if (left > 0) pieces.push(cutLine(e.points, 0, left / e.length))
      if (right > 0) pieces.push(cutLine(e.points, 1 - right / e.length, 1))
    }
  }
  return pieces
}

// A band of BAND_M on each side of every piece, all joined into one shape.
function bandAround(pieces) {
  const offset = new ClipperOffset()
  offset.ArcTolerance = 0.25 * SCALE
  for (const p of pieces) offset.AddPath(toClipper(p), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  const tree = new PolyTree()
  offset.Execute(tree, BAND_M * SCALE)

  const polygons = []
  const visit = (node) => {
    for (const outer of node.Childs()) {
      polygons.push({ outer: fromClipper(outer.Contour()), holes: outer.Childs().map((h) => fromClipper(h.Contour())) })
      for (const hole of outer.Childs()) visit(hole)
    }
  }
  visit(tree)
  return { polygons, paths: Clipper.PolyTreeToPaths(tree) }
}

// Residents in the area: each cell's population times the share of the cell inside the area.
function countResidents(city, paths) {
  const box = bboxOf(paths.flat().map((p) => [p.X / SCALE, p.Y / SCALE]))
  let sum = 0, cellsWithoutFigure = 0, cellsUsed = 0
  for (const cell of city.cells) {
    if (!bboxesOverlap(cell.bbox, box)) continue
    const clipper = new Clipper()
    clipper.AddPath(cell.path, ptSubject, true)
    clipper.AddPaths(paths, ptClip, true)
    const overlap = new Paths()
    clipper.Execute(ClipperLib.ClipType.ctIntersection, overlap, pftNonZero, pftNonZero)
    const area = overlap.reduce((a, p) => a + Clipper.Area(p), 0)
    if (area <= 0) continue
    if (cell.population == null) cellsWithoutFigure++
    else {
      sum += cell.population * (area / cell.area)
      cellsUsed++
    }
  }
  return { residents: Math.round(sum / 10) * 10, exact: sum, cellsWithoutFigure, cellsUsed }
}

// Everything the page shows for one click at [x, y] in metres.
export function computeReach(city, click) {
  // Is there a walkable street within MAX_SNAP_M?
  let streetDistance = Infinity
  for (const e of city.edges)
    for (let i = 1; i < e.points.length; i++)
      streetDistance = Math.min(streetDistance, pointSegmentDistance(click, e.points[i - 1], e.points[i]))
  if (streetDistance > MAX_SNAP_M) return { error: `There is no walkable street within ${MAX_SNAP_M} m of this point. Click closer to a street.` }

  // The nearest node that lies on a walkable edge.
  let start = null, startDistance = Infinity
  for (const id of city.neighbours.keys()) {
    const [x, y] = city.nodeXY.get(id)
    const d = Math.hypot(x - click[0], y - click[1])
    if (d < startDistance) [start, startDistance] = [id, d]
  }

  const dist = walkingDistances(city, start)
  const startXY = city.nodeXY.get(start)
  const buildingLevel = new Int8Array(city.buildings.length).fill(-1)

  // Largest area first; a building that touches a smaller area gets that area's shade.
  const levels = []
  for (let level = MINUTES.length - 1; level >= 0; level--) {
    const minutes = MINUTES[level]
    const pieces = reachedPieces(city, dist, minutes * SPEED_M_PER_MIN)
    pieces.push([startXY, startXY]) // the start node itself, so the area is never empty
    const band = bandAround(pieces)

    const touched = new Set()
    for (const piece of pieces) {
      const box = bboxOf(piece)
      for (const i of city.buildingsNear(box, BAND_M)) {
        if (touched.has(i) || !bboxesOverlap(city.buildings[i].bbox, box, BAND_M)) continue
        if (pieceBuildingDistance(piece, city.buildings[i].rings) <= BAND_M) touched.add(i)
      }
    }
    for (const i of touched) buildingLevel[i] = level

    // Shops: buildings in this area with any retail floor area, largest first.
    const shops = [...touched]
      .filter((i) => city.buildings[i].floorArea.retail > 0)
      .map((i) => ({ index: i, id: city.buildings[i].id, use: city.buildings[i].use, retail: city.buildings[i].floorArea.retail }))
      .sort((a, b) => b.retail - a.retail)

    levels[level] = { minutes, buildings: touched.size, shops, polygons: band.polygons, ...countResidents(city, band.paths) }
  }

  return { start: startXY, startDistance, levels, buildingLevel }
}
