import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  colorForUse, REACH_COLORS, GROWTH_COLOR, GROUND_COLOR, STREET_COLOR,
  NEW_SHADOW_COLOR, WIND_CALM, WIND_NORMAL, WIND_STRONG, WINDIER_COLOR, CALMER_COLOR,
} from './colors.js'

// The scene is built in metres with x to the east, y to the north and z up.
// One rotation of the whole group turns it into three.js's "y is up".
const TO_Y_UP = [-Math.PI / 2, 0, 0]
const noRaycast = () => null

// All buildings in one mesh: walls and flat roofs from footprint and height.
// `ranges` remembers which vertices belong to which building, so we can recolour them.
function buildingsGeometry(buildings) {
  const pos = [], nor = [], ranges = []
  const push = (x, y, z, nx, ny, nz) => {
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
  }
  for (const b of buildings) {
    const start = pos.length / 3
    const h = b.height
    let [outer, ...holes] = b.rings.map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)))
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse()
    holes = holes.map((ring) => (THREE.ShapeUtils.isClockWise(ring) ? ring : ring.reverse()))

    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const nx = (q.y - p.y) / len, ny = -(q.x - p.x) / len
        push(p.x, p.y, 0, nx, ny, 0); push(q.x, q.y, 0, nx, ny, 0); push(q.x, q.y, h, nx, ny, 0)
        push(p.x, p.y, 0, nx, ny, 0); push(q.x, q.y, h, nx, ny, 0); push(p.x, p.y, h, nx, ny, 0)
      }
    }

    const all = [outer, ...holes].flat()
    for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      let [A, B, C] = [all[a], all[b2], all[c]]
      if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) [B, C] = [C, B]
      push(A.x, A.y, h, 0, 0, 1); push(B.x, B.y, h, 0, 0, 1); push(C.x, C.y, h, 0, 0, 1)
    }
    ranges.push([start, pos.length / 3])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
  geometry.computeBoundingSphere()
  return { geometry, ranges }
}

function Buildings({ buildings, buildingLevel, growth, onPick }) {
  const { geometry, ranges } = useMemo(() => buildingsGeometry(buildings), [buildings])
  const useColors = useMemo(() => buildings.map((b) => new THREE.Color(colorForUse(b.use))), [buildings])
  const reachColors = useMemo(() => REACH_COLORS.map((c) => new THREE.Color(c)), [])
  const growthColor = useMemo(() => new THREE.Color(GROWTH_COLOR), [])
  // The original heights of the vertices (0 at the ground, the building height on top),
  // and the height each building has gained on screen right now.
  const baseZ = useMemo(() => geometry.attributes.position.array.filter((_, k) => k % 3 === 2), [geometry])
  const shown = useMemo(() => new Float32Array(buildings.length), [buildings])

  // Paint each building in its use colour, or in the shade of the smallest area it touches,
  // or, in growth mode, tinted by how many storeys it gains.
  useEffect(() => {
    const colors = geometry.attributes.color
    const c = new THREE.Color()
    ranges.forEach(([from, to], i) => {
      const level = buildingLevel ? buildingLevel[i] : -1
      if (level >= 0) c.copy(reachColors[level])
      else if (growth?.share[i] > 0) c.copy(useColors[i]).lerp(growthColor, 0.35 + 0.65 * growth.share[i])
      else c.copy(useColors[i])
      for (let v = from; v < to; v++) colors.setXYZ(v, c.r, c.g, c.b)
    })
    colors.needsUpdate = true
  }, [geometry, ranges, buildingLevel, growth, useColors, reachColors, growthColor])

  // Each frame, move every building's roof a bit closer to its target height, so the city grows (or shrinks back) smoothly.
  useFrame((_, dt) => {
    const pos = geometry.attributes.position
    const ease = Math.min(1, dt * 3)
    let moved = false
    ranges.forEach(([from, to], i) => {
      const target = growth ? growth.added[i] : 0
      if (shown[i] === target) return
      shown[i] = Math.abs(target - shown[i]) < 0.05 ? target : shown[i] + (target - shown[i]) * ease
      for (let v = from; v < to; v++) if (baseZ[v] > 0) pos.setZ(v, baseZ[v] + shown[i])
      moved = true
    })
    if (moved) {
      pos.needsUpdate = true
      geometry.computeBoundingSphere()
    }
  })

  return (
    <mesh geometry={geometry} onClick={onPick} castShadow receiveShadow>
      <meshLambertMaterial vertexColors />
    </mesh>
  )
}

function Streets({ edges }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const e of edges)
      for (let i = 1; i < e.points.length; i++) pos.push(...e.points[i - 1], 0, ...e.points[i], 0)
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  }, [edges])
  return (
    <lineSegments geometry={geometry} position={[0, 0, 0.6]} raycast={noRaycast} renderOrder={4}>
      {/* "transparent" puts the streets in the same drawing pass as the areas, after them */}
      <lineBasicMaterial color={STREET_COLOR} transparent depthWrite={false} />
    </lineSegments>
  )
}

