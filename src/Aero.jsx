import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js'
import { AERO } from './colors.js'

// The Frutiger Aero setting around the city: a dome that runs from grass green below the horizon
// to blue sky above, a low warm sun with lens flares, and a glass rim around the round ground.
// Sky and sun live in three.js's own frame, where y is up.

const noRaycast = () => null
// Low in the west-south-west, about 12° above the horizon, so the sun and its flares come into view
// when you tilt down to the horizon and look that way.
export const SUN_POSITION = [-1500, 380, 950]

export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new THREE.Color(AERO.zenith) },
          uSky: { value: new THREE.Color(AERO.sky) },
          uHorizon: { value: new THREE.Color(AERO.horizon) },
          uMeadow: { value: new THREE.Color(AERO.meadow) },
          uGrass: { value: new THREE.Color(AERO.grass) },
          uDeepGrass: { value: new THREE.Color(AERO.deepGrass) },
          uSun: { value: new THREE.Color(AERO.sun) },
          uSunDir: { value: new THREE.Vector3(...SUN_POSITION).normalize() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith, uSky, uHorizon, uMeadow, uGrass, uDeepGrass, uSun, uSunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 sky = mix(mix(uHorizon, uSky, smoothstep(0.0, 0.22, h)), uZenith, smoothstep(0.22, 0.95, h));
            vec3 grass = mix(mix(uMeadow, uGrass, smoothstep(-0.02, -0.25, h)), uDeepGrass, smoothstep(-0.25, -0.9, h));
            vec3 col = mix(grass, sky, smoothstep(-0.03, 0.01, h));
            float s = max(dot(d, uSunDir), 0.0);
            col += uSun * (pow(s, 900.0) * 1.2 + pow(s, 60.0) * 0.3 + pow(s, 6.0) * 0.06) * step(-0.02, h);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1}>
      <sphereGeometry args={[9000, 48, 32]} />
    </mesh>
  )
}

// Lens flare pieces, painted on small canvases: a soft glow, a soft disc, a thin ring and a hexagon
// (the shape of a camera's aperture).
function flareTexture(draw) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  draw(canvas.getContext('2d'), 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const FLARES = {
  glow: (g, c) => {
    const r = g.createRadialGradient(c, c, 0, c, c, c)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.12, 'rgba(255,250,225,0.85)')
    r.addColorStop(0.4, 'rgba(255,235,180,0.25)')
    r.addColorStop(1, 'rgba(255,230,170,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 2 * c, 2 * c)
  },
  disc: (g, c) => {
    const r = g.createRadialGradient(c, c, 0, c, c, c)
    r.addColorStop(0, 'rgba(255,255,255,0.35)')
    r.addColorStop(0.75, 'rgba(255,255,255,0.22)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 2 * c, 2 * c)
  },
  ring: (g, c) => {
    const r = g.createRadialGradient(c, c, c * 0.72, c, c, c)
    r.addColorStop(0, 'rgba(255,255,255,0)')
    r.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 2 * c, 2 * c)
  },
  hexagon: (g, c) => {
    g.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6
      g.lineTo(c + Math.cos(a) * c * 0.9, c + Math.sin(a) * c * 0.9)
    }
    g.closePath()
    const r = g.createRadialGradient(c, c, 0, c, c, c)
    r.addColorStop(0, 'rgba(255,255,255,0.18)')
    r.addColorStop(0.85, 'rgba(255,255,255,0.4)')
    r.addColorStop(1, 'rgba(255,255,255,0.1)')
    g.fillStyle = r
    g.fill()
  },
}

// The sun's lens flare: a warm glow at the sun and a trail of tinted ghosts across the screen.
// three.js hides it when a building stands in front of the sun.
export function SunFlare() {
  const light = useMemo(() => {
    const textures = Object.fromEntries(Object.entries(FLARES).map(([k, draw]) => [k, flareTexture(draw)]))
    const flare = new Lensflare()
    const add = (texture, size, distance, color) => flare.addElement(new LensflareElement(textures[texture], size, distance, new THREE.Color(color)))
    add('glow', 480, 0, '#c9b07a')
    add('glow', 130, 0, '#ffffff')
    add('hexagon', 70, 0.22, '#9ff3ff')
    add('disc', 120, 0.38, '#b8f59a')
    add('hexagon', 95, 0.55, '#ffc2e6')
    add('ring', 280, 0.7, '#8fe4ff')
    add('hexagon', 55, 0.84, '#fff1a0')
    add('disc', 190, 1.0, '#7fc8ff')
    const sun = new THREE.PointLight('#ffffff', 0, 0)
    sun.position.set(...SUN_POSITION).normalize().multiplyScalar(8000)
    sun.add(flare)
    return { sun, flare, textures }
  }, [])
  useEffect(() => () => {
    light.flare.dispose()
    Object.values(light.textures).forEach((t) => t.dispose())
  }, [light])
  return <primitive object={light.sun} />
}

// A glossy glass look: clear in the middle, bright at the edges, with a sharp highlight.
export function makeAeroGlass(opacity, rimStrength = 0.6) {
  const material = new THREE.MeshPhongMaterial({
    color: AERO.glass,
    transparent: true,
    opacity,
    depthWrite: false,
    shininess: 140,
    specular: new THREE.Color('#ffffff'),
  })
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float aeroRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.5);
outgoingLight += vec3(0.75, 0.95, 1.0) * aeroRim * ${rimStrength.toFixed(2)};
diffuseColor.a = clamp(diffuseColor.a + aeroRim * ${rimStrength.toFixed(2)}, 0.0, 1.0);
#include <opaque_fragment>`,
    )
  }
  material.customProgramCacheKey = () => `aero-glass-${opacity}-${rimStrength}`
  return material
}

// The glossy edge of the round ground: an aqua glass ring and a translucent glass base below it.
// These two live in the city's frame, where z is up.
export function DiscRim({ radius }) {
  const ring = useMemo(() => makeAeroGlass(0.55, 0.5), [])
  const base = useMemo(() => Object.assign(makeAeroGlass(0.22, 0.6), { side: THREE.DoubleSide }), [])
  return (
    <group>
      <mesh material={ring} raycast={noRaycast}>
        <torusGeometry args={[radius, 7, 16, 160]} />
      </mesh>
      <mesh material={base} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -40]} raycast={noRaycast}>
        <cylinderGeometry args={[radius, radius * 0.94, 80, 160, 1, true]} />
      </mesh>
    </group>
  )
}
