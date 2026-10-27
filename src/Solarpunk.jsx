import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FEATHER_M, GROW_SECONDS, frontAt } from './solarpunk.js'
import { solarUniforms } from './cityMaterials.js'
import { EYE_HEIGHT_M } from './photo.js'
import { SOLARPUNK as C } from './colors.js'

const noRaycast = () => null
const clamp01 = (x) => Math.max(0, Math.min(1, x))
// three.js shapes stand along y; in this scene up is z.
const upright = (g) => g.rotateX(Math.PI / 2)

// Unit shapes, standing on z = 0 where that makes sense, so they grow up from their base.
const GEOMETRIES = {
  cyl: upright(new THREE.CylinderGeometry(1, 1, 1, 28)).translate(0, 0, 0.5),
  cyl8: upright(new THREE.CylinderGeometry(1, 1, 1, 7)).translate(0, 0, 0.5),
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
  torus: new THREE.TorusGeometry(1, 0.06, 6, 40),
  ball: new THREE.IcosahedronGeometry(1, 1),
  cone: upright(new THREE.ConeGeometry(1, 1, 8)).translate(0, 0, 0.5),
  person: upright(new THREE.CapsuleGeometry(0.28, 1.15, 3, 8)).translate(0, 0, 0.86),
}

// Glossy, in the Frutiger Aero look of the city.
const MATERIALS = {
  solid: new THREE.MeshPhongMaterial({ shininess: 40, specular: new THREE.Color('#4a555c') }),
  glass: new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.4, depthWrite: false, shininess: 120, specular: new THREE.Color('#ffffff') }),
  solar: new THREE.MeshPhongMaterial({ shininess: 90, specular: new THREE.Color('#86a6dc') }),
}

// Each layer of the district: which shape, in which material.
const LAYERS = {
  slab: ['cyl', 'solid'],
  glass: ['cyl', 'glass'],
  glassBox: ['box', 'glass'],
  struct: ['box', 'solid'],
  hedge: ['torus', 'solid'],
  leaf: ['ball', 'solid'],
  conifer: ['cone', 'solid'],
  trunk: ['cyl8', 'solid'],
  lawn: ['box', 'solid'],
  lawnDisc: ['cyl', 'solid'],
  solar: ['box', 'solar'],
  person: ['person', 'solid'],
}

// One layer of a district as one instanced mesh. Each piece scales up from nothing when the
// growing front reaches it, low pieces of a tower before high ones.
function GrowingLayer({ items, geometry, material, district }) {
  const ref = useRef()
  const done = useRef(false)
  const data = useMemo(() => {
    const n = items.length
    const base = new Float32Array(n * 16), d = new Float32Array(n), h = new Float32Array(n)
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    items.forEach((it, i) => {
      m.compose(p.set(...it.p), q.set(...it.q), s.set(...it.s)).toArray(base, i * 16)
      d[i] = it.d
      h[i] = it.h
    })
    return { base, d, h }
  }, [items])

  useEffect(() => {
    const mesh = ref.current
    const c = new THREE.Color()
    items.forEach((it, i) => mesh.setColorAt(i, c.set(it.color)))
    mesh.instanceColor.needsUpdate = true
    mesh.instanceMatrix.array.fill(0)
    mesh.instanceMatrix.needsUpdate = true
    done.current = false
  }, [items])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh || done.current) return
    const now = performance.now()
    const R = frontAt(district, now)
    const arr = mesh.instanceMatrix.array
    const { base, d, h } = data
    for (let i = 0; i < d.length; i++) {
      const k = clamp01((clamp01((R - d[i]) / FEATHER_M) * 1.25 - h[i]) * 5)
      const o = i * 16
      for (let j = 0; j < 12; j++) arr[o + j] = base[o + j] * k
      arr[o + 12] = base[o + 12]
      arr[o + 13] = base[o + 13]
      arr[o + 14] = base[o + 14]
      arr[o + 15] = 1
    }
    mesh.instanceMatrix.needsUpdate = true
    if (now - district.born > (GROW_SECONDS + 0.5) * 1000) done.current = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} raycast={noRaycast} />
}

// How far along the growth is, 0 to 1, for the things that arrive last (tram, flyers).
const lateShow = (district, now) => clamp01(((now - district.born) / 1000 / GROW_SECONDS - 0.75) * 4)

