import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { colorForUse, GROUND_COLOR, STREET_COLOR, PARK_COLOR, BACKGROUND_COLOR, NIGHT, ROUTE_COLORS } from './colors.js'

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
const OVERVIEW_FOV = 40
const WALK_FOV = 75

// All buildings in one mesh: walls and flat roofs from footprint and height.
// `ranges` remembers which vertices belong to which building, so we can light them up.
function buildingsGeometry(buildings) {
  const pos = [], nor = [], col = [], ranges = []
  const push = (x, y, z, nx, ny, nz, c) => {
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
    col.push(c.r, c.g, c.b)
  }
  for (const b of buildings) {
    const c = new THREE.Color(colorForUse(b.use))
    const h = b.height
    const start = pos.length / 3
    let [outer, ...holes] = b.rings.map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)))
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse()
    holes = holes.map((ring) => (THREE.ShapeUtils.isClockWise(ring) ? ring : ring.reverse()))

    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const nx = (q.y - p.y) / len, ny = -(q.x - p.x) / len
        push(p.x, p.y, 0, nx, ny, 0, c); push(q.x, q.y, 0, nx, ny, 0, c); push(q.x, q.y, h, nx, ny, 0, c)
        push(p.x, p.y, 0, nx, ny, 0, c); push(q.x, q.y, h, nx, ny, 0, c); push(p.x, p.y, h, nx, ny, 0, c)
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

function Buildings({ buildings, materials, highlights, onPick }) {
  const { geometry, ranges } = useMemo(() => buildingsGeometry(buildings), [buildings])
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

function Streets({ edges, materials }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const e of edges)
      for (let i = 1; i < e.points.length; i++) pos.push(...e.points[i - 1], 0, ...e.points[i], 0)
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  }, [edges])
  return (
    <lineSegments geometry={geometry} position={[0, 0, 0.6]} raycast={noRaycast} renderOrder={4}>
      {/* "transparent" puts the streets in the same drawing pass as the route, before it */}
      <lineBasicMaterial color={STREET_COLOR} transparent depthWrite={false} ref={(m) => { materials.street = m }} />
    </lineSegments>
  )
}

// The parks: green ground, drawn just above the plain ground.
function ParkGround({ parks, materials }) {
  const geometry = useMemo(() => {
    const shapes = parks.map(([outer, ...holes]) => {
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
      shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      return shape
    })
    return new THREE.ShapeGeometry(shapes)
  }, [parks])
  return (
    <mesh geometry={geometry} position={[0, 0, 0.1]} raycast={noRaycast} renderOrder={1}>
      <meshBasicMaterial color={PARK_COLOR} ref={(m) => { materials.park = m }} />
    </mesh>
  )
}

