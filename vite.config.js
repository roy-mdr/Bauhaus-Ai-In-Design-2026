import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { replicateRenderPlugin } from './scripts/replicate.mjs'

// GitHub Pages serves the site at https://<user>.github.io/<repo>/.
// In GitHub Actions, GITHUB_REPOSITORY is "<user>/<repo>"; locally it is unset.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repo && !repo.endsWith('.github.io') ? `/${repo}/` : '/'

export default defineConfig({
  // replicateRenderPlugin adds /api/render to the local dev server only (npm run dev): it uses the
  // Replicate key from .env in Node, so the key never reaches the page. GitHub Pages has no such server.
  plugins: [react(), replicateRenderPlugin(fileURLToPath(new URL('.', import.meta.url)))],
  base,
})
