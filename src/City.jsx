import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { colorForUse, GROUND_COLOR, STREET_COLOR, PARK_COLOR, BACKGROUND_COLOR, NIGHT, ROUTE_COLORS } from './colors.js'
import { drape } from './terrain.js'
import { insideRing } from './reach.js'

// The scene is built in metres with x to the east, y to the north and z up.
// One rotation of the whole group turns it into three.js's "y is up".
const TO_Y_UP = [-Math.PI / 2, 0, 0]
const toWorld = ([x, y], z = 0) => new THREE.Vector3(x, z, -y)
const noRaycast = () => null

// The timing of the show, in seconds and metres.
const GROW_S = 0.35 // how long one edge takes to light up
const PATH_S = 1.8 // drawing the found route
const HOLD_S = 0.8 // a pause before the walk
const FLY_S = 1.8 // flying down to the street, and back up after the walk
const GLIDE_S = 2 // moving the camera to frame the route while the search runs
const LOW_M = 30 // below this camera height the route is shown as a thin guide line
export const WALK_M_PER_S = 40 // about thirty times walking pace
const LOOK_AHEAD_M = 30 // the camera turns towards the route this far ahead
const ROUND_M = 6 // corners are rounded off by averaging the route this far behind and ahead
export const EYE_M = 1.7

// Lenses. The overview is a near-parallel, isometric view: a 1° lens from far away, so lines that are
// parallel in the city stay (almost) parallel on screen, looking from the south-west at the classic
// isometric angle, 35° down. The walkthrough uses a 15 mm lens on a full-frame camera (36 × 24 mm film),
// about 100° across, with the 36 mm side along the window's longer side.
const OVERVIEW_FOV = 1
const FOCAL_MM = 15
const FILM_MM = 36
const ISO_DIR = new THREE.Vector3(-1, 1, 1).normalize() // from the point looked at towards the camera
const walkFov = (aspect) => (360 / Math.PI) * Math.atan(FILM_MM / Math.max(aspect, 1) / 2 / FOCAL_MM)
// How far away the overview camera stands to show `size` metres from the top to the bottom of the window.
const overviewDistance = (size) => size / 2 / Math.tan((OVERVIEW_FOV * Math.PI) / 360)

// The camera only draws what lies between its near and far planes; keep them around what it looks at.
function setLens(camera, fov, distance) {
  camera.fov = fov
  camera.near = Math.max(0.1, distance - 4000)
  camera.far = distance + 5000
  camera.updateProjectionMatrix()
}

// A view of the camera: the point it looks at, the direction from there back to the camera, how far
// away it stands, and its lens. Blending two views is a "dolly zoom": the lens widens or narrows as the
// camera moves, so the view changes smoothly from the isometric overview to the street, and back.
const viewOf = (camera, look) => ({ look: look.clone(), dir: camera.position.clone().sub(look).normalize(), dist: camera.position.distanceTo(look), fov: camera.fov })

function blendViews(a, b, k, camera) {
  const [ta, tb] = [Math.tan((a.fov * Math.PI) / 360), Math.tan((b.fov * Math.PI) / 360)]
  const mix = (p, q) => Math.exp(Math.log(p) + (Math.log(q) - Math.log(p)) * k) // halfway in ratio, not in metres
  const tanHalf = mix(ta, tb)
  const dist = mix(a.dist * ta, b.dist * tb) / tanHalf // the width of the view changes evenly, too
  const look = new THREE.Vector3().lerpVectors(a.look, b.look, Math.min(1, k * 1.3))
  const dir = new THREE.Vector3().lerpVectors(a.dir, b.dir, k).normalize()
  camera.position.copy(look).addScaledVector(dir, dist)
  camera.lookAt(look)
  setLens(camera, (360 / Math.PI) * Math.atan(tanHalf), dist)
  return { look, dist }
}