// The trees as one point cloud. Each point is a round dot about half a metre wide, never smaller
// than a pixel and a half, so the parks still read from far away, and never larger than 14 pixels,
// so crowns close to the camera stay leafy instead of turning into large discs. The crowns sway a little in the wind.
function Trees({ positions, colors, materials }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeBoundingSphere()
    return g
  }, [positions, colors])
  const material = useMemo(() => {
    const m = new THREE.PointsMaterial({ size: 0.55, sizeAttenuation: true, vertexColors: true })
    m.userData.time = { value: 0 }
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = m.userData.time
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xy += sin(uTime * 1.3 + position.x * 0.2 + position.y * 0.15) * 0.02 * position.z;')
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

// Fades the city between day and night: night while a route is shown, so the search glows.
function NightFade({ on, materials }) {
  const night = useRef(0)
  const day = useMemo(() => ({ background: new THREE.Color(BACKGROUND_COLOR), ground: new THREE.Color(GROUND_COLOR), street: new THREE.Color(STREET_COLOR), buildings: new THREE.Color('#ffffff'), park: new THREE.Color(PARK_COLOR), trees: new THREE.Color('#ffffff') }), [])
  const dark = useMemo(() => Object.fromEntries(Object.entries(NIGHT).map(([k, c]) => [k, new THREE.Color(c)])), [])
  useFrame(({ scene }, dt) => {
    const before = night.current
    night.current = THREE.MathUtils.damp(night.current, on ? 1 : 0, 3, Math.min(dt, 0.1))
    if (Math.abs(before - night.current) < 1e-4) return
    const k = night.current
    scene.background?.lerpColors(day.background, dark.background, k)
    for (const key of ['ground', 'street', 'buildings', 'park', 'trees']) materials[key]?.color.lerpColors(day[key], dark[key], k)
  })
  return null
}

// Flat strips on the ground along lines. `values` holds one number per point, which the
// shaders read: the moment an edge lights up, or the distance along the route.
// Each piece runs on by half a width at both ends, so corners have no gaps.
function ribbonGeometry(lines, width, z) {
  const pos = [], val = []
  for (const { points, values } of lines)
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i]
      const len = Math.hypot(bx - ax, by - ay)
      if (len === 0) continue
      const dx = ((bx - ax) / len) * (width / 2), dy = ((by - ay) / len) * (width / 2)
      const [sx, sy, ex, ey] = [ax - dx, ay - dy, bx + dx, by + dy]
      const [va, vb] = [values[i - 1], values[i]]
      pos.push(sx - dy, sy + dx, z, sx + dy, sy - dx, z, ex - dy, ey + dx, z)
      pos.push(ex - dy, ey + dx, z, sx + dy, sy - dx, z, ex + dy, ey - dx, z)
      val.push(va, va, vb, vb, va, vb)
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
function RouteShow({ city, route, walkCmd, onPhase, progressRef }) {
  const { camera, scene, controls } = useThree()

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
      0.35,
    )
    const pathLine = [{ points: route.points, values: route.along }]
    const path = ribbonGeometry(pathLine, 4.5, 0.5)
    const halo = ribbonGeometry(pathLine, 16, 0.45)
    const guide = ribbonGeometry(pathLine, 0.8, 0.5) // seen from eye height, the wide strip would fill the street

    const popStep = new Map(route.expanded.map((n, i) => [n, i]))
    const ids = [...city.neighbours.keys()]
    const nodes = new THREE.BufferGeometry()
    nodes.setAttribute('position', new THREE.Float32BufferAttribute(ids.flatMap((id) => [...city.nodeXY.get(id), 1]), 3))
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

    // Where the camera looks from after the walk: the whole route in view, seen from the south.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of route.points) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)]
    const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2]
    const distance = Math.max(300, Math.max(maxX - minX, maxY - minY) * 1.4)
    const overview = { position: toWorld([cx, cy - distance * 0.8], distance), target: toWorld([cx, cy]) }

    return { rate, searchEnd, explored, path, halo, guide, nodes, materials, overview }
  }, [city, route])

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

  const setLens = (fov, near, far) => {
    camera.fov = fov
    camera.near = near
    camera.far = far
    camera.updateProjectionMatrix()
  }

  const startWalk = () => {
    const c = clock.current
    c.t = Math.max(c.t, show.searchEnd + PATH_S) // a walk started early skips the rest of the search
    c.walked = true
    c.walk = { stage: 'in', t: 0, d: 0, fromPos: camera.position.clone(), fromLook: controls ? controls.target.clone() : toWorld([0, 0]), dir: new THREE.Vector3() }
    if (controls) controls.enabled = false
    setLens(camera.fov, 0.1, 4000)
    scene.fog = new THREE.Fog(NIGHT.background, 80, 700)
    onPhase('walking')
  }

  const endWalk = () => {
    const c = clock.current
    c.walk = null
    setLens(OVERVIEW_FOV, 2, 20000)
    scene.fog = null
    if (controls) {
      controls.target.copy(show.overview.target)
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
      Object.assign(c.walk, { stage: 'out', t: 0, fromPos: camera.position.clone(), fromLook: camera.position.clone().add(c.walk.dir.clone().multiplyScalar(10)) })
    }
  }, [walkCmd]) // eslint-disable-line react-hooks/exhaustive-deps

  // If the route goes away mid-walk, hand the camera back.
  useEffect(
    () => () => {
      if (!clock.current.walk) return
      setLens(OVERVIEW_FOV, 2, 20000)
      scene.fog = null
      if (controls) controls.enabled = true
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
    const low = camera.position.y < LOW_M
    if (pathMesh.current) pathMesh.current.visible = c.t > searchEnd && !low
    if (guideMesh.current) guideMesh.current.visible = c.t > searchEnd && low

    // While the search runs, glide the camera to see origin and destination together.
    if (!c.walked && controls && c.t < GLIDE_S + dt) {
      c.glide ??= { position: camera.position.clone(), target: controls.target.clone() }
      const k = ease(clamp01(c.t / GLIDE_S))
      camera.position.lerpVectors(c.glide.position, show.overview.position, k)
      controls.target.lerpVectors(c.glide.target, show.overview.target, k)
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
      // Fly down from where the camera is to eye height at the origin.
      const k = ease(clamp01(w.t / FLY_S))
      const eye = toWorld(glidePoint(route, 0), EYE_M)
      const target = toWorld(pointAlong(route, LOOK_AHEAD_M), EYE_M)
      camera.position.lerpVectors(w.fromPos, eye, k)
      look.lerpVectors(w.fromLook, target, k)
      camera.lookAt(look)
      setLens(OVERVIEW_FOV + (WALK_FOV - OVERVIEW_FOV) * k, 0.1, 4000)
      if (w.t >= FLY_S) Object.assign(w, { stage: 'walk', t: 0, dir: target.sub(eye).normalize() })
    } else if (w.stage === 'walk') {
      // Glide along the route at eye height, with rounded corners; the gaze turns smoothly towards a point further ahead.
      w.d = Math.min(length, w.d + WALK_M_PER_S * dt)
      const eye = toWorld(glidePoint(route, w.d), EYE_M)
      ahead.copy(toWorld(pointAlong(route, w.d + LOOK_AHEAD_M), EYE_M)).sub(eye)
      if (ahead.length() > 0.5) w.dir.lerp(ahead.normalize(), 1 - Math.exp(-3 * dt)).normalize()
      camera.position.copy(eye)
      camera.lookAt(look.copy(eye).add(w.dir))
      if (progressRef.current) progressRef.current.textContent = `${Math.round(w.d).toLocaleString('en-GB')} of ${Math.round(length).toLocaleString('en-GB')} m`
      if (w.d >= length) Object.assign(w, { stage: 'out', t: 0, fromPos: eye.clone(), fromLook: eye.clone().add(w.dir.clone().multiplyScalar(10)) })
    } else {
      // Rise back up to see the whole route.
      const k = ease(clamp01(w.t / FLY_S))
      camera.position.lerpVectors(w.fromPos, show.overview.position, k)
      look.lerpVectors(w.fromLook, show.overview.target, k)
      camera.lookAt(look)
      setLens(WALK_FOV + (OVERVIEW_FOV - WALK_FOV) * k, 0.1, 4000)
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
function Beacon({ point, color: hex, label }) {
  const { xy, click } = point
  const ring = useRef()
  const ball = useRef()
  const born = useRef(null)
  const seen = useMemo(() => new THREE.Vector3(), [])
  const lead = useMemo(() => {
    if (Math.hypot(click[0] - xy[0], click[1] - xy[1]) < 3) return null
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([click[0] - xy[0], click[1] - xy[1], 1.2, 0, 0, 1.2], 3))
  }, [xy, click])

  useFrame(({ clock, camera }) => {
    born.current ??= clock.elapsedTime
    const age = clock.elapsedTime - born.current
    const k = (clock.elapsedTime * 0.8) % 1
    ring.current.scale.setScalar(1 + k * 6)
    ring.current.material.opacity = 0.8 * (1 - k)
    // Pop in with a small overshoot, then float gently. Seen from far away the sphere grows,
    // so it never shrinks to a dot.
    const t = Math.min(1, age / 0.6)
    const pop = 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2
    const far = Math.max(1, camera.position.distanceTo(ball.current.getWorldPosition(seen)) / 500)
    ball.current.scale.setScalar(Math.max(0.001, pop * far))
    ball.current.position.z = 16 * far + Math.sin(age * 2) * 1.5
  })

  return (
    <group position={[xy[0], xy[1], 0]}>
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
          <mesh position={[click[0] - xy[0], click[1] - xy[1], 1.2]} raycast={noRaycast} renderOrder={9}>
            <circleGeometry args={[2.2, 24]} />
            <meshBasicMaterial color={hex} transparent depthWrite={false} fog={false} />
          </mesh>
        </>
      )}
    </group>
  )
}