// The sky tram: a rail loop with a glowing guide line and pods running along it.
function SkyTram({ district }) {
  const { loop, pods } = district.transit
  const curve = useMemo(() => new THREE.CatmullRomCurve3(loop.map((p) => new THREE.Vector3(...p)), true, 'centripetal'), [loop])
  const rail = useMemo(() => new THREE.TubeGeometry(curve, 600, 0.8, 8, true), [curve])
  const glow = useMemo(() => new THREE.TubeGeometry(curve, 600, 0.3, 6, true).translate(0, 0, -1.1), [curve])
  useEffect(() => () => (rail.dispose(), glow.dispose()), [rail, glow])
  const group = useRef(), bodies = useRef(), windows = useRef()
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), y: new THREE.Vector3(0, 1, 0) }), [])

  useFrame(({ clock }) => {
    const show = lateShow(district, performance.now())
    group.current.visible = show > 0
    if (!show) return
    const length = curve.getLength()
    for (let k = 0; k < pods; k++) {
      const u = (((clock.elapsedTime * 22) / length + k / pods) % 1 + 1) % 1
      const p = curve.getPointAt(u), t = curve.getTangentAt(u)
      tmp.q.setFromUnitVectors(tmp.y, t)
      tmp.m.compose(p.setZ(p.z - 2.6), tmp.q, tmp.s.setScalar(show))
      bodies.current.setMatrixAt(k, tmp.m)
      windows.current.setMatrixAt(k, tmp.m)
    }
    bodies.current.instanceMatrix.needsUpdate = true
    windows.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={group} visible={false}>
      <mesh geometry={rail} raycast={noRaycast}>
        <meshLambertMaterial color={C.rail} />
      </mesh>
      <mesh geometry={glow} raycast={noRaycast}>
        <meshBasicMaterial color={C.glow} />
      </mesh>
      <instancedMesh ref={bodies} args={[undefined, undefined, pods]} frustumCulled={false} raycast={noRaycast}>
        <capsuleGeometry args={[1.5, 7, 4, 12]} />
        <meshLambertMaterial color={C.pod} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[undefined, undefined, pods]} frustumCulled={false} raycast={noRaycast}>
        <capsuleGeometry args={[1.56, 4.6, 4, 12]} />
        <meshLambertMaterial color="#27495a" />
      </instancedMesh>
    </group>
  )
}