// Polygons drawn flat on the ground, in one colour.
function FlatShape({ polygons, color, opacity, z, renderOrder }) {
  const geometry = useMemo(() => {
    const shapes = polygons.map(({ outer, holes }) => {
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
      shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      return shape
    })
    return new THREE.ShapeGeometry(shapes)
  }, [polygons])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} position={[0, 0, z]} raycast={noRaycast} renderOrder={renderOrder}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// One walking area. Areas with a larger number of minutes lie underneath.
const Area = ({ polygons, level }) => (
  <FlatShape polygons={polygons} color={REACH_COLORS[level]} opacity={0.85} z={0.3} renderOrder={3 - level} />
)

// The sun as a light that casts shadows. Its direction comes from height and compass direction.
function Sun({ sun, size }) {
  const a = (sun.azimuth * Math.PI) / 180, h = (sun.altitude * Math.PI) / 180
  const far = 2500
  // three.js has y up and north towards -z.
  const position = [Math.sin(a) * Math.cos(h) * far, Math.sin(h) * far, -Math.cos(a) * Math.cos(h) * far]
  const half = Math.hypot(...size) / 2 + 50
  // The shadow camera only takes its new size once told to.
  const light = useRef()
  useLayoutEffect(() => light.current.shadow.camera.updateProjectionMatrix(), [half])
  return (
    <directionalLight ref={light} position={position} intensity={1.8} castShadow
      shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={0.5}
      shadow-camera-left={-half} shadow-camera-right={half} shadow-camera-top={half} shadow-camera-bottom={-half}
      shadow-camera-near={10} shadow-camera-far={far * 2}
    />
  )
}

// The wind as short moving streaks at street level, coloured by speed: pale blue calm, dark blue normal, red strong.
const PARTICLES = 4000
const STREAK_SPEED = 30 // on-screen metres per second for wind as strong as over open ground; much faster than real

function WindStreaks({ base, speed }) {
  const { geometry, state } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PARTICLES * 6), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(PARTICLES * 6), 3))
    const f = () => new Float32Array(PARTICLES)
    return { geometry: g, state: { x: f(), y: f(), life: f(), maxLife: f() } }
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const palette = useMemo(() => [WIND_CALM, WIND_NORMAL, WIND_STRONG, GROUND_COLOR].map((c) => new THREE.Color(c)), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const { nx, ny, x0, y0, cell, vx, vy } = base
    const { x, y, life, maxLife } = state
    const pos = geometry.attributes.position, col = geometry.attributes.color
    const [calm, normal, strong, ground] = palette
    const c = new THREE.Color(), tail = new THREE.Color()
    for (let p = 0; p < PARTICLES; p++) {
      if (life[p] >= maxLife[p]) {
        const first = maxLife[p] === 0 // at the start, spread the streaks over their lifetimes
        x[p] = x0 + Math.random() * nx * cell
        y[p] = y0 + Math.random() * ny * cell
        maxLife[p] = 3 + Math.random() * 5
        life[p] = first ? Math.random() * maxLife[p] : 0
      }
      life[p] += dt
      const i = Math.floor((x[p] - x0) / cell), j = Math.floor((y[p] - y0) / cell)
      const k = j * nx + i
      const s = i >= 0 && i < nx && j >= 0 && j < ny ? speed[k] : 0
      const len = Math.hypot(vx[k], vy[k])
      if (s === 0 || len === 0) {
        life[p] = maxLife[p] // inside a building, off the map or in still air: start again elsewhere
        pos.setXYZ(2 * p, 0, 0, -10)
        pos.setXYZ(2 * p + 1, 0, 0, -10)
        continue
      }
      const dx = vx[k] / len, dy = vy[k] / len
      x[p] += dx * s * STREAK_SPEED * dt
      y[p] += dy * s * STREAK_SPEED * dt
      const t = 6 + 12 * s
      pos.setXYZ(2 * p, x[p], y[p], 0)
      pos.setXYZ(2 * p + 1, x[p] - dx * t, y[p] - dy * t, 0)
      if (s < 1) c.copy(calm).lerp(normal, s)
      else c.copy(normal).lerp(strong, Math.min(1, (s - 1) / 0.6))
      // Fade in and out, so streaks don't pop.
      const fade = Math.min(1, life[p] / 0.6, (maxLife[p] - life[p]) / 0.6)
      c.lerp(ground, 1 - fade)
      tail.copy(c).lerp(ground, 0.7)
      col.setXYZ(2 * p, c.r, c.g, c.b)
      col.setXYZ(2 * p + 1, tail.r, tail.g, tail.b)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  })

  return (
    <lineSegments geometry={geometry} position={[0, 0, 2]} raycast={noRaycast} renderOrder={6} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent depthWrite={false} />
    </lineSegments>
  )
}

