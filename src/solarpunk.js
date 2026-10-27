import * as THREE from 'three'
import { insideRing, distanceToFootprint, pointSegmentDistance, boxPoint } from './shapes.js'
import { SOLARPUNK as C } from './colors.js'

// A solarpunk district grows out from a click: the front moves out to the full radius in
// GROW_SECONDS, and everything within FEATHER_M behind the front fades in, so the edge is soft.
export const GROW_SECONDS = 7
export const FEATHER_M = 45
export const MAX_DISTRICTS = 8

const TAU = Math.PI * 2
const Z = new THREE.Vector3(0, 0, 1)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

// The same click always grows the same district.
function randomFrom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Collects the pieces of the district by layer (one layer = one kind of shape in one material).
// Each piece: position, rotation, size, colour, its distance from the centre (when the front
// reaches it) and its order h from 0 to 1 (low parts of a tower appear before high ones).
function collector() {
  const layers = {}
  const q = new THREE.Quaternion(), e = new THREE.Euler()
  const add = (layer, { p, s, yaw = 0, tilt = 0, dir = null, color, d, h = 0 }) => {
    if (dir) q.setFromUnitVectors(Z, dir)
    else q.setFromEuler(e.set(tilt, 0, yaw, 'ZYX'))
    ;(layers[layer] ??= []).push({ p, q: [q.x, q.y, q.z, q.w], s, color, d, h })
  }
  // Surfaces a person can stand on in photo mode (bridge decks, floors, terraces, roof gardens),
  // each a flat convex outline at height z.
  const stand = []
  const standRect = (x, y, w, dd, yaw, z) => {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    stand.push({ z, pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [x + (c * u * w - s * v * dd) / 2, y + (s * u * w + c * v * dd) / 2]) })
  }
  const standDisc = (x, y, r, z) =>
    stand.push({ z, pts: Array.from({ length: 16 }, (_, k) => [x + Math.cos((k / 16) * TAU) * r, y + Math.sin((k / 16) * TAU) * r]) })
  return { layers, add, stand, standRect, standDisc }
}

// What stands around the click: buildings and streets, with quick distance lookups.
function siteOf(city, c, R) {
  const box = { minX: c[0] - R, minY: c[1] - R, maxX: c[0] + R, maxY: c[1] + R }
  const buildings = [...city.buildingsNear(box, 40)].map((i) => city.buildings[i])

  const near = (p, b, pad) =>
    p[0] >= b.bbox.minX - pad && p[0] <= b.bbox.maxX + pad && p[1] >= b.bbox.minY - pad && p[1] <= b.bbox.maxY + pad
  const buildingDistance = (p, max) => {
    let best = max
    for (const i of city.buildingsNear({ minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] }, max))
      if (near(p, city.buildings[i], best)) best = Math.min(best, distanceToFootprint(p, city.buildings[i].rings))
    return best
  }

  const edges = city.edges.filter((e) => e.points.some(([x, y]) => Math.hypot(x - c[0], y - c[1]) < R + 20))
  const G = 20
  const grid = new Map()
  for (const e of edges)
    for (let k = 1; k < e.points.length; k++) {
      const a = e.points[k - 1], b = e.points[k]
      for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++)
        for (let gy = Math.floor(Math.min(a[1], b[1]) / G); gy <= Math.floor(Math.max(a[1], b[1]) / G); gy++)
          (grid.get(`${gx},${gy}`) ?? grid.set(`${gx},${gy}`, []).get(`${gx},${gy}`)).push([a, b])
    }
  const streetDistance = (p, max) => {
    let best = max
    const r = Math.ceil(max / G)
    const [cx, cy] = [Math.floor(p[0] / G), Math.floor(p[1] / G)]
    for (let gx = cx - r; gx <= cx + r; gx++)
      for (let gy = cy - r; gy <= cy + r; gy++)
        for (const [a, b] of grid.get(`${gx},${gy}`) ?? []) best = Math.min(best, pointSegmentDistance(p, a, b))
    return best
  }
  return { buildings, edges, buildingDistance, streetDistance }
}