// All buildings in one mesh: walls and flat roofs from footprint and height.
// `ranges` remembers which vertices belong to which building, so we can light them up.
// On a slope the walls start a metre below the lowest ground under the footprint, so no building
// floats, and the roof is `height` above the average ground under it.
function buildingsGeometry(buildings, terrain) {
  const pos = [], nor = [], col = [], ranges = []
  const push = (x, y, z, nx, ny, nz, c) => {
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
    col.push(c.r, c.g, c.b)
  }
  for (const b of buildings) {
    const c = new THREE.Color(colorForUse(b.use))
    const grounds = b.rings[0].map(([x, y]) => terrain.heightAt(x, y))
    const floor = Math.min(...grounds) - 1
    const h = grounds.reduce((a, g) => a + g, 0) / grounds.length + b.height
    const start = pos.length / 3
    let [outer, ...holes] = b.rings.map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)))
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse()
    holes = holes.map((ring) => (THREE.ShapeUtils.isClockWise(ring) ? ring : ring.reverse()))

    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const nx = (q.y - p.y) / len, ny = -(q.x - p.x) / len
        push(p.x, p.y, floor, nx, ny, 0, c); push(q.x, q.y, floor, nx, ny, 0, c); push(q.x, q.y, h, nx, ny, 0, c)
        push(p.x, p.y, floor, nx, ny, 0, c); push(q.x, q.y, h, nx, ny, 0, c); push(p.x, p.y, h, nx, ny, 0, c)
      }
    }

    const all = [outer, ...holes].flat()
    for (const [a, b2, c2] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      let [A, B, C] = [all[a], all[b2], all[c2]]
      if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) [B, C] = [C, B]
      push(A.x, A.y, h, 0, 0, 1, c); push(B.x, B.y, h, 0, 0, 1, c); push(C.x, C.y, h, 0, 0, 1, c)
    }
    ranges.push([start, pos.length / 3])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geometry.setAttribute('glow', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
  geometry.computeBoundingSphere()
  return { geometry, ranges }
}

// Buildings near a clicked point light up in the marker's colour, in a wave spreading outwards.
const GLOW_RADIUS_M = 70
const GLOW_S = 1.2
const GLOW_STRENGTH = 0.6

// The material colour tints all buildings at once, for the night fade. The glow is added
// on top as light of its own, so it stays bright at night.
function glowingLambert() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 glow;\nvarying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;')
  }
  return material
}

function Buildings({ buildings, terrain, materials, highlights, onPick }) {
  const { geometry, ranges } = useMemo(() => buildingsGeometry(buildings, terrain), [buildings, terrain])
  const material = useMemo(glowingLambert, [])
  materials.buildings = material

  // For each highlight, the buildings within reach and how far away they are, as a share of the radius.
  const lit = useRef([])
  const dirty = useRef(false) // the highlights changed: repaint at least once
  useEffect(() => {
    const before = lit.current
    lit.current = highlights.map(({ xy: [x, y], color: hex }) => {
      const key = `${hex} ${x} ${y}`
      const same = before.find((h) => h.key === key) // an unchanged point keeps its glow
      if (same) return same
      const near = []
      buildings.forEach((b, i) => {
        const { minX, minY, maxX, maxY } = b.bbox
        const d = Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minY - y, 0, y - maxY))
        if (d < GLOW_RADIUS_M) near.push({ i, share: d / GLOW_RADIUS_M })
      })
      return { key, color: new THREE.Color(hex), near, t: 0 }
    })
    dirty.current = true
  }, [highlights, buildings, geometry])

  useFrame((_, delta) => {
    if (!dirty.current && !lit.current.some((h) => h.t < GLOW_S)) return
    dirty.current = false
    const glow = geometry.attributes.glow
    glow.array.fill(0)
    for (const h of lit.current) {
      h.t = Math.min(GLOW_S, h.t + Math.min(delta, 0.1))
      for (const { i, share } of h.near) {
        // Closer buildings light up first and brighter.
        const g = GLOW_STRENGTH * (1 - share) ** 1.5 * Math.min(1, Math.max(0, (h.t / GLOW_S - share * 0.6) / 0.4))
        if (g <= 0) continue
        const [from, to] = ranges[i]
        for (let v = from; v < to; v++) {
          glow.array[v * 3] += h.color.r * g
          glow.array[v * 3 + 1] += h.color.g * g
          glow.array[v * 3 + 2] += h.color.b * g
        }
      }
    }
    glow.needsUpdate = true
  })

  return <mesh geometry={geometry} material={material} onClick={onPick} />
}

// How far above the ground each line and strip floats, so it is not hidden in the ground.
const LIFT = { street: 0.5, explored: 0.7, halo: 0.8, path: 0.9 }

function Streets({ edges, terrain, materials }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const e of edges) {
      const line = drape(terrain, e.points, LIFT.street)
      for (let i = 1; i < line.length; i++) pos.push(...line[i - 1], ...line[i])
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  }, [edges, terrain])
  return (
    <lineSegments geometry={geometry} raycast={noRaycast} renderOrder={4}>
      {/* "transparent" puts the streets in the same drawing pass as the route, before it */}
      <lineBasicMaterial color={STREET_COLOR} transparent depthWrite={false} ref={(m) => { materials.street = m }} />
    </lineSegments>
  )
}

