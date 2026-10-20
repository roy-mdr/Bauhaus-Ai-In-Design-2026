// The ground heights from public/data/terrain.json: a 5 m grid in the kit's metres.
// Heights in the scene are metres above the lowest point of the grid (`base_m` above sea level),
// so the scene stays near zero.
export function prepareTerrain({ origin: [x0, y0], step_m: step, cols, rows, base_m, heights_dm }) {
  const heights = Float32Array.from(heights_dm, (dm) => dm / 10)
  const at = (c, r) => heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]

  // The height at any point, blended between the four grid points around it.
  const heightAt = (x, y) => {
    const fx = (x - x0) / step, fy = (y - y0) / step
    const c = Math.floor(fx), r = Math.floor(fy)
    const tx = fx - c, ty = fy - r
    return (at(c, r) * (1 - tx) + at(c + 1, r) * tx) * (1 - ty) + (at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx) * ty
  }

  return { x0, y0, step, cols, rows, base: base_m, heights, heightAt }
}

// A line on the ground: extra points every `spacing` metres so it follows the slopes.
// Returns [x, y, z] points; `values` (one number per input point) are blended along, if given.
export function drape(terrain, points, lift = 0, spacing = terrain.step, values = null) {
  const out = [], vals = []
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]
    if (i > 0) {
      const [px, py] = points[i - 1]
      const n = Math.floor(Math.hypot(x - px, y - py) / spacing)
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1)
        const [sx, sy] = [px + (x - px) * t, py + (y - py) * t]
        out.push([sx, sy, terrain.heightAt(sx, sy) + lift])
        if (values) vals.push(values[i - 1] + (values[i] - values[i - 1]) * t)
      }
    }
    out.push([x, y, terrain.heightAt(x, y) + lift])
    if (values) vals.push(values[i])
  }
  return values ? { points: out, values: vals } : out
}
