import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { colorForUse, REACH_COLORS, GROUND_COLOR, STREET_COLOR, AERO } from './colors.js'
import { Sky, SunFlare, DiscRim, SUN_POSITION } from './Aero.jsx'
import { boxPoint } from './shapes.js'
import { makeBuildingMaterial, makeGroundMaterial } from './cityMaterials.js'
import SolarCity from './Solarpunk.jsx'
import PhotoRig from './PhotoRig.jsx'

// The scene is built in metres with x to the east, y to the north and z up.
// One rotation of the whole group turns it into three.js's "y is up".
const TO_Y_UP = [-Math.PI / 2, 0, 0]
const noRaycast = () => null
const EAVES_M = 0.45

// All buildings in one mesh: walls up to the eaves, then a flat roof or a gable roof.
// Besides position and normal, each vertex carries what the shader needs to draw windows and roofs:
// aFacade = (distance along the wall or up the roof slope, kind of face), aBuild = (floor height, a
// number per building). `ranges` remembers which vertices belong to which building, so we can recolour them.
function buildingsGeometry(buildings) {
  const pos = [], nor = [], fac = [], bld = [], ranges = []
  let floorH = 3, seed = 0
  const push = (x, y, z, nx, ny, nz, u, kind) => {
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
    fac.push(u, kind)
    bld.push(floorH, seed)
  }
  // A triangle turned so that its front faces away from `inside`.
  const tri = (A, B, C, inside, uA, uB, uC, kind) => {
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    const mid = [(A[0] + B[0] + C[0]) / 3 - inside[0], (A[1] + B[1] + C[1]) / 3 - inside[1], (A[2] + B[2] + C[2]) / 3 - inside[2]]
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) {
      ;[B, C, uB, uC] = [C, B, uC, uB]
      n = n.map((x) => -x)
    }
    const len = Math.hypot(...n) || 1
    for (const [P, u] of [[A, uA], [B, uB], [C, uC]]) push(P[0], P[1], P[2], n[0] / len, n[1] / len, n[2] / len, u, kind)
  }
  const quad = (A, B, C, D, inside, u, kind) => {
    tri(A, B, C, inside, u[0], u[1], u[2], kind)
    tri(A, C, D, inside, u[0], u[2], u[3], kind)
  }

  buildings.forEach((b, i) => {
    const start = pos.length / 3
    const { roof } = b
    const top = roof.eave
    floorH = Math.min(4.6, Math.max(2.6, top / Math.max(1, b.floors || Math.round(top / 3.2))))
    seed = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296
    let [outer, ...holes] = b.rings.map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)))
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse()
    holes = holes.map((ring) => (THREE.ShapeUtils.isClockWise(ring) ? ring : ring.reverse()))

    for (const ring of [outer, ...holes]) {
      let u = 0
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length]
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const nx = (q.y - p.y) / len, ny = -(q.x - p.x) / len
        push(p.x, p.y, 0, nx, ny, 0, u, 0); push(q.x, q.y, 0, nx, ny, 0, u + len, 0); push(q.x, q.y, top, nx, ny, 0, u + len, 0)
        push(p.x, p.y, 0, nx, ny, 0, u, 0); push(q.x, q.y, top, nx, ny, 0, u + len, 0); push(p.x, p.y, top, nx, ny, 0, u, 0)
        u += len
      }
    }

    if (!roof.pitched) {
      const all = [outer, ...holes].flat()
      for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
        let [A, B, C] = [all[a], all[b2], all[c]]
        if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) [B, C] = [C, B]
        push(A.x, A.y, top, 0, 0, 1, 0, 1); push(B.x, B.y, top, 0, 0, 1, 0, 1); push(C.x, C.y, top, 0, 0, 1, 0, 1)
      }
    } else {
      // A gable roof over the footprint's rectangle, its ridge along the longer side.
      const { box, rise } = roof
      const along = box.maxU - box.minU >= box.maxV - box.minV
      const [a0, a1] = along ? [box.minU, box.maxU] : [box.minV, box.maxV]
      const [c0, c1] = along ? [box.minV, box.maxV] : [box.minU, box.maxU]
      const cm = (c0 + c1) / 2, half = cm - c0
      const ridge = top + rise, low = top - (EAVES_M * rise) / half
      const P = (a, c, z) => [...(along ? boxPoint(box, a, c) : boxPoint(box, c, a)), z]
      const inside = P((a0 + a1) / 2, cm, top)
      const slope = half + EAVES_M
      quad(P(a0, c0 - EAVES_M, low), P(a1, c0 - EAVES_M, low), P(a1, cm, ridge), P(a0, cm, ridge), inside, [0, 0, slope, slope], 2)
      quad(P(a1, c1 + EAVES_M, low), P(a0, c1 + EAVES_M, low), P(a0, cm, ridge), P(a1, cm, ridge), inside, [0, 0, slope, slope], 2)
      tri(P(a0, c0, top), P(a0, c1, top), P(a0, cm, ridge), inside, 0, c1 - c0, half, 3)
      tri(P(a1, c1, top), P(a1, c0, top), P(a1, cm, ridge), inside, 0, c1 - c0, half, 3)
      const above = [inside[0], inside[1], top + 50]
      quad(P(a0, c0 - EAVES_M, low), P(a1, c0 - EAVES_M, low), P(a1, c1 + EAVES_M, low), P(a0, c1 + EAVES_M, low), above, [0, 0, 0, 0], 4)
    }
    ranges.push([start, pos.length / 3])
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geometry.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 2))
  geometry.setAttribute('aBuild', new THREE.Float32BufferAttribute(bld, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
  geometry.computeBoundingSphere()
  return { geometry, ranges }
}

function Buildings({ buildings, buildingLevel, onPick }) {
  const { geometry, ranges } = useMemo(() => buildingsGeometry(buildings), [buildings])
  const material = useMemo(() => makeBuildingMaterial(), [])
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

  return <mesh geometry={geometry} material={material} onClick={onPick} />
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

export default function City({ city, size, reach, marked, districts, photo, onPick, onStand }) {
  // Ignore clicks that end a drag (orbiting or panning).
  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 5) return
    onPick([e.point.x, -e.point.z])
  }
  const [w, h] = size
  const distance = Math.max(w, h) * 0.9
  const ground = useMemo(() => makeGroundMaterial(GROUND_COLOR), [])
  // The city stands on a round disc just larger than the kit, like a small world floating in the sky.
  const discRadius = Math.hypot(w, h) / 2 + 80

  return (
    <Canvas flat camera={{ position: [0, distance, distance * 0.9], fov: 40, near: 2, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={[AERO.horizon]} />
      <fog attach="fog" args={[AERO.haze, 2600, 12000]} />
      <hemisphereLight args={[AERO.sky, '#cdeccf', 0.7]} />
      <ambientLight intensity={0.95} />
      <directionalLight position={SUN_POSITION} intensity={1.9} color="#fffaf0" />
      {/* how far and how steeply the camera may move is set by PhotoRig, for the map and for eye level */}
      <OrbitControls makeDefault />
      <PhotoRig photo={photo} />
      <Sky />
      <SunFlare />
      <group rotation={TO_Y_UP}>
        <mesh onClick={pick} renderOrder={0} material={ground}>
          <circleGeometry args={[discRadius, 160]} />
        </mesh>
        <DiscRim radius={discRadius} />
        <Streets edges={city.edges} />
        <Buildings buildings={city.buildings} buildingLevel={reach?.buildingLevel} onPick={pick} />
        <SolarCity districts={districts} onStand={onStand} />
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