// The ground: one surface through all the terrain grid points, shaded by the light so slopes show,
// pale where it is plain ground and green inside the parks.
function Ground({ terrain, parks, materials, onPick }) {
  const geometry = useMemo(() => {
    const { x0, y0, step, cols, rows, heights } = terrain
    const pos = new Float32Array(cols * rows * 3), col = new Float32Array(cols * rows * 3)
    const plain = new THREE.Color(GROUND_COLOR), park = new THREE.Color(PARK_COLOR)
    const boxes = parks.map(([outer]) => {
      let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const [x, y] of outer) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)]
      return { minX, minY, maxX, maxY }
    })
    const inPark = (p) =>
      parks.some(([outer, ...holes], k) => {
        const b = boxes[k]
        return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY && insideRing(p, outer) && !holes.some((h) => insideRing(p, h))
      })
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c, x = x0 + c * step, y = y0 + r * step
        pos.set([x, y, heights[k]], k * 3)
        const tint = inPark([x, y]) ? park : plain
        col.set([tint.r, tint.g, tint.b], k * 3)
      }
    const index = []
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1
        index.push(a, b, e, a, e, d)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }, [terrain, parks])
  return (
    <mesh geometry={geometry} onClick={onPick} renderOrder={0}>
      {/* the material colour tints the whole ground at once, for the night fade */}
      <meshLambertMaterial vertexColors polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} ref={(m) => { materials.terrain = m }} />
    </mesh>
  )
}

// The trees as one point cloud. Each point is a round dot about half a metre wide, never smaller
// than a pixel and a half, so the parks still read from far away, and never larger than 14 pixels,
// so crowns close to the camera stay leafy instead of turning into large discs. The crowns sway a little in the wind.
function Trees({ positions, colors, lifts, materials }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setAttribute('aLift', new THREE.BufferAttribute(lifts, 1))
    g.computeBoundingSphere()
    return g
  }, [positions, colors, lifts])
  const material = useMemo(() => {
    const m = new THREE.PointsMaterial({ size: 0.55, sizeAttenuation: true, vertexColors: true })
    m.userData.time = { value: 0 }
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = m.userData.time
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aLift;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xy += sin(uTime * 1.3 + position.x * 0.2 + position.y * 0.15) * 0.02 * aLift;')
        .replace('#include <logdepthbuf_vertex>', 'gl_PointSize = clamp(gl_PointSize, 1.5, 14.0);\n#include <logdepthbuf_vertex>')
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\n  if (length(gl_PointCoord - 0.5) > 0.5) discard;')
    }
    return m
  }, [])
  materials.trees = material
  useFrame(({ clock }) => {
    material.userData.time.value = clock.elapsedTime
  })
  return <points geometry={geometry} material={material} raycast={noRaycast} />
}

// While you orbit and zoom the overview, keep the near and far planes around the point looked at.
function OverviewLens() {
  useFrame(({ camera, controls }) => {
    if (!controls?.enabled) return
    const d = camera.position.distanceTo(controls.target)
    if (Math.abs(camera.far - (d + 5000)) > 1) setLens(camera, camera.fov, d)
  })
  return null
}

// Fades the city between day and night: night while a route is shown, so the search glows.
function NightFade({ on, materials }) {
  const night = useRef(0)
  const day = useMemo(() => ({ background: new THREE.Color(BACKGROUND_COLOR), terrain: new THREE.Color('#ffffff'), street: new THREE.Color(STREET_COLOR), buildings: new THREE.Color('#ffffff'), trees: new THREE.Color('#ffffff') }), [])
  const dark = useMemo(() => Object.fromEntries(Object.entries(NIGHT).map(([k, c]) => [k, new THREE.Color(c)])), [])
  useFrame(({ scene }, dt) => {
    const before = night.current
    night.current = THREE.MathUtils.damp(night.current, on ? 1 : 0, 3, Math.min(dt, 0.1))
    if (Math.abs(before - night.current) < 1e-4) return
    const k = night.current
    scene.background?.lerpColors(day.background, dark.background, k)
    for (const key of ['terrain', 'street', 'buildings', 'trees']) materials[key]?.color.lerpColors(day[key], dark[key], k)
  })
  return null
}