function tree(add, rand, x, y, z, size, d, h) {
  const kind = rand()
  const trunk = size * (0.9 + rand() * 0.4)
  add('trunk', { p: [x, y, z], s: [size * 0.11, size * 0.11, trunk], color: C.trunk, d, h })
  if (kind < 0.16) {
    add('conifer', { p: [x, y, z + trunk * 0.45], s: [size * 0.75, size * 0.75, size * 2.4], color: C.conifer, d, h })
  } else {
    const colors = kind > 0.9 ? C.blossom : C.leaves
    const color = colors[Math.floor(rand() * colors.length)]
    add('leaf', { p: [x, y, z + trunk + size * 0.5], s: [size, size, size * 0.85], color, d, h })
  }
}

// An organic garden spire: round floor plates that swell and sway, glass between them,
// a hedge on every floor, hanging gardens, cantilevered terraces and a crown of solar leaves.
function gardenSpire(add, rand, t, { standDisc }) {
  const { p, base, H, r0, d } = t
  const fh = 4.2
  const n = Math.max(6, Math.floor(H / fh))
  const swell = rand() * 0.6, swayDir = rand() * TAU
  let top = [p[0], p[1], base], rTop = r0
  for (let i = 0; i < n; i++) {
    const s = i / n, z = base + i * fh, h = s * 0.9
    const r = r0 * (0.8 + 0.38 * Math.sin(Math.PI * s * 1.15 + swell)) * (1 - 0.3 * s * s)
    const sway = Math.sin(s * Math.PI) * r0 * 0.35
    const x = p[0] + Math.cos(swayDir) * sway, y = p[1] + Math.sin(swayDir) * sway
    add('slab', { p: [x, y, z], s: [r, r, 0.5], color: C.slab, d, h })
    if (i > 0) standDisc(x, y, r, z + 0.5)
    add('glass', { p: [x, y, z + 0.5], s: [r * 0.88, r * 0.88, fh - 0.5], color: C.glass, d, h })
    add('hedge', { p: [x, y, z + 0.75], s: [r * 0.97, r * 0.97, 1.6], color: C.leaves[i % C.leaves.length], d, h })
    if (i % 2 === 0)
      for (let k = 0; k < 4; k++) {
        const a = rand() * TAU, size = 1.2 + rand() * 0.9
        add('leaf', { p: [x + Math.cos(a) * r, y + Math.sin(a) * r, z - size * 0.3], s: [size, size, size * 1.4], color: C.leaves[k % C.leaves.length], d, h })
      }
    if (i % 6 === 3 && i < n - 3) {
      const a = swayDir + i * 0.7
      const tx = x + Math.cos(a) * r * 0.95, ty = y + Math.sin(a) * r * 0.95, tr = r * 0.55
      add('slab', { p: [tx, ty, z], s: [tr, tr, 0.6], color: C.slab, d, h })
      add('lawnDisc', { p: [tx, ty, z + 0.6], s: [tr * 0.94, tr * 0.94, 0.3], color: C.lawn, d, h })
      standDisc(tx, ty, tr * 0.94, z + 0.9)
      for (let k = 0; k < 2; k++) {
        const b = rand() * TAU, rr = tr * 0.5 * rand()
        tree(add, rand, tx + Math.cos(b) * rr, ty + Math.sin(b) * rr, z + 0.9, 1.6 + rand(), d, h)
      }
    }
    top = [x, y, z + fh]
    rTop = r
  }
  add('slab', { p: top, s: [rTop, rTop, 0.5], color: C.slab, d, h: 0.93 })
  add('lawnDisc', { p: [top[0], top[1], top[2] + 0.5], s: [rTop * 0.92, rTop * 0.92, 0.3], color: C.lawn, d, h: 0.93 })
  standDisc(top[0], top[1], rTop * 0.92, top[2] + 0.8)
  const mastTop = top[2] + 7 + H * 0.06
  add('struct', { p: top, s: [0.9, 0.9, mastTop - top[2]], color: C.struct, d, h: 0.95 })
  const K = 9 + Math.floor(rand() * 5)
  for (let j = 0; j < K; j++) {
    const a = (j / K) * TAU + swell, rr = rTop * (0.75 + 0.55 * (j % 2)), z = top[2] + 4 + (j % 2) * 3 + rand() * 2
    const panel = [top[0] + Math.cos(a) * rr, top[1] + Math.sin(a) * rr, z]
    add('solar', { p: panel, s: [6.5, 4, 0.2], yaw: a - Math.PI / 2, tilt: -0.35, color: C.panel, d, h: 0.98 })
    const from = new THREE.Vector3(top[0], top[1], mastTop - 2)
    const dir = new THREE.Vector3(panel[0], panel[1], panel[2]).sub(from)
    const len = dir.length()
    add('struct', { p: [from.x, from.y, from.z], s: [0.35, 0.35, len], dir: dir.normalize(), color: C.struct, d, h: 0.97 })
  }
  for (let k = 0; k < 3; k++) {
    const a = rand() * TAU, rr = rTop * 0.5 * rand()
    tree(add, rand, top[0] + Math.cos(a) * rr, top[1] + Math.sin(a) * rr, top[2] + 0.8, 1.8 + rand(), d, 0.95)
  }
  return top
}

