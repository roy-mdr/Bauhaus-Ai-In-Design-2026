import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { colorForUse, REACH_COLORS, GROUND_COLOR, STREET_COLOR } from './colors.js'

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

function Buildings({ buildings, buildingLevel, onPick }) {
  const { geometry, ranges } = useMemo(() => buildingsGeometry(buildings), [buildings])
  const useColors = useMemo(() => buildings.map((b) => new THREE.Color(colorForUse(b.use))), [buildings])
  const reachColors = useMemo(() => REACH_COLORS.map((c) => new THREE.Color(c)), [])

  // Paint each building in its use colour, or in the shade of the smallest area it touches.
  useEffect(() => {
    const colors = geometry.attributes.color
    ranges.forEach(([from, to], i) => {
      const level = buildingLevel ? buildingLevel[i] : -1
      const c = level >= 0 ? reachColors[level] : useColors[i]
      for (let v = from; v < to; v++) colors.setXYZ(v, c.r, c.g, c.b)
    })
    colors.needsUpdate = true
  }, [geometry, ranges, buildingLevel, useColors, reachColors])

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

export default function City({ city, size, reach, marked, onPick }) {
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
        <Buildings buildings={city.buildings} buildingLevel={reach?.buildingLevel} onPick={pick} />
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