// A grid of coloured cells laid on the ground. `paint(k)` gives each cell's [color, opacity 0–1], or nothing.
function GridLayer({ grid, paint, z, renderOrder }) {
  const { nx, ny, x0, y0, cell } = grid
  const texture = useMemo(() => {
    const data = new Uint8Array(nx * ny * 4)
    for (let k = 0; k < nx * ny; k++) {
      const p = paint(k)
      if (p) data.set([p[0].r * 255, p[0].g * 255, p[0].b * 255, p[1] * 255], k * 4)
    }
    const t = new THREE.DataTexture(data, nx, ny)
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  }, [paint, nx, ny])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh position={[x0 + (nx * cell) / 2, y0 + (ny * cell) / 2, z]} raycast={noRaycast} renderOrder={renderOrder}>
      <planeGeometry args={[nx * cell, ny * cell]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}

// Where the growth made street-level wind stronger (red) or weaker (blue).
function WindChange({ base, change }) {
  const paint = useMemo(() => {
    const up = new THREE.Color(WINDIER_COLOR), down = new THREE.Color(CALMER_COLOR)
    // The same cells the panel counts: more than 10 % faster or slower.
    return (k) => Math.abs(change[k]) > 0.1 && [change[k] > 0 ? up : down, 0.3 + 0.4 * Math.min(1, Math.abs(change[k]) / 0.6)]
  }, [change])
  return <GridLayer grid={base} paint={paint} z={0.5} renderOrder={1} />
}

// Ground that the raised buildings newly put in shade.
function NewShadow({ grid, mask }) {
  const paint = useMemo(() => {
    const c = new THREE.Color(NEW_SHADOW_COLOR)
    return (k) => mask[k] && [c, 0.65]
  }, [mask])
  return <GridLayer grid={grid} paint={paint} z={0.5} renderOrder={2} />
}

// The growth radius as a ring on the ground, with a pin at its centre.
function GrowthRing({ centre, radius }) {
  const geometry = useMemo(() => {
    const pts = []
    for (let k = 0; k < 128; k++) {
      const a = (k / 128) * Math.PI * 2
      pts.push(centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a), 0)
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  }, [centre, radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <>
      <lineLoop geometry={geometry} position={[0, 0, 0.8]} raycast={noRaycast} renderOrder={5}>
        <lineBasicMaterial color={GROWTH_COLOR} transparent depthWrite={false} />
      </lineLoop>
      <mesh position={[...centre, 4]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[6, 6, 8, 24]} />
        <meshLambertMaterial color={GROWTH_COLOR} />
      </mesh>
    </>
  )
}

export default function City({ city, size, reach, growth, sun, newShadow, wind, marked, onPick }) {
  // Ignore clicks that end a drag (orbiting or panning).
  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 5) return
    onPick([e.point.x, -e.point.z])
  }
  const [w, h] = size
  const distance = Math.max(w, h) * 0.9

  return (
    <Canvas flat shadows camera={{ position: [0, distance, distance * 0.9], fov: 40, near: 10, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={['#f7f6f2']} />
      <ambientLight intensity={1.6} />
      {sun ? <Sun sun={sun} size={size} /> : <directionalLight position={[-600, 1200, 800]} intensity={1.8} />}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={50} maxDistance={6000} />
      <group rotation={TO_Y_UP}>
        <mesh onClick={pick} renderOrder={0}>
          <planeGeometry args={[w + 600, h + 600]} />
          <meshBasicMaterial color={GROUND_COLOR} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
        </mesh>
        {sun && (
          // Catches the cast shadows on the ground, and is see-through everywhere else.
          <mesh position={[0, 0, 0.5]} receiveShadow raycast={noRaycast} renderOrder={1}>
            <planeGeometry args={[w + 600, h + 600]} />
            <shadowMaterial opacity={0.45} transparent depthWrite={false} />
          </mesh>
        )}
        {newShadow && <NewShadow grid={newShadow.grid} mask={newShadow.mask} />}
        {wind?.change && <WindChange base={wind.base} change={wind.change} />}
        {wind && <WindStreaks base={wind.base} speed={wind.speed} />}
        <Streets edges={city.edges} />
        <Buildings buildings={city.buildings} buildingLevel={reach?.buildingLevel} growth={growth} onPick={pick} />
        {growth && <GrowthRing centre={growth.centre} radius={growth.radius} />}
        {reach?.levels?.map((l, level) => <Area key={level} polygons={l.polygons} level={level} />)}
        {marked != null && <ShopMarker building={city.buildings[marked]} />}
        {reach?.start && (
          <mesh position={[...reach.start, 4]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
            <cylinderGeometry args={[6, 6, 8, 24]} />
            <meshLambertMaterial color="#5a1d08" />
          </mesh>
        )}
      </group>
    </Canvas>
  )
}
