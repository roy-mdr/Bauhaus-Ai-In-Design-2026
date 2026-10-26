// Turns a Rhino view capture into a photorealistic render with Google's Nano Banana on Replicate.
//
// 1. Put REPLICATE_API_TOKEN=... in .env at the root of the repository (it is git-ignored).
// 2. Run: node scripts/render.mjs <capture.png> [output.png] ["prompt"]
//
// The capture is uploaded to Replicate, the model redraws it as a photograph while keeping the
// camera, the composition and the geometry, and the result is saved next to the capture
// (as <capture>_render.png) unless another output path is given.
import fs from 'fs'
import path from 'path'

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const MODEL = 'google/nano-banana'
const API = 'https://api.replicate.com/v1'

const PROMPT = `Turn this 3D model view into a photorealistic architectural photograph. Keep the camera,
the framing, the composition and every shape exactly as they are: do not add, move or remove buildings,
trees, paths or objects.
The scene is a public park in Weimar, Germany, on a late summer afternoon with warm, low sunlight,
soft long shadows and a clear sky with a few light clouds.
The large wavy roof is a thin, smooth, white concrete shell with round skylight openings, carried by
slender white tree-like branching columns. The ground under it is a paved plaza of light natural stone
with a round stone fountain filled with clear water.
Paths are light stone paving; the green areas are lush mown lawn and wildflower meadow with grasses and
flowers; trees are real deciduous trees and conifers with natural foliage. Dark red patches on the
ground are modelling gaps: render them as the grass or paving around them.
Add a few people walking and sitting on the wooden benches, to give a sense of scale.
Natural colours, high detail, realistic materials, shot on a full-frame camera with a 24 mm lens.`

// The key from .env. It is only ever sent to Replicate, never printed.
function token() {
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8')
  const line = env.split(/\r?\n/).find((l) => l.startsWith('REPLICATE_API_TOKEN='))
  if (!line) throw new Error('REPLICATE_API_TOKEN is missing from .env')
  return line.slice('REPLICATE_API_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
}

async function call(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } })
  const body = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(body)}`)
  return body
}

const [input, output, prompt = PROMPT] = process.argv.slice(2)
if (!input) throw new Error('Usage: node scripts/render.mjs <capture.png> [output.png] ["prompt"]')
const target = output ?? input.replace(/\.\w+$/, '') + '_render.png'
const key = token()

// Which inputs the model takes, so only those are sent.
const model = await call(`${API}/models/${MODEL}`)
const accepts = Object.keys(model.latest_version.openapi_schema.components.schemas.Input.properties)
console.log('model inputs:', accepts.join(', '))

// Upload the capture.
const form = new FormData()
form.append('content', new Blob([fs.readFileSync(input)], { type: 'image/png' }), path.basename(input))
const file = await call(`${API}/files`, { method: 'POST', body: form })
console.log('uploaded', path.basename(input))

const wanted = { prompt, image_input: [file.urls.get], aspect_ratio: 'match_input_image', output_format: 'png' }
const params = Object.fromEntries(Object.entries(wanted).filter(([k]) => accepts.includes(k)))

// Ask for the render and wait for it.
let prediction = await call(`${API}/models/${MODEL}/predictions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'wait=60' },
  body: JSON.stringify({ input: params }),
})
while (['starting', 'processing'].includes(prediction.status)) {
  await new Promise((r) => setTimeout(r, 2000))
  prediction = await call(prediction.urls.get)
}
if (prediction.status !== 'succeeded') throw new Error(`The render ${prediction.status}: ${prediction.error}`)

// Save the result.
const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
const image = await fetch(url)
fs.writeFileSync(target, Buffer.from(await image.arrayBuffer()))
console.log('saved', target, `(${prediction.metrics?.predict_time?.toFixed(1) ?? '?'} s)`)
