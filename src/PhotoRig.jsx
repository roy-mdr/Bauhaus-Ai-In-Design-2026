import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EYE_HEIGHT_M, fovFor } from './photo.js'
import { SUN_POSITION } from './Aero.jsx'

const MAX_PHOTO_WIDTH = 1536

// Lets the page take a picture of the 3D view: captureRef.current() draws a fresh frame and returns
// { image (a JPEG data URL, without the camera screen, which is not part of the 3D view), pitch
// (degrees, + up), sun: { inFrame, where, ahead, side } }.
export function Snapshot({ captureRef }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera)
      const src = gl.domElement
      const scale = Math.min(1, MAX_PHOTO_WIDTH / src.width)
      const out = document.createElement('canvas')
      out.width = Math.round(src.width * scale)
      out.height = Math.round(src.height * scale)
      out.getContext('2d').drawImage(src, 0, 0, out.width, out.height)

      const forward = camera.getWorldDirection(new THREE.Vector3())
      const sunDir = new THREE.Vector3(...SUN_POSITION).normalize()
      const s = sunDir.clone().multiplyScalar(8000).project(camera)
      const facing = forward.dot(sunDir)
      const inFrame = facing > 0 && Math.abs(s.x) < 1 && Math.abs(s.y) < 1
      const where = [s.y > 0.33 ? 'high' : s.y < -0.33 ? 'low' : '', s.x < -0.33 ? 'on the left' : s.x > 0.33 ? 'on the right' : 'in the middle'].filter(Boolean).join(' ')
      return {
        image: out.toDataURL('image/jpeg', 0.92),
        pitch: (Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) * 180) / Math.PI,
        sun: { inFrame, where, ahead: facing > 0.15, side: s.x < 0 ? 'to the left' : 'to the right' },
      }
    }
    return () => (captureRef.current = null)
  }, [gl, scene, camera, captureRef])
  return null
}

const FLIGHT_SECONDS = 1.6
const AERIAL_FOV = 40
const AERIAL_NEAR = 2
const EYE_NEAR = 0.25
const LOOK_AHEAD_M = 0.05

// How the mouse works: orbiting over the map, looking around at eye level, or nothing while flying.
const AERIAL = { enableRotate: true, enableZoom: true, enablePan: true, rotateSpeed: 1, minDistance: 30, maxDistance: 6000, minPolarAngle: 0, maxPolarAngle: Math.PI / 2.1 }
// At eye level the camera turns about a point a few centimetres ahead: dragging looks around.
const EYE = { enableRotate: true, enableZoom: false, enablePan: false, rotateSpeed: -0.35, minDistance: 0.01, maxDistance: 1, minPolarAngle: 0.15, maxPolarAngle: Math.PI - 0.15 }
const FLYING = { enableRotate: false, enableZoom: false, enablePan: false, minDistance: 0, maxDistance: Infinity, minPolarAngle: 0, maxPolarAngle: Math.PI }

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// Moves the camera down to a citizen's eyes (photo.eye, in metres east and north, standing photo.z
// metres above the ground: 0 on the street, more on a bridge or terrace) with a wide lens, and back
// up to where it was when photo becomes null.
export default function PhotoRig({ photo }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const size = useThree((s) => s.size)
  const saved = useRef(null) // the aerial view to come back to
  const flight = useRef(null)
  const eye = photo?.eye
  const floor = photo?.z ?? 0

  useEffect(() => {
    if (controls) Object.assign(controls, AERIAL)
  }, [controls])

  useEffect(() => {
    if (!controls) return
    const from = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near }
    if (eye) {
      if (!saved.current) saved.current = from
      // keep facing the way you were looking, but level
      const dir = controls.target.clone().sub(camera.position).setY(0)
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1)
      dir.normalize()
      const pos = new THREE.Vector3(eye[0], floor + EYE_HEIGHT_M, -eye[1])
      flight.current = { t: 0, from, to: { pos, target: pos.clone().addScaledVector(dir, LOOK_AHEAD_M), fov: fovFor(size.width / size.height), near: EYE_NEAR }, then: EYE }
    } else if (saved.current) {
      flight.current = { t: 0, from, to: { ...saved.current, fov: AERIAL_FOV, near: AERIAL_NEAR }, then: AERIAL }
      saved.current = null
    } else return
    Object.assign(controls, FLYING)
  }, [eye, floor, controls, camera, size.width, size.height])

  useFrame((_, delta) => {
    const f = flight.current
    if (!f || !controls) return
    f.t = Math.min(1, f.t + delta / FLIGHT_SECONDS)
    const k = ease(f.t)
    camera.position.lerpVectors(f.from.pos, f.to.pos, k)
    controls.target.lerpVectors(f.from.target, f.to.target, k)
    camera.fov = THREE.MathUtils.lerp(f.from.fov, f.to.fov, k)
    camera.near = THREE.MathUtils.lerp(f.from.near, f.to.near, k)
    camera.updateProjectionMatrix()
    camera.lookAt(controls.target)
    if (f.t === 1) {
      Object.assign(controls, f.then)
      flight.current = null
    }
  })

  return null
}