// A terraced hill: stacked glass storeys that shrink and turn as they rise, each roof a garden.
function terraceHill(add, rand, t, { standRect }) {
  const { p, base, H, d } = t
  const fh = 4.2
  const n = Math.max(4, Math.floor(H / fh))
  const w0 = clamp(t.clear * 1.6, 18, 34), d0 = w0 * (0.6 + rand() * 0.3), yaw0 = rand() * Math.PI
  let top = base
  for (let i = 0; i < n; i++) {
    const s = i / n, z = base + i * fh, h = s * 0.9
    const w = w0 * (1 - 0.5 * s), dd = d0 * (1 - 0.5 * s), yaw = yaw0 + i * 0.06
    add('struct', { p: [p[0], p[1], z], s: [w, dd, 0.5], yaw, color: C.slab, d, h })
    add('glassBox', { p: [p[0], p[1], z + 0.5], s: [w * 0.94, dd * 0.94, fh - 0.5], yaw, color: C.glass, d, h })
    add('lawn', { p: [p[0], p[1], z + fh], s: [w, dd, 0.35], yaw, color: C.lawn, d, h: h + 0.05 })
    standRect(p[0], p[1], w, dd, yaw, z + fh + 0.35)
    const corner = (cu, cv) => [p[0] + Math.cos(yaw) * cu - Math.sin(yaw) * cv, p[1] + Math.sin(yaw) * cu + Math.cos(yaw) * cv]
    for (const [su, sv] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const [x, y] = corner((su * w) / 2.15, (sv * dd) / 2.15)
      if (i % 2 === 1) tree(add, rand, x, y, z + fh + 0.3, 1.5 + rand(), d, h + 0.05)
      else add('leaf', { p: [x, y, z + fh + 0.8], s: [1.6, 1.6, 1.2], color: C.leaves[(i + su + 2) % C.leaves.length], d, h: h + 0.05 })
    }
    top = z + fh
  }
  // rows of solar panels on the top garden
  const yaw = yaw0 + (n - 1) * 0.06, rows = d0 * 0.5
  for (let r = -1; r <= 1; r++) {
    const off = (r * rows) / 3.2
    add('solar', { p: [p[0] - Math.sin(yaw) * off, p[1] + Math.cos(yaw) * off, top + 0.6], s: [w0 * 0.4, 2.2, 0.15], yaw, tilt: 0.3, color: C.panel, d, h: 0.97 })
  }
  return [p[0], p[1], top]
}

// Terraced green storeys on top of an existing flat-roofed building: today's Weimar grows upwards.
function crownExisting(add, rand, b, d, { standRect }) {
  const { box } = b.roof
  const yaw = Math.atan2(box.uy, box.ux)
  const levels = 1 + Math.floor(rand() * 3)
  for (let L = 0; L < levels; L++) {
    const inset = 2.5 + L * 3
    const u0 = box.minU + inset, u1 = box.maxU - inset, v0 = box.minV + inset, v1 = box.maxV - inset
    if (u1 - u0 < 6 || v1 - v0 < 6) break
    const [x, y] = boxPoint(box, (u0 + u1) / 2, (v0 + v1) / 2)
    const z = b.height + L * 3.8, h = 0.15 + (L / levels) * 0.6
    add('struct', { p: [x, y, z], s: [u1 - u0, v1 - v0, 0.4], yaw, color: C.slab, d, h })
    add('glassBox', { p: [x, y, z + 0.4], s: [(u1 - u0) * 0.95, (v1 - v0) * 0.95, 3.4], yaw, color: C.glass, d, h })
    add('lawn', { p: [x, y, z + 3.8], s: [u1 - u0, v1 - v0, 0.3], yaw, color: C.lawn, d, h: h + 0.05 })
    standRect(x, y, u1 - u0, v1 - v0, yaw, z + 4.1)
    for (let k = 0; k < 2; k++) {
      const [tx, ty] = boxPoint(box, u0 + (u1 - u0) * (0.2 + 0.6 * rand()), v0 + (v1 - v0) * (0.2 + 0.6 * rand()))
      tree(add, rand, tx, ty, z + 4.1, 1.4 + rand(), d, h + 0.1)
    }
  }
}

