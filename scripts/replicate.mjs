// Turns a photo-mode view into a realistic photograph with Google's Nano Banana on Replicate.
// This runs in Node on the laptop, inside the dev server (see vite.config.js), never in the page:
// it reads REPLICATE_API_TOKEN from .env at the root of the repository and only ever sends it to Replicate.
import fs from 'fs'
import path from 'path'

const MODEL = 'google/nano-banana'
const API = 'https://api.replicate.com/v1'

function token(root) {
  const file = path.join(root, '.env')
  const line = fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('REPLICATE_API_TOKEN='))
  if (!line) throw new Error('REPLICATE_API_TOKEN is missing from .env at the root of the repository.')
  return line.slice('REPLICATE_API_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
}

// image: a data URL (JPEG or PNG) of the view; prompt: what to make of it.
// Returns the rendered picture as { mime, data } (data is a Buffer).
export async function renderPhoto(root, { image, prompt }) {
  const key = token(root)
  const call = async (url, options = {}) => {
    const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } })
    const body = await res.json()
    if (!res.ok) throw new Error(`Replicate answered ${res.status}: ${body.detail ?? body.title ?? res.statusText}`)
    return body
  }

  const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(image ?? '')
  if (!match || !prompt) throw new Error('The request needs an image (a data URL) and a prompt.')
  const form = new FormData()
  form.append('content', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), `view.${match[1].split('/')[1]}`)
  const file = await call(`${API}/files`, { method: 'POST', body: form })

  let prediction = await call(`${API}/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, image_input: [file.urls.get], aspect_ratio: 'match_input_image', output_format: 'png' } }),
  })
  while (['starting', 'processing'].includes(prediction.status)) {
    await new Promise((r) => setTimeout(r, 1500))
    prediction = await call(prediction.urls.get)
  }
  if (prediction.status !== 'succeeded') throw new Error(`The render ${prediction.status}${prediction.error ? `: ${prediction.error}` : ''}`)

  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
  const res = await fetch(url)
  return { mime: res.headers.get('content-type') ?? 'image/png', data: Buffer.from(await res.arrayBuffer()) }
}

// The dev server's /api/render: the page posts { image, prompt } and gets back { image } or { error }.
export function replicateRenderPlugin(root) {
  const handler = async (req, res, next) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/api/render')) return next()
    res.setHeader('Content-Type', 'application/json')
    try {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const { mime, data } = await renderPhoto(root, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      res.end(JSON.stringify({ image: `data:${mime};base64,${data.toString('base64')}` }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: e.message }))
    }
  }
  return {
    name: 'replicate-render',
    // (block bodies: a function returned from these hooks would be run by Vite as a later step)
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