export default function City({ city, parks, size, origin, destination, route, walkCmd, onPick, onPhase, progressRef }) {
  // Ignore clicks that end a drag (orbiting or panning).
  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 5) return
    onPick([e.point.x, -e.point.z])
  }
  const [w, h] = size
  const distance = Math.max(w, h) * 0.9
  const materials = useRef({}).current
  const highlights = useMemo(
    () => [
      ...(origin ? [{ xy: origin.click, color: ROUTE_COLORS.origin }] : []),
      ...(destination ? [{ xy: destination.click, color: ROUTE_COLORS.destination }] : []),
    ],
    [origin, destination],
  )

  return (
    <Canvas flat camera={{ position: [0, distance, distance * 0.9], fov: OVERVIEW_FOV, near: 2, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-600, 1200, 800]} intensity={1.8} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={50} maxDistance={6000} />
      <NightFade on={!!route} materials={materials} />
      <group rotation={TO_Y_UP}>
        <mesh onClick={pick} renderOrder={0}>
          <planeGeometry args={[w + 600, h + 600]} />
          <meshBasicMaterial color={GROUND_COLOR} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} ref={(m) => { materials.ground = m }} />
        </mesh>
        {parks && <ParkGround parks={parks.parks} materials={materials} />}
        <Streets edges={city.edges} materials={materials} />
        {parks && <Trees positions={parks.positions} colors={parks.colors} materials={materials} />}
        <Buildings buildings={city.buildings} materials={materials} highlights={highlights} onPick={pick} />
        {route && <RouteShow key={route.id} city={city} route={route} walkCmd={walkCmd} onPhase={onPhase} progressRef={progressRef} />}
        {origin && <Beacon key={`o${origin.node}`} point={origin} color={ROUTE_COLORS.origin} label="Origin" />}
        {destination && <Beacon key={`d${destination.node}`} point={destination} color={ROUTE_COLORS.destination} label="Destination" />}
      </group>
    </Canvas>
  )
}
