import * as THREE from 'three'
import { FEATHER_M, MAX_DISTRICTS } from './solarpunk.js'

// Shared by the buildings and the ground: where the solarpunk districts are and how far each has grown.
// Each zone is (x, y, current radius, 0) in metres.
export const solarUniforms = {
  uZones: { value: Array.from({ length: MAX_DISTRICTS }, () => new THREE.Vector4()) },
  uZoneCount: { value: 0 },
  uFeather: { value: FEATHER_M },
}

const COMMON = /* glsl */ `
uniform vec4 uZones[${MAX_DISTRICTS}];
uniform int uZoneCount;
uniform float uFeather;
varying vec3 vLocal;

float spHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float spNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(spHash(i), spHash(i + vec2(1.0, 0.0)), f.x), mix(spHash(i + vec2(0.0, 1.0)), spHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// 1 inside a grown district, 0 outside, soft across the growing front.
float spGrowth(vec2 p) {
  float g = 0.0;
  for (int i = 0; i < ${MAX_DISTRICTS}; i++) {
    if (i >= uZoneCount) break;
    vec4 z = uZones[i];
    g = max(g, 1.0 - smoothstep(z.z - uFeather, z.z, distance(p, z.xy)));
  }
  return g;
}
`

// Buildings: windows by floor, a darker plinth, roof tiles; inside a district, plants climb the
// walls, flat roofs become gardens and solar fields, south-facing pitched roofs carry solar panels.
// aFacade = (distance along the wall or across the roof slope, kind); kinds: 0 wall, 1 flat roof,
// 2 pitched roof, 3 gable, 4 underside of the eaves. aBuild = (floor height, a number per building).
export function makeBuildingMaterial() {
  // Glossy, with a soft aqua sheen on the edges that turn away from the eye (the Frutiger Aero look).
  const material = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 45, specular: new THREE.Color('#5a6670') })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, solarUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aFacade;
attribute vec2 aBuild;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec2 vFacade;
varying vec2 vBuild;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLocal = position; vLocalNormal = normal; vFacade = aFacade; vBuild = aBuild;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${COMMON}
varying vec3 vLocalNormal;
varying vec2 vFacade;
varying vec2 vBuild;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  float kind = vFacade.y;
  float seed = vBuild.y;
  float g = spGrowth(vLocal.xy);
  vec3 plaster = vec3(0.95, 0.93, 0.86);
  if (kind < 0.5) {
    float fh = vBuild.x, z = vLocal.z;
    float level = floor(z / fh), fz = fract(z / fh);
    float bay = 2.9 + seed * 1.3;
    float column = floor(vFacade.x / bay), fu = fract(vFacade.x / bay);
    float ground = 1.0 - step(0.5, level);
    float hw = mix(0.24 + 0.08 * seed, 0.40, ground);
    float win = step(0.5 - hw, fu) * step(fu, 0.5 + hw) * step(mix(0.30, 0.10, ground), fz) * step(fz, mix(0.80, 0.82, ground));
    col *= 1.0 - 0.08 * (1.0 - smoothstep(0.0, 0.06, fz)) * (1.0 - ground);
    col *= mix(1.0, 0.78, step(z, 0.8));
    col = mix(col, mix(col, plaster, 0.45), g);
    float vineTop = (spNoise(vec2(vFacade.x * 0.08, seed * 13.0)) * 2.6 + spNoise(vec2(vFacade.x * 0.5, z * 0.3))) * fh;
    float vine = step(z, vineTop) * step(0.42, spNoise(vec2(vFacade.x * 0.7, z * 0.55) + seed * 5.0)) * g;
    vec3 leaf = mix(vec3(0.27, 0.48, 0.22), vec3(0.47, 0.66, 0.30), spNoise(vec2(vFacade.x * 1.7, z * 1.7)));
    vec3 glass = mix(vec3(0.20, 0.45, 0.62), vec3(0.62, 0.86, 0.97), spHash(vec2(level, column) + seed) * 0.8 + fz * 0.2);
    glass = mix(glass, vec3(0.50, 0.74, 0.78), 0.35 * g);
    col = mix(col, glass, win);
    col = mix(col, leaf, vine * (1.0 - 0.6 * win));
  } else if (kind < 1.5) {
    col *= 0.86 + 0.08 * spNoise(vLocal.xy * 0.9);
    vec3 garden = mix(vec3(0.33, 0.56, 0.25), vec3(0.56, 0.72, 0.33), spNoise(vLocal.xy * 0.6));
    float cells = step(0.12, fract(vLocal.x / 2.4)) * step(0.12, fract(vLocal.y / 1.6));
    vec3 solar = mix(vec3(0.72, 0.74, 0.77), vec3(0.11, 0.17, 0.33), cells);
    col = mix(col, spNoise(vLocal.xy * 0.12 + seed * 7.0) > 0.55 ? solar : garden, g);
  } else if (kind < 2.5) {
    col *= 0.74 + 0.1 * smoothstep(0.0, 0.12, fract(vFacade.x / 0.38));
    float south = smoothstep(0.05, 0.25, -vLocalNormal.y);
    vec2 cell = fract(vLocal.xy / vec2(1.1, 1.7));
    vec3 solar = mix(vec3(0.70, 0.72, 0.75), vec3(0.10, 0.16, 0.31), step(0.06, cell.x) * step(0.06, cell.y));
    vec3 sedum = mix(vec3(0.42, 0.58, 0.26), vec3(0.60, 0.66, 0.30), spNoise(vLocal.xy * 0.8));
    col = mix(col, mix(sedum, solar, south), g);
  } else if (kind < 3.5) {
    col = mix(col, mix(col, plaster, 0.45), g);
  } else {
    col *= 0.55;
  }
  diffuseColor.rgb = col;
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  float aeroRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
  outgoingLight += vec3(0.55, 0.85, 1.0) * aeroRim * 0.35;
}
#include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'weimar-buildings'
  return material
}

// The ground: pale paving, turning into meadow with flowers inside the districts.
export function makeGroundMaterial(color) {
  const material = new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, solarUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLocal = position;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // pearl white in the middle, clear aqua towards the rim of the disc
  float edge = smoothstep(500.0, 1350.0, length(vLocal.xy));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.90, 0.96), edge * 0.7);
  float g = spGrowth(vLocal.xy);
  float n = spNoise(vLocal.xy * 0.05) * 0.6 + spNoise(vLocal.xy * 0.4) * 0.4;
  vec3 meadow = mix(vec3(0.46, 0.64, 0.33), vec3(0.62, 0.74, 0.40), n);
  vec2 tuft = floor(vLocal.xy * 0.5);
  float flowers = step(0.9, spHash(tuft)) * step(0.5, spNoise(vLocal.xy * 0.03 + 4.0));
  meadow = mix(meadow, mix(vec3(0.98, 0.85, 0.35), vec3(0.95, 0.62, 0.72), spHash(tuft + 3.1)), flowers * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, meadow, g);
}`,
      )
  }
  material.customProgramCacheKey = () => 'weimar-ground'
  return material
}
