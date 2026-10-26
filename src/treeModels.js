import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { random } from './trees.js'

// Four tree models, grown in code once and then copied, turned, scaled and tinted for every tree.
// Each model has wood (trunk, branches and twigs as tapering tubes) and leaves: small square "leaf
// cards", each painted with a cluster of leaves (or a spray of needles) and cut out along their edges.
// All sizes are in metres, z up, before each tree's own scale.
//
//   lime    a round crown on a short trunk
//   oak     a broad, spreading crown
//   poplar  tall and narrow, branches climbing steeply along the stem
//   spruce  a cone of whorls of drooping branches around one straight stem
const SPECIES = {
  lime: { height: 15, trunk: 4, mains: 9, spread: 0.6, angle: [35, 70], reach: 5, taper: 0.5, lift: 0.15, subs: 3, twig: 2.4, cluster: 1.7, cards: 6, leaf: 1.7, lowest: 3.2, radius: 0.32 },
  oak: { height: 14, trunk: 3.5, mains: 7, spread: 0.5, angle: [50, 82], reach: 6.5, taper: 0.45, lift: 0.08, subs: 3, twig: 3, cluster: 1.9, cards: 6, leaf: 1.8, lowest: 3, radius: 0.4 },
  poplar: { height: 22, trunk: 2.5, mains: 14, spread: 1, angle: [8, 26], reach: 4, taper: 0.6, lift: 0.3, subs: 2, twig: 1.6, cluster: 1.2, cards: 5, leaf: 1.4, lowest: 3, radius: 0.3 },
  spruce: { height: 18, radius: 0.3, skirt: 3.6, whorl: 0.9, leaf: 1.6, lowest: 1.6 },
}
export const SPECIES_NAMES = Object.keys(SPECIES)

const UP = new THREE.Vector3(0, 0, 1)
const Y = new THREE.Vector3(0, 1, 0)

// One branch: a tapering six-sided tube from a to b.
function limb(a, b, ra, rb) {
  const length = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(rb, ra, length, 6, 1, true)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  g.deleteAttribute('uv')
  return g
}

// Leaf cards: each a square of `size` metres at `center`, facing `facing`, showing one half of the
// leaf image: broad leaves on the left, needles on the right.
function cardsGeometry(cards, crownCenter, crownRadius, height, outwardOnly) {
  const pos = [], nor = [], uv = [], col = []
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n = new THREE.Vector3()
  for (const { center, facing, size, needles, spin } of cards) {
    t1.crossVectors(facing, Math.abs(facing.z) < 0.9 ? UP : Y).normalize().applyAxisAngle(facing, spin)
    t2.crossVectors(facing, t1).normalize()
    // Light the crown as one soft volume: each card is lit as if it faced away from the crown's centre,
    // and cards deep inside or low down are darker, as if shaded by the leaves around them.
    n.copy(center).sub(crownCenter)
    if (outwardOnly) n.z = 0
    n.normalize().addScaledVector(UP, 0.45).normalize()
    const outward = Math.min(1, center.distanceTo(crownCenter) / crownRadius)
    const shade = 0.42 + 0.4 * outward ** 1.5 + 0.18 * Math.min(1, center.z / height)
    const u0 = needles ? 0.5 : 0
    const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]
    for (const [a, b, u, v] of corners) {
      pos.push(center.x + (t1.x * a + t2.x * b) * size / 2, center.y + (t1.y * a + t2.y * b) * size / 2, center.z + (t1.z * a + t2.z * b) * size / 2)
      nor.push(n.x, n.y, n.z)
      uv.push(u0 + u * 0.5, v)
      col.push(shade, shade, shade)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

// Bark: grey-brown, a little darker at the foot.
function woodGeometry(limbs, height) {
  const g = mergeGeometries(limbs)
  const p = g.attributes.position, col = []
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.25 * Math.min(1, p.getZ(i) / height)
    col.push(0.36 * k, 0.3 * k, 0.25 * k)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

const randomUnit = (rand) => {
  const u = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u)
  return new THREE.Vector3(s * Math.cos(a), s * Math.sin(a), u)
}

// A broad-leaved tree: a trunk that carries on as a leader into the crown, main branches around it
// (low ones more level, high ones steeper), twigs off each main branch, and leaf clusters at every tip.
function broadleaf(spec, rand) {
  const limbs = [], cards = []
  const lean = new THREE.Vector3((rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5, 0)
  const fork = new THREE.Vector3(0, 0, spec.trunk).addScaledVector(lean, 0.4)
  const top = new THREE.Vector3(0, 0, spec.height * 0.82).add(lean)
  limbs.push(limb(new THREE.Vector3(), fork, spec.radius, spec.radius * 0.8), limb(fork, top, spec.radius * 0.8, spec.radius * 0.2))

  const cluster = (at, count = spec.cards) => {
    for (let k = 0; k < count; k++) {
      const center = at.clone().addScaledVector(randomUnit(rand), spec.cluster * rand() ** 0.5)
      center.z = Math.max(center.z, spec.lowest)
      cards.push({ center, facing: randomUnit(rand), size: spec.leaf * (0.8 + rand() * 0.4), spin: rand() * Math.PI * 2 })
    }
  }
  cluster(top, spec.cards + 3)

  for (let i = 0; i < spec.mains; i++) {
    const f = i / (spec.mains - 1)
    const start = new THREE.Vector3().lerpVectors(fork, top, f * spec.spread)
    const tilt = THREE.MathUtils.degToRad(spec.angle[1] + (spec.angle[0] - spec.angle[1]) * f + (rand() - 0.5) * 10)
    const turn = i * 2.4 + rand() * 0.5 // the golden angle, so branches spread evenly around the stem
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(turn), Math.sin(tilt) * Math.sin(turn), Math.cos(tilt))
    const length = spec.reach * (1 - f * spec.taper) * (0.8 + rand() * 0.4)
    const mid = start.clone().addScaledVector(dir, length * 0.5).addScaledVector(UP, length * spec.lift * 0.4)
    const end = start.clone().addScaledVector(dir, length).addScaledVector(UP, length * spec.lift)
    const r = spec.radius * 0.45 * (1 - f * 0.5)
    limbs.push(limb(start, mid, r, r * 0.7), limb(mid, end, r * 0.7, r * 0.3))
    cluster(end)

    for (let j = 0; j < spec.subs; j++) {
      const from = new THREE.Vector3().lerpVectors(mid, end, rand())
      const side = randomUnit(rand).cross(dir).normalize()
      const twigDir = dir.clone().addScaledVector(side, 0.8).addScaledVector(UP, 0.35).normalize()
      const to = from.clone().addScaledVector(twigDir, spec.twig * (0.7 + rand() * 0.6))
      limbs.push(limb(from, to, r * 0.35, r * 0.12))
      cluster(to)
    }
  }
  return { limbs, cards }
}

// A spruce: one straight stem, and whorls of drooping branches, longest at the bottom, with needle
// sprays lying along each branch.
function spruce(spec, rand) {
  const limbs = [limb(new THREE.Vector3(), new THREE.Vector3(0, 0, spec.height), spec.radius, 0.04)]
  const cards = []
  for (let z = spec.lowest; z < spec.height - 0.6; z += spec.whorl * (0.85 + rand() * 0.3)) {
    const f = (z - spec.lowest) / (spec.height - spec.lowest)
    const reach = spec.skirt * (1 - f) ** 0.9 + 0.35
    const count = 5 + Math.floor(rand() * 2)
    for (let b = 0; b < count; b++) {
      const a = (b / count) * Math.PI * 2 + z * 1.3 + rand() * 0.4
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), -0.2 - rand() * 0.15).normalize()
      const start = new THREE.Vector3(0, 0, z)
      limbs.push(limb(start, start.clone().addScaledVector(dir, reach), 0.06 * (1 - f) + 0.02, 0.015))
      for (const t of [0.4, 0.8]) {
        const facing = UP.clone().addScaledVector(randomUnit(rand), 0.35).normalize()
        cards.push({ center: start.clone().addScaledVector(dir, reach * t), facing, size: spec.leaf * (0.55 + 0.6 * (1 - f)) * (0.5 + t * 0.6), needles: true, spin: a })
      }
    }
  }
  for (let k = 0; k < 4; k++) cards.push({ center: new THREE.Vector3(0, 0, spec.height - 0.6 - k * 0.4), facing: randomUnit(rand), size: 0.9, needles: true, spin: rand() * 6 })
  return { limbs, cards }
}