export function growDistrict(city, center, radius, born) {
  const [cx, cy] = center
  const rand = randomFrom(Math.round(cx * 73856093) ^ Math.round(cy * 19349663) ^ Math.round(radius))
  const R = radius
  const dist = (p) => Math.hypot(p[0] - cx, p[1] - cy)
  const site = siteOf(city, center, R)
  const on = collector()
  const { layers, add, stand } = on

  // --- towers on open ground: away from buildings and streets, highest near the centre
  const candidates = []
  for (let x = cx - R; x <= cx + R; x += 11)
    for (let y = cy - R; y <= cy + R; y += 11) {
      const p = [x + (rand() - 0.5) * 4, y + (rand() - 0.5) * 4]
      if (dist(p) > R * 0.88) continue
      const b = site.buildingDistance(p, 30), s = site.streetDistance(p, 30)
      if (b < 9 || s < 6) continue
      candidates.push({ p, clear: Math.min(b, s + 5), score: Math.min(b, s + 5) * (0.5 + rand()) })
    }
  candidates.sort((a, b) => b.score - a.score)
  const maxTowers = Math.max(3, Math.round((R * R) / 5500))
  const towers = []
  for (const c of candidates) {
    if (towers.length >= maxTowers) break
    if (towers.every((t) => Math.hypot(t.p[0] - c.p[0], t.p[1] - c.p[1]) > 55)) towers.push({ ...c, base: 0 })
  }
  // Too little open ground: some towers grow out of the roofs of large buildings instead.
  const large = site.buildings
    .filter((b) => !b.roof.pitched && b.roof.area > 700 && b.height < 25 && dist(boxPoint(b.roof.box, (b.roof.box.minU + b.roof.box.maxU) / 2, (b.roof.box.minV + b.roof.box.maxV) / 2)) < R * 0.85)
    .sort((a, b) => b.roof.area - a.roof.area)
  for (const b of large) {
    if (towers.length >= 3) break
    const { box } = b.roof
    const p = boxPoint(box, (box.minU + box.maxU) / 2, (box.minV + box.maxV) / 2)
    if (!insideRing(p, b.rings[0])) continue
    if (towers.every((t) => Math.hypot(t.p[0] - p[0], t.p[1] - p[1]) > 55)) towers.push({ p, clear: 10, base: b.height, onRoof: b })
  }

  for (const t of towers) {
    t.d = dist(t.p)
    const central = 1 - t.d / R
    t.kind = t.clear > 16 && rand() < 0.4 ? 'hill' : 'spire'
    t.H = (55 + 110 * central) * (0.8 + 0.4 * rand())
    if (t.kind === 'hill') t.H = clamp(t.H * 0.55, 30, 85)
    t.r0 = clamp(t.clear * 0.8, 6.5, 12)
    t.top = t.kind === 'hill' ? terraceHill(add, rand, t, on) : gardenSpire(add, rand, t, on)
  }

  // --- skybridges between neighbouring towers, glass tubes with a planted deck
  const bridges = []
  const walkers = []
  const linked = new Set()
  towers.forEach((a, i) => {
    const others = towers
      .map((b, j) => ({ b, j, l: Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) }))
      .filter(({ j, l }) => j !== i && l > 25 && l < 160)
      .sort((x, y) => x.l - y.l)
      .slice(0, 2)
    for (const { b, j } of others) {
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`
      if (linked.has(key)) continue
      linked.add(key)
      const low = Math.max(a.base, b.base) + 10, high = Math.min(a.top[2], b.top[2]) - 6
      if (high <= low) continue
      for (let k = 0; k < (rand() < 0.35 ? 2 : 1); k++) {
        const z = low + (high - low) * (0.25 + 0.55 * rand())
        const A = new THREE.Vector3(a.p[0], a.p[1], z), B = new THREE.Vector3(b.p[0], b.p[1], z)
        const dir = B.clone().sub(A), L = dir.length()
        dir.normalize()
        const yaw = Math.atan2(dir.y, dir.x), mid = A.clone().add(B).multiplyScalar(0.5)
        const d = (a.d + b.d) / 2
        add('struct', { p: [mid.x, mid.y, z], s: [L, 4.5, 0.5], yaw, color: C.struct, d, h: 1 })
        on.standRect(mid.x, mid.y, L, 4.5, yaw, z + 0.5)
        add('glass', { p: [A.x, A.y, z + 2], s: [2.6, 2.6, L], dir, color: C.glass, d, h: 1 })
        for (const side of [-1, 1])
          add('lawn', { p: [mid.x - Math.sin(yaw) * side * 1.7, mid.y + Math.cos(yaw) * side * 1.7, z + 0.5], s: [L, 0.7, 0.45], yaw, color: C.lawn, d, h: 1 })
        bridges.push({ a: i, b: j, z })
        for (let w = 0; w < 4; w++) walkers.push({ path: [[A.x, A.y, z + 0.5], [B.x, B.y, z + 0.5]], along: rand() * L, speed: (1 + rand() * 0.5) * (rand() < 0.5 ? -1 : 1), lane: (rand() - 0.5) * 1.6, color: C.people[Math.floor(rand() * C.people.length)] })
      }
    }
  })

  // --- existing buildings grow green storeys
  let crowned = 0
  for (const b of site.buildings) {
    const r = b.roof
    if (r.pitched || r.area < 260 || b.height > 28 || r.area / r.box.area < 0.72 || towers.some((t) => t.onRoof === b)) continue
    const p = boxPoint(r.box, (r.box.minU + r.box.maxU) / 2, (r.box.minV + r.box.maxV) / 2)
    if (dist(p) > R * 0.95 || rand() > 0.5) continue
    crownExisting(add, rand, b, dist(p), on)
    crowned++
  }

  // --- trees and meadows on the open ground, solar trees along the streets, people resting
  let trees = 0, resting = 0
  for (let x = cx - R; x <= cx + R; x += 7)
    for (let y = cy - R; y <= cy + R; y += 7) {
      const p = [x + (rand() - 0.5) * 6, y + (rand() - 0.5) * 6]
      const d = dist(p)
      if (d > R * 0.98 || rand() > 0.62) continue
      if (site.buildingDistance(p, 3) < 2 || site.streetDistance(p, 3) < 2.5) continue
      if (towers.some((t) => t.base === 0 && Math.hypot(t.p[0] - p[0], t.p[1] - p[1]) < (t.kind === 'hill' ? t.clear * 1.2 : t.r0 * 1.3) + 3)) continue
      if (rand() < 0.07) {
        // a small group sitting or standing on the meadow
        const n = 2 + Math.floor(rand() * 4)
        for (let k = 0; k < n; k++) {
          const a = rand() * TAU
          add('person', { p: [p[0] + Math.cos(a) * 1.4, p[1] + Math.sin(a) * 1.4, 0], s: [1, 1, rand() < 0.5 ? 0.6 : 1], color: C.people[Math.floor(rand() * C.people.length)], d, h: 0.3 })
        }
        resting += n
        continue
      }
      tree(add, rand, p[0], p[1], 0, 2.2 + rand() * 2.6, d, rand() * 0.3)
      trees++
    }

  let solarTrees = 0
  for (const e of site.edges)
    for (let k = 1; k < e.points.length; k++) {
      const a = e.points[k - 1], b = e.points[k], len = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let s = 15; s < len; s += 34) {
        const t = s / len, nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
        const p = [a[0] + (b[0] - a[0]) * t + nx * 3.5, a[1] + (b[1] - a[1]) * t + ny * 3.5]
        const d = dist(p)
        if (d > R * 0.95 || site.buildingDistance(p, 3) < 1.5) continue
        add('struct', { p: [p[0], p[1], 0], s: [0.35, 0.35, 6.5], color: C.struct, d, h: 0.4 })
        add('solar', { p: [p[0], p[1], 6.5], s: [4.6, 4.6, 0.15], yaw: Math.atan2(ny, nx), tilt: 0.18, color: C.panel, d, h: 0.5 })
        solarTrees++
      }
    }

  // --- people walking the streets: they follow the network and turn at its junctions
  const nodeEdges = new Map()
  site.edges.forEach((e, i) => {
    for (const n of [e.from, e.to]) (nodeEdges.get(n) ?? nodeEdges.set(n, []).get(n)).push(i)
  })
  const paths = site.edges.map((e) => {
    const pts = e.points.map(([x, y]) => [x, y, 0])
    return { pts, from: e.from, to: e.to }
  })
  const total = site.edges.reduce((s, e) => s + e.length, 0)
  const street = Math.min(450, Math.round(total / 6))
  for (let k = 0; k < street; k++) {
    let r = rand() * total, i = 0
    while (i < site.edges.length - 1 && r > site.edges[i].length) r -= site.edges[i++].length
    walkers.push({ edge: i, along: r, speed: (1 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1), lane: (rand() - 0.5) * 3, color: C.people[Math.floor(rand() * C.people.length)] })
  }

  // --- the sky tram: a loop through stations on the tall towers
  const stations = towers.filter((t) => t.top[2] - t.base > 60 || t.top[2] > 80)
  let loop
  if (stations.length >= 3) {
    stations.sort((a, b) => Math.atan2(a.p[1] - cy, a.p[0] - cx) - Math.atan2(b.p[1] - cy, b.p[0] - cx))
    loop = stations.map((t) => {
      const a = Math.atan2(t.p[1] - cy, t.p[0] - cx), z = Math.min(t.top[2] * 0.78, 125)
      // a small platform on the outer side of the tower, where the tram stops
      const r = (t.kind === 'hill' ? t.clear * 0.8 : t.r0) + 6
      const sx = t.p[0] + Math.cos(a) * r, sy = t.p[1] + Math.sin(a) * r
      add('slab', { p: [sx, sy, z - 0.6], s: [6, 6, 0.6], color: C.slab, d: t.d, h: 1 })
      on.standDisc(sx, sy, 5.6, z)
      add('hedge', { p: [sx, sy, z], s: [5.8, 5.8, 0.8], color: C.leaves[0], d: t.d, h: 1 })
      add('struct', { p: [t.p[0] + Math.cos(a) * (r - 6), t.p[1] + Math.sin(a) * (r - 6), z - 0.6], s: [12, 3, 0.5], yaw: a, color: C.struct, d: t.d, h: 1 })
      return [sx + Math.cos(a) * 4, sy + Math.sin(a) * 4, z + 1.5]
    })
  } else {
    loop = Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * TAU
      return [cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6, 95 + 10 * Math.sin(a * 2)]
    })
  }

  const flyers = Array.from({ length: 8 }, () => ({
    c: [cx + (rand() - 0.5) * R * 0.8, cy + (rand() - 0.5) * R * 0.8],
    rx: R * (0.25 + 0.4 * rand()),
    ry: R * (0.25 + 0.4 * rand()),
    z: 70 + rand() * 90,
    speed: (0.05 + rand() * 0.06) * (rand() < 0.5 ? -1 : 1),
    phase: rand() * TAU,
  }))
  const airship = { radius: R * 0.7, z: 185, speed: 0.02, phase: rand() * TAU }

  return {
    center, radius, born, layers, stand,
    transit: { loop, pods: Math.max(3, loop.length) },
    flyers, airship,
    walkers: { list: walkers, paths, nodeEdges },
    stats: { towers: towers.length, bridges: bridges.length, crowned, trees, solarTrees, people: walkers.length + resting },
  }
}

// How far the growing front has come, in metres, at time `now` (ms). It ends one feather beyond
// the radius, so everything inside the radius has fully grown and the edge fades out just outside.
export function frontAt(district, now) {
  const t = clamp((now - district.born) / 1000 / GROW_SECONDS, 0, 1)
  return (district.radius + FEATHER_M) * (1 - Math.pow(1 - t, 3))
}