// Air taxis on looping routes, and one slow solar airship.
function Flyers({ district }) {
  const { flyers, airship, center } = district
  const n = flyers.length
  const bodies = useRef(), canopies = useRef(), rotors = useRef(), lights = useRef(), ship = useRef()
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), o: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() }), [])

  useFrame(({ clock }) => {
    const show = lateShow(district, performance.now())
    const t = clock.elapsedTime
    const set = (mesh, i, x, y, z, yaw, sx, sy, sz) => {
      tmp.q.setFromEuler(tmp.e.set(0, 0, yaw))
      mesh.setMatrixAt(i, tmp.m.compose(tmp.p.set(x, y, z), tmp.q, tmp.s.set(sx * show, sy * show, sz * show)))
    }
    flyers.forEach((f, i) => {
      const a = f.phase + t * f.speed
      const x = f.c[0] + f.rx * Math.cos(a), y = f.c[1] + f.ry * Math.sin(a), z = f.z + 6 * Math.sin(a * 2.3)
      const yaw = Math.atan2(f.ry * Math.cos(a), -f.rx * Math.sin(a)) + (f.speed < 0 ? Math.PI : 0)
      set(bodies.current, i, x, y, z, yaw, 2.6, 1.3, 0.9)
      set(canopies.current, i, x + Math.cos(yaw) * 1.1, y + Math.sin(yaw) * 1.1, z + 0.5, yaw, 1.3, 0.85, 0.7)
      set(lights.current, i, x - Math.cos(yaw) * 2.5, y - Math.sin(yaw) * 2.5, z, yaw, 0.35, 0.35, 0.35)
      ;[[1.9, 1.5], [1.9, -1.5], [-1.9, 1.5], [-1.9, -1.5]].forEach(([u, v], k) => {
        const rx = x + Math.cos(yaw) * u - Math.sin(yaw) * v, ry = y + Math.sin(yaw) * u + Math.cos(yaw) * v
        set(rotors.current, i * 4 + k, rx, ry, z + 0.7, t * 30, 1.2, 1.2, 0.08)
      })
    })
    for (const m of [bodies, canopies, rotors, lights]) m.current.instanceMatrix.needsUpdate = true

    const a = airship.phase + t * airship.speed
    ship.current.position.set(center[0] + airship.radius * Math.cos(a), center[1] + airship.radius * Math.sin(a), airship.z)
    ship.current.rotation.set(0, 0, a + Math.PI / 2)
    ship.current.scale.setScalar(Math.max(show, 0.0001))
    ship.current.visible = show > 0
  })

  return (
    <group>
      <instancedMesh ref={bodies} args={[GEOMETRIES.ball, undefined, n]} frustumCulled={false} raycast={noRaycast}>
        <meshLambertMaterial color={C.pod} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[GEOMETRIES.ball, undefined, n]} frustumCulled={false} raycast={noRaycast}>
        <meshLambertMaterial color="#2c5566" />
      </instancedMesh>
      <instancedMesh ref={rotors} args={[GEOMETRIES.cyl, undefined, n * 4]} frustumCulled={false} raycast={noRaycast}>
        <meshLambertMaterial color="#9aa3a8" transparent opacity={0.6} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[GEOMETRIES.ball, undefined, n]} frustumCulled={false} raycast={noRaycast}>
        <meshBasicMaterial color={C.glow} />
      </instancedMesh>
      <group ref={ship} visible={false}>
        {/* white hull with a skin of solar cells on top, a gondola and four fins */}
        <mesh geometry={GEOMETRIES.ball} scale={[30, 9, 9]} raycast={noRaycast}>
          <meshLambertMaterial color={C.airship} />
        </mesh>
        <mesh geometry={GEOMETRIES.ball} scale={[27, 6.6, 9]} position={[0, 0, 0.9]} raycast={noRaycast}>
          <meshPhongMaterial color={C.panel} shininess={90} specular="#86a6dc" />
        </mesh>
        <mesh geometry={GEOMETRIES.box} scale={[9, 3, 2.6]} position={[2, 0, -11]} raycast={noRaycast}>
          <meshLambertMaterial color={C.struct} />
        </mesh>
        {[[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].map(([, y, z], k) => (
          <mesh key={k} geometry={GEOMETRIES.box} scale={[6, z ? 0.4 : 6, z ? 6 : 0.4]} position={[-27, y * 4, z * 4 - (z ? 3 : 0.5)]} raycast={noRaycast}>
            <meshLambertMaterial color={C.struct} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// People walking the streets (turning at junctions) and the skybridges (back and forth).
function Walkers({ district }) {
  const { list, paths, nodeEdges } = district.walkers
  const ref = useRef()
  const lengths = useMemo(
    () =>
      paths.map(({ pts }) => {
        const acc = [0]
        for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
        return acc
      }),
    [paths],
  )
  const people = useMemo(() => list.map((w) => ({ ...w })), [list])

  useEffect(() => {
    const c = new THREE.Color()
    people.forEach((w, i) => ref.current.setColorAt(i, c.set(w.color)))
    ref.current.instanceColor.needsUpdate = true
  }, [people])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const R = frontAt(district, performance.now())
    const arr = ref.current.instanceMatrix.array
    people.forEach((w, i) => {
      let pts, acc
      if (w.path) {
        pts = w.path
        const L = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        acc = [0, L]
        w.along += w.speed * dt
        if (w.along < 0 || w.along > L) (w.speed = -w.speed), (w.along = Math.max(0, Math.min(L, w.along)))
      } else {
        w.along += w.speed * dt
        const L = lengths[w.edge].at(-1)
        if (w.along > L || w.along < 0) {
          const e = paths[w.edge]
          const node = w.along > L ? e.to : e.from
          const next = (nodeEdges.get(node) ?? []).filter((j) => j !== w.edge)
          if (next.length) {
            w.edge = next[Math.floor(Math.random() * next.length)]
            const forward = paths[w.edge].from === node
            w.along = forward ? 0 : lengths[w.edge].at(-1)
            w.speed = Math.abs(w.speed) * (forward ? 1 : -1)
          } else {
            w.speed = -w.speed
            w.along = Math.max(0, Math.min(L, w.along))
          }
        }
        pts = paths[w.edge].pts
        acc = lengths[w.edge]
      }
      let k = 1
      while (k < acc.length - 1 && acc[k] < w.along) k++
      const a = pts[k - 1], b = pts[k], seg = acc[k] - acc[k - 1] || 1
      const f = (w.along - acc[k - 1]) / seg
      const nx = -(b[1] - a[1]) / seg, ny = (b[0] - a[0]) / seg
      const x = a[0] + (b[0] - a[0]) * f + nx * w.lane, y = a[1] + (b[1] - a[1]) * f + ny * w.lane
      const s = Math.hypot(x - district.center[0], y - district.center[1]) < R - 10 ? 1 : 0
      const o = i * 16
      arr[o] = arr[o + 5] = arr[o + 10] = s
      arr[o + 12] = x
      arr[o + 13] = y
      arr[o + 14] = a[2] ?? 0
      arr[o + 15] = 1
    })
    ref.current.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[GEOMETRIES.person, MATERIALS.solid, people.length]} frustumCulled={false} raycast={noRaycast} />
}

// The surfaces you can stand on in photo mode (bridge decks, floors, terraces, roof gardens), as one
// invisible mesh that only catches clicks, from above and below. A click on it stands you there.
const STANDABLE = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
const PLANT_CLEARANCE_M = 1.2

function Standable({ district, onStand }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const { z, pts } of district.stand)
      for (let k = 1; k < pts.length - 1; k++) pos.push(...pts[0], z, ...pts[k], z, ...pts[k + 1], z)
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeBoundingSphere()
    return g
  }, [district])
  useEffect(() => () => geometry.dispose(), [geometry])
  // The plants up on floors and bridges (trunks, crowns, hanging gardens), each as an upright
  // cylinder (x, y, bottom, top, radius), so you don't land with your head inside one.
  const plants = useMemo(() => {
    const raised = (name, f) => (district.layers[name] ?? []).filter((t) => t.p[2] > 1).map(f)
    return [
      ...raised('trunk', ({ p, s }) => [p[0], p[1], p[2], p[2] + s[2], s[0]]),
      ...raised('leaf', ({ p, s }) => [p[0], p[1], p[2] - s[2], p[2] + s[2], s[0]]),
      ...raised('conifer', ({ p, s }) => [p[0], p[1], p[2], p[2] + s[2], s[0]]),
    ]
  }, [district])
  const stand = (e) => {
    // Not while the district is still growing, and not at the end of a drag: let the click fall through.
    if (e.delta > 5 || performance.now() - district.born < GROW_SECONDS * 1000) return
    e.stopPropagation()
    let x = e.point.x, y = -e.point.z
    const z = e.point.y
    for (let pass = 0; pass < 3; pass++)
      for (const [px, py, bottom, top, r] of plants) {
        if (top < z || bottom > z + EYE_HEIGHT_M + 0.6) continue
        const clear = r + PLANT_CLEARANCE_M
        const dx = x - px, dy = y - py, d = Math.hypot(dx, dy)
        if (d >= clear) continue
        ;[x, y] = d > 0.01 ? [px + (dx * clear) / d, py + (dy * clear) / d] : [px + clear, py]
      }
    onStand([x, y, z])
  }
  return <mesh geometry={geometry} material={STANDABLE} onClick={stand} />
}

function District({ district, onStand }) {
  return (
    <group>
      {Object.entries(district.layers).map(([name, items]) => {
        const [geometry, material] = LAYERS[name]
        return <GrowingLayer key={name} items={items} geometry={GEOMETRIES[geometry]} material={MATERIALS[material]} district={district} />
      })}
      <SkyTram district={district} />
      <Flyers district={district} />
      <Walkers district={district} />
      {onStand && <Standable district={district} onStand={onStand} />}
    </group>
  )
}

// All solarpunk districts, and the shared growing fronts the building and ground shaders read.
// With onStand (photo mode), clicks on bridges, floors and terraces stand you there.
export default function SolarCity({ districts, onStand }) {
  useFrame(() => {
    const now = performance.now()
    solarUniforms.uZoneCount.value = districts.length
    districts.forEach((d, i) => solarUniforms.uZones.value[i].set(d.center[0], d.center[1], frontAt(d, now), 0))
  })
  return districts.map((d) => <District key={d.born} district={d} onStand={onStand} />)
}