// The leaf image: broad leaves on the left half, needle sprays on the right half, on a clear background.
function leafTexture(rand) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const g = canvas.getContext('2d')
  for (let i = 0; i < 34; i++) {
    const r = 100 * Math.sqrt(rand()), a = rand() * Math.PI * 2
    const length = 30 + rand() * 22, width = length * 0.42
    g.save()
    g.translate(128 + r * Math.cos(a), 128 + r * Math.sin(a))
    g.rotate(rand() * Math.PI * 2)
    g.fillStyle = `hsl(${92 + rand() * 26}, ${42 + rand() * 18}%, ${22 + rand() * 22}%)`
    g.beginPath()
    g.moveTo(0, -length / 2)
    g.quadraticCurveTo(width, 0, 0, length / 2)
    g.quadraticCurveTo(-width, 0, 0, -length / 2)
    g.fill()
    g.restore()
  }
  g.lineCap = 'round'
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.4, length = 70 + rand() * 40
    const [sx, sy] = [384 + Math.cos(a) * 12, 128 + Math.sin(a) * 12]
    g.strokeStyle = `hsl(${150 + rand() * 25}, ${25 + rand() * 15}%, ${15 + rand() * 12}%)`
    g.lineWidth = 2.5
    for (let d = 0; d < length; d += 5) {
      const [x, y] = [sx + Math.cos(a) * d, sy + Math.sin(a) * d]
      const n = 9 * (1 - d / length) + 4
      for (const s of [-1, 1]) {
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + Math.cos(a + s * 1.0) * n, y + Math.sin(a + s * 1.0) * n)
        g.stroke()
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

// A soft round shadow for the ground under each crown: dark in the middle, fading out.
function shadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.45)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

// Builds the four models (wood and leaves), the leaf image and the ground shadow, all once.
export function makeTreeModels() {
  const rand = random(1925) // the year the Bauhaus moved from Weimar to Dessau
  const models = {}
  for (const [name, spec] of Object.entries(SPECIES)) {
    const { limbs, cards } = name === 'spruce' ? spruce(spec, rand) : broadleaf(spec, rand)
    const center = cards.reduce((c, card) => c.add(card.center), new THREE.Vector3()).divideScalar(cards.length)
    const radius = Math.max(...cards.map((card) => Math.hypot(card.center.x, card.center.y))) + spec.leaf / 2
    const crownRadius = Math.max(...cards.map((card) => card.center.distanceTo(center)))
    models[name] = {
      wood: woodGeometry(limbs, spec.height),
      leaves: cardsGeometry(cards, name === 'spruce' ? new THREE.Vector3(0, 0, center.z) : center, crownRadius, spec.height, name === 'spruce'),
      radius,
      cards: cards.length,
    }
  }
  return { models, leafImage: leafTexture(rand), shadowImage: shadowTexture() }
}