// Strips lying on the ground along lines, following the slopes. `values` holds one number per point,
// which the shaders read: the moment an edge lights up, or the distance along the route.
// At corners and ends each piece runs on by half a width, so corners have no gaps. Along a straight
// stretch it doesn't, or the see-through pieces would overlap and show darker bands.
function ribbonGeometry(lines, width, lift, terrain) {
  const pos = [], val = []
  const direction = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return len === 0 ? null : [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
  }
  const turns = (u, v) => !u || !v || u[0] * v[0] + u[1] * v[1] < 0.999
  for (const line of lines) {
    const { points, values } = drape(terrain, line.points, lift, terrain.step, line.values)
    for (let i = 1; i < points.length; i++) {
      const [ax, ay, az] = points[i - 1], [bx, by, bz] = points[i]
      const here = direction(points[i - 1], points[i])
      if (!here) continue
      const before = i > 1 ? direction(points[i - 2], points[i - 1]) : null
      const after = i < points.length - 1 ? direction(points[i], points[i + 1]) : null
      const dx = here[0] * (width / 2), dy = here[1] * (width / 2)
      const [rs, re] = [turns(before, here) ? 1 : 0, turns(here, after) ? 1 : 0]
      const [sx, sy, ex, ey] = [ax - dx * rs, ay - dy * rs, bx + dx * re, by + dy * re]
      const [va, vb] = [values[i - 1], values[i]]
      pos.push(sx - dy, sy + dx, az, sx + dy, sy - dx, az, ex - dy, ey + dx, bz)
      pos.push(ex - dy, ey + dx, bz, sx + dy, sy - dx, az, ex + dy, ey - dx, bz)
      val.push(va, va, vb, vb, va, vb)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('aValue', new THREE.Float32BufferAttribute(val, 1))
  return geometry
}

const RIBBON_VERTEX = /* glsl */ `
  attribute float aValue;
  varying float vValue;
  void main() {
    vValue = aValue;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

// Explored edges: invisible until their moment, then a white flash that cools to blue.
const EXPLORED_FRAGMENT = /* glsl */ `
  uniform float uTime, uFade;
  uniform vec3 uSettled, uFresh;
  varying float vValue;
  void main() {
    float age = uTime - vValue;
    if (age < 0.0) discard;
    float flash = exp(-age * 2.5);
    gl_FragColor = vec4(mix(uSettled, uFresh, flash), uFade * (0.6 + 0.4 * flash));
    #include <colorspace_fragment>
  }`

// The route: drawn from origin to destination with a bright tip, coloured from the origin's
// colour to the destination's, with light pulses running along it.
const PATH_FRAGMENT = /* glsl */ `
  uniform float uDraw, uTime, uLength, uAlpha;
  uniform vec3 uFrom, uTo;
  varying float vValue;
  void main() {
    float head = uDraw * uLength;
    if (vValue > head) discard;
    vec3 color = mix(uFrom, uTo, clamp(vValue / uLength, 0.0, 1.0));
    float tip = exp(-(head - vValue) / 12.0) * step(uDraw, 0.999);
    float pulse = smoothstep(0.85, 1.0, fract((vValue - uTime * 90.0) / 160.0));
    gl_FragColor = vec4(mix(color, vec3(1.0), max(tip, pulse * 0.6)), uAlpha);
    #include <colorspace_fragment>
  }`

// Nodes: a white dot while waiting on the frontier, a ring that bursts outwards when settled.
const NODES_VERTEX = /* glsl */ `
  attribute float aPush, aPop;
  uniform float uTime, uPixels;
  varying float vKind, vAge;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = 0.0;
    vKind = 0.0;
    vAge = 0.0;
    if (uTime >= aPush && uTime < aPop) {
      size = 7.0;
      vKind = 1.0;
    } else if (uTime >= aPop && uTime < aPop + 0.7) {
      vAge = (uTime - aPop) / 0.7;
      size = mix(6.0, 40.0, vAge);
      vKind = 2.0;
    }
    gl_PointSize = size * uPixels / -mv.z;
  }`

const NODES_FRAGMENT = /* glsl */ `
  uniform float uFade;
  uniform vec3 uFrontier, uBurst;
  varying float vKind, vAge;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (vKind < 0.5 || r > 1.0) discard;
    float alpha;
    vec3 color;
    if (vKind < 1.5) {
      alpha = 1.0 - smoothstep(0.5, 1.0, r);
      color = uFrontier;
    } else {
      alpha = smoothstep(0.65, 0.85, r) * (1.0 - smoothstep(0.9, 1.0, r)) * (1.0 - vAge);
      color = uBurst;
    }
    gl_FragColor = vec4(color, alpha * uFade);
    #include <colorspace_fragment>
  }`

const glow = (vertexShader, fragmentShader, uniforms) =>
  new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide })

const color = (hex) => ({ value: new THREE.Color(hex) })
const ease = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.min(1, Math.max(0, t))

// The camera's spot `d` metres along the route: the route averaged a little behind and ahead, which rounds off corners.
const glidePoint = (route, d) =>
  [-ROUND_M, 0, ROUND_M].map((o) => pointAlong(route, d + o)).reduce((a, p) => [a[0] + p[0] / 3, a[1] + p[1] / 3], [0, 0])

// The point on the route `d` metres from the origin.
function pointAlong(route, d) {
  const { points, along } = route
  if (d <= 0) return points[0]
  for (let i = 1; i < points.length; i++)
    if (along[i] >= d) {
      const t = (d - along[i - 1]) / (along[i] - along[i - 1] || 1)
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
    }
  return points[points.length - 1]
}

// The replay of the search, the route, and the first-person walk along it.
// It is mounted afresh for every route, so its clock starts at zero.
function RouteShow({ city, terrain, route, walkCmd, onPhase, progressRef }) {
  const { camera, scene, controls } = useThree()
  // A point on the ground, in the scene, `above` metres over it.
  const onGround = (p, above = 0) => toWorld(p, terrain.heightAt(p[0], p[1]) + above)

  const show = useMemo(() => {
    // Replay speed: about four seconds for a long search, never slower than 60 steps a second.
    const rate = Math.min(250, Math.max(60, route.expanded.length / 4))
    const searchEnd = route.expanded.length / rate + GROW_S

    const explored = ribbonGeometry(
      route.relaxed.map(({ step, points }) => {
        const along = [0]
        for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
        const total = along[along.length - 1] || 1
        return { points, values: along.map((a) => step / rate + (GROW_S * a) / total) }
      }),
      2.2,
      LIFT.explored,
      terrain,
    )
    const pathLine = [{ points: route.points, values: route.along }]
    const path = ribbonGeometry(pathLine, 4.5, LIFT.path, terrain)
    const halo = ribbonGeometry(pathLine, 16, LIFT.halo, terrain)
    const guide = ribbonGeometry(pathLine, 0.8, LIFT.path, terrain) // seen from eye height, the wide strip would fill the street

    const popStep = new Map(route.expanded.map((n, i) => [n, i]))
    const ids = [...city.neighbours.keys()]
    const nodes = new THREE.BufferGeometry()
    nodes.setAttribute('position', new THREE.Float32BufferAttribute(ids.flatMap((id) => {
      const [x, y] = city.nodeXY.get(id)
      return [x, y, terrain.heightAt(x, y) + 1.5]
    }), 3))
    nodes.setAttribute('aPush', new THREE.Float32BufferAttribute(ids.map((id) => (route.pushStep.has(id) ? route.pushStep.get(id) / rate + GROW_S : 1e6)), 1))
    nodes.setAttribute('aPop', new THREE.Float32BufferAttribute(ids.map((id) => (popStep.has(id) ? popStep.get(id) / rate : 1e6)), 1))

    const materials = {
      explored: glow(RIBBON_VERTEX, EXPLORED_FRAGMENT, { uTime: { value: 0 }, uFade: { value: 1 }, uSettled: color(ROUTE_COLORS.explored), uFresh: color(ROUTE_COLORS.fresh) }),
      nodes: glow(NODES_VERTEX, NODES_FRAGMENT, { uTime: { value: 0 }, uPixels: { value: 800 }, uFade: { value: 1 }, uFrontier: color(ROUTE_COLORS.frontier), uBurst: color(ROUTE_COLORS.fresh) }),
    }
    const pathUniforms = (alpha) => ({ uDraw: { value: 0 }, uTime: { value: 0 }, uLength: { value: route.drawnLength || 1 }, uAlpha: { value: alpha }, uFrom: color(ROUTE_COLORS.origin), uTo: color(ROUTE_COLORS.destination) })
    materials.path = glow(RIBBON_VERTEX, PATH_FRAGMENT, pathUniforms(1))
    materials.halo = glow(RIBBON_VERTEX, PATH_FRAGMENT, pathUniforms(0.22))
    materials.guide = glow(RIBBON_VERTEX, PATH_FRAGMENT, pathUniforms(0.95))
    materials.guide.uniforms.uDraw.value = 1

    // The isometric view of the whole route, during the search and after the walk.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of route.points) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)]
    const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2]
    const target = toWorld([cx, cy], terrain.heightAt(cx, cy))
    const overview = { look: target, dir: ISO_DIR.clone(), dist: overviewDistance(Math.max(250, Math.max(maxX - minX, maxY - minY) * 1.3)), fov: OVERVIEW_FOV }

    return { rate, searchEnd, explored, path, halo, guide, nodes, materials, overview }
  }, [city, terrain, route])

  useEffect(
    () => () => {
      for (const key of ['explored', 'path', 'halo', 'guide', 'nodes']) show[key].dispose()
      for (const m of Object.values(show.materials)) m.dispose()
    },
    [show],
  )

  // t: seconds since the route was found. walk: the camera ride, while it lasts.
  const clock = useRef({ t: 0, walk: null, found: false, walked: false })
  const pathMesh = useRef()
  const guideMesh = useRef()

  // The camera at the start of the walk: at eye height on the origin, looking along the route.
  const streetView = (aspect) => {
    const eye = onGround(glidePoint(route, 0), EYE_M)
    const look = onGround(pointAlong(route, LOOK_AHEAD_M), EYE_M)
    return { look, dir: eye.clone().sub(look).normalize(), dist: eye.distanceTo(look), fov: walkFov(aspect) }
  }

  const startWalk = () => {
    const c = clock.current
    c.t = Math.max(c.t, show.searchEnd + PATH_S) // a walk started early skips the rest of the search
    c.walked = true
    c.walk = { stage: 'in', t: 0, d: 0, from: viewOf(camera, controls ? controls.target : toWorld([0, 0])), dir: new THREE.Vector3() }
    if (controls) controls.enabled = false
    scene.fog = new THREE.Fog(NIGHT.background, 80, 700)
    onPhase('walking')
  }

  // Fog in the street, thinning out as the camera rises, so the overview stays clear.
  const setFog = (dist) => {
    const k = Math.max(1, dist / LOOK_AHEAD_M)
    scene.fog.near = 80 * k
    scene.fog.far = 700 * k
  }

  const endWalk = () => {
    const c = clock.current
    c.walk = null
    scene.fog = null
    if (controls) {
      controls.target.copy(show.overview.look)
      controls.enabled = true
      controls.update()
    }
    if (progressRef.current) progressRef.current.textContent = ''
    onPhase('done')
  }

  // Buttons in the panel: walk the route again, or skip to the end of the walk.
  useEffect(() => {
    const c = clock.current
    if (walkCmd?.kind === 'start' && !c.walk) startWalk()
    if (walkCmd?.kind === 'skip' && c.walk && c.walk.stage !== 'out') {
      const look = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(LOOK_AHEAD_M).add(camera.position)
      Object.assign(c.walk, { stage: 'out', t: 0, from: viewOf(camera, look) })
    }
  }, [walkCmd]) // eslint-disable-line react-hooks/exhaustive-deps

  // If the route goes away mid-walk, hand the camera back, in the overview.
  useEffect(
    () => () => {
      if (!clock.current.walk) return
      scene.fog = null
      blendViews(show.overview, show.overview, 1, camera)
      if (controls) {
        controls.target.copy(show.overview.look)
        controls.enabled = true
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const look = useMemo(() => new THREE.Vector3(), [])
  const ahead = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const c = clock.current
    c.t += dt
    const { materials, searchEnd } = show

    // The search replay, then the route drawing itself.
    const drawn = clamp01((c.t - searchEnd) / PATH_S)
    const fade = 1 - 0.7 * drawn
    materials.explored.uniforms.uTime.value = c.t
    materials.explored.uniforms.uFade.value = fade
    materials.nodes.uniforms.uTime.value = c.t
    materials.nodes.uniforms.uFade.value = fade
    materials.nodes.uniforms.uPixels.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360))
    for (const m of [materials.path, materials.halo]) m.uniforms.uDraw.value = drawn
    for (const m of [materials.path, materials.halo, materials.guide]) m.uniforms.uTime.value = c.t
    const low = camera.position.y - terrain.heightAt(camera.position.x, -camera.position.z) < LOW_M
    if (pathMesh.current) pathMesh.current.visible = c.t > searchEnd && !low
    if (guideMesh.current) guideMesh.current.visible = c.t > searchEnd && low

    // While the search runs, glide the camera to see origin and destination together, isometric.
    if (!c.walked && controls && c.t < GLIDE_S + dt) {
      c.glide ??= viewOf(camera, controls.target)
      const { look } = blendViews(c.glide, show.overview, ease(clamp01(c.t / GLIDE_S)), camera)
      controls.target.copy(look)
    }
    if (!c.found && c.t > searchEnd) {
      c.found = true
      onPhase('found')
    }
    if (!c.walked && c.t > searchEnd + PATH_S + HOLD_S) startWalk()

    const w = c.walk
    if (!w) return
    const length = route.drawnLength
    w.t += dt

    if (w.stage === 'in') {
      // Swoop down from the isometric view to eye height at the origin, while the lens widens to 15 mm.
      const street = streetView(camera.aspect)
      const { dist } = blendViews(w.from, street, ease(clamp01(w.t / FLY_S)), camera)
      setFog(dist)
      if (w.t >= FLY_S) Object.assign(w, { stage: 'walk', t: 0, dir: street.dir.clone().negate() })
    } else if (w.stage === 'walk') {
      // Glide along the route at eye height above the ground, so up and down the slopes, with rounded
      // corners; the gaze turns smoothly towards a point further ahead, also at eye height.
      w.d = Math.min(length, w.d + WALK_M_PER_S * dt)
      const eye = onGround(glidePoint(route, w.d), EYE_M)
      ahead.copy(onGround(pointAlong(route, w.d + LOOK_AHEAD_M), EYE_M)).sub(eye)
      if (ahead.length() > 0.5) w.dir.lerp(ahead.normalize(), 1 - Math.exp(-3 * dt)).normalize()
      camera.position.copy(eye)
      camera.lookAt(look.copy(eye).add(w.dir))
      setLens(camera, walkFov(camera.aspect), LOOK_AHEAD_M)
      setFog(LOOK_AHEAD_M)
      if (progressRef.current) progressRef.current.textContent = `${Math.round(w.d).toLocaleString('en-GB')} of ${Math.round(length).toLocaleString('en-GB')} m`
      if (w.d >= length) {
        const front = eye.clone().addScaledVector(w.dir, LOOK_AHEAD_M)
        Object.assign(w, { stage: 'out', t: 0, from: viewOf(camera, front) })
      }
    } else {
      // Rise back up to the isometric view of the whole route, while the lens narrows again.
      const { dist } = blendViews(w.from, show.overview, ease(clamp01(w.t / FLY_S)), camera)
      setFog(dist)
      if (w.t >= FLY_S) endWalk()
    }
  })

  return (
    <>
      <mesh geometry={show.explored} material={show.materials.explored} raycast={noRaycast} renderOrder={5} frustumCulled={false} />
      <points geometry={show.nodes} material={show.materials.nodes} raycast={noRaycast} renderOrder={8} frustumCulled={false} />
      <group ref={pathMesh} visible={false}>
        <mesh geometry={show.halo} material={show.materials.halo} raycast={noRaycast} renderOrder={6} frustumCulled={false} />
        <mesh geometry={show.path} material={show.materials.path} raycast={noRaycast} renderOrder={7} frustumCulled={false} />
      </group>
      <mesh ref={guideMesh} geometry={show.guide} material={show.materials.guide} raycast={noRaycast} renderOrder={7} frustumCulled={false} visible={false} />
    </>
  )
}

// A marker for the origin or the destination: a large sphere that pops in on a glowing pillar,
// a ring pulsing outwards on the ground and a label. If the street corner is away from the
// click, a small dot and a line join the two, so you see where you clicked and where the route starts.
function Beacon({ point, terrain, color: hex, label }) {
  const { xy, click } = point
  const ring = useRef()
  const ball = useRef()
  const born = useRef(null)
  const seen = useMemo(() => new THREE.Vector3(), [])
  const ground = terrain.heightAt(xy[0], xy[1])
  const clickZ = terrain.heightAt(click[0], click[1]) - ground + 1.2 // the click's own ground, relative to the marker
  const lead = useMemo(() => {
    if (Math.hypot(click[0] - xy[0], click[1] - xy[1]) < 3) return null
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([click[0] - xy[0], click[1] - xy[1], clickZ, 0, 0, 1.2], 3))
  }, [xy, click, clickZ])

  useFrame(({ clock, camera }) => {
    born.current ??= clock.elapsedTime
    const age = clock.elapsedTime - born.current
    const k = (clock.elapsedTime * 0.8) % 1
    ring.current.scale.setScalar(1 + k * 6)
    ring.current.material.opacity = 0.8 * (1 - k)
    // Pop in with a small overshoot, then float gently. When the view shows a large area the sphere
    // grows, so it never shrinks to a dot. (The size of the view counts, not the distance: the
    // isometric camera stands very far away.)
    const t = Math.min(1, age / 0.6)
    const pop = 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2
    const viewSize = camera.position.distanceTo(ball.current.getWorldPosition(seen)) * Math.tan((camera.fov * Math.PI) / 360)
    const far = Math.max(1, viewSize / 180)
    ball.current.scale.setScalar(Math.max(0.001, pop * far))
    ball.current.position.z = 16 * far + Math.sin(age * 2) * 1.5
  })

  return (
    <group position={[xy[0], xy[1], ground]}>
      <mesh position={[0, 0, 45]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={9}>
        <cylinderGeometry args={[1.4, 1.4, 90, 16, 1, true]} />
        <meshBasicMaterial color={hex} transparent opacity={0.55} depthWrite={false} fog={false} />
      </mesh>
      <group ref={ball}>
        <mesh raycast={noRaycast}>
          <sphereGeometry args={[7, 32, 16]} />
          <meshBasicMaterial color={hex} fog={false} />
        </mesh>
        <mesh raycast={noRaycast} renderOrder={9}>
          <sphereGeometry args={[11, 32, 16]} />
          <meshBasicMaterial color={hex} transparent opacity={0.25} depthWrite={false} fog={false} />
        </mesh>
        <Html position={[0, 0, 26]} center zIndexRange={[5, 0]} className="marker-label" style={{ '--marker': hex }}>
          {label}
        </Html>
      </group>
      <mesh position={[0, 0, 1]} raycast={noRaycast} renderOrder={9}>
        <circleGeometry args={[4, 32]} />
        <meshBasicMaterial color={hex} transparent depthWrite={false} fog={false} />
      </mesh>
      <mesh ref={ring} position={[0, 0, 1.1]} raycast={noRaycast} renderOrder={9}>
        <ringGeometry args={[4, 5.2, 48]} />
        <meshBasicMaterial color={hex} transparent depthWrite={false} side={THREE.DoubleSide} fog={false} />
      </mesh>
      {lead && (
        <>
          <lineSegments geometry={lead} raycast={noRaycast} renderOrder={9}>
            <lineBasicMaterial color={hex} transparent depthWrite={false} fog={false} />
          </lineSegments>
          <mesh position={[click[0] - xy[0], click[1] - xy[1], clickZ]} raycast={noRaycast} renderOrder={9}>
            <circleGeometry args={[2.2, 24]} />
            <meshBasicMaterial color={hex} transparent depthWrite={false} fog={false} />
          </mesh>
        </>
      )}
    </group>
  )
}

export default function City({ city, terrain, parks, size, origin, destination, route, walkCmd, onPick, onPhase, progressRef }) {
  // Ignore clicks that end a drag (orbiting or panning).
  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 5) return
    onPick([e.point.x, -e.point.z])
  }
  const start = ISO_DIR.clone().multiplyScalar(overviewDistance(Math.max(...size) * 1.15)) // the whole kit in view
  const materials = useRef({}).current
  const highlights = useMemo(
    () => [
      ...(origin ? [{ xy: origin.click, color: ROUTE_COLORS.origin }] : []),
      ...(destination ? [{ xy: destination.click, color: ROUTE_COLORS.destination }] : []),
    ],
    [origin, destination],
  )

  return (
    <Canvas flat camera={{ position: start.toArray(), fov: OVERVIEW_FOV, near: start.length() - 4000, far: start.length() + 5000 }} dpr={[1, 2]}>
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-600, 1200, 800]} intensity={1.8} />
      {/* zoom limits: from about 40 m to 5 km from the top to the bottom of the window */}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={overviewDistance(40)} maxDistance={overviewDistance(5000)} />
      <OverviewLens />
      <NightFade on={!!route} materials={materials} />
      <group rotation={TO_Y_UP}>
        <Ground terrain={terrain} parks={parks.parks} materials={materials} onPick={pick} />
        <Streets edges={city.edges} terrain={terrain} materials={materials} />
        <Trees positions={parks.positions} colors={parks.colors} lifts={parks.lifts} materials={materials} />
        <Buildings buildings={city.buildings} terrain={terrain} materials={materials} highlights={highlights} onPick={pick} />
        {route && <RouteShow key={route.id} city={city} terrain={terrain} route={route} walkCmd={walkCmd} onPhase={onPhase} progressRef={progressRef} />}
        {origin && <Beacon key={`o${origin.node}`} point={origin} terrain={terrain} color={ROUTE_COLORS.origin} label="Origin" />}
        {destination && <Beacon key={`d${destination.node}`} point={destination} terrain={terrain} color={ROUTE_COLORS.destination} label="Destination" />}
      </group>
    </Canvas>
  )
}
