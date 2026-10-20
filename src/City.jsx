import { useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { colorForUse, REACH_COLORS, GROWTH_COLOR, GROUND_COLOR, STREET_COLOR } from './colors.js'

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
    <mesh geometry={geometry} onClick={onPick}>
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

// One walking area, drawn flat on the ground. Areas with a larger number of minutes lie underneath.
function Area({ polygons, level }) {
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
    <mesh geometry={geometry} position={[0, 0, 0.3]} raycast={noRaycast} renderOrder={3 - level}>
      <meshBasicMaterial color={REACH_COLORS[level]} transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// A pin floating above the shop picked in the list.
function ShopMarker({ building }) {
  const { minX, minY, maxX, maxY } = building.bbox
  return (
    <mesh position={[(minX + maxX) / 2, (minY + maxY) / 2, building.height + 14]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <coneGeometry args={[7, 20, 24]} />
      <meshLambertMaterial color="#5a1d08" />
    </mesh>
  )
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

export default function City({ city, size, reach, growth, marked, onPick }) {
  // Ignore clicks that end a drag (orbiting or panning).
  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 5) return
    onPick([e.point.x, -e.point.z])
  }
  const [w, h] = size
  const distance = Math.max(w, h) * 0.9

  return (
    <Canvas flat camera={{ position: [0, distance, distance * 0.9], fov: 40, near: 2, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={['#f7f6f2']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-600, 1200, 800]} intensity={1.8} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={50} maxDistance={6000} />
      <group rotation={TO_Y_UP}>
        <mesh onClick={pick} renderOrder={0}>
          <planeGeometry args={[w + 600, h + 600]} />
          <meshBasicMaterial color={GROUND_COLOR} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
        </mesh>
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
