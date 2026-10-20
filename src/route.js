import { MAX_SNAP_M, SPEED_M_PER_MIN, pointSegmentDistance } from './reach.js'

// For every node, its neighbours with the edge line drawn from this node to the neighbour.
export function prepareRouting(city) {
  const links = new Map()
  for (const e of city.edges) {
    const add = (a, b, points) => {
      if (!links.has(a)) links.set(a, [])
      links.get(a).push({ node: b, length: e.length, points })
    }
    add(e.from, e.to, e.points)
    add(e.to, e.from, [...e.points].reverse())
  }
  return links
}

// The walkable node nearest to a click at [x, y] in metres, or an error if no street is close.
export function snapToNode(city, click) {
  let streetDistance = Infinity
  for (const e of city.edges)
    for (let i = 1; i < e.points.length; i++)
      streetDistance = Math.min(streetDistance, pointSegmentDistance(click, e.points[i - 1], e.points[i]))
  if (streetDistance > MAX_SNAP_M) return { error: `There is no walkable street within ${MAX_SNAP_M} m of this point. Click closer to a street.` }

  let node = null, best = Infinity
  for (const id of city.neighbours.keys()) {
    const [x, y] = city.nodeXY.get(id)
    const d = Math.hypot(x - click[0], y - click[1])
    if (d < best) [node, best] = [id, d]
  }
  return { node, xy: city.nodeXY.get(node) }
}

// A small priority queue: always hands back the item with the lowest score.
function makeHeap() {
  const heap = []
  return {
    get size() { return heap.length },
    push(item) {
      heap.push(item)
      let i = heap.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[p], heap[i]] = [heap[i], heap[p]]
        i = p
      }
    },
    pop() {
      const top = heap[0], last = heap.pop()
      if (heap.length) {
        heap[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1, r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          i = m
        }
      }
      return top
    },
  }
}

// A* search from node `from` to node `to`. It always looks next at the node with the lowest
// "walked so far + straight line still to go". With `guess` off it is Dijkstra's search,
// which only looks at "walked so far"; we run that too, to compare how much each one explores.
// Besides the path, it records the order of the search so it can be replayed:
//   expanded: the nodes in the order they were settled (one step each)
//   relaxed:  every edge the search walked along, with the step at which it did so
//   pushStep: the step at which each node was first put on the frontier
function search(city, links, from, to, guess = true) {
  const [tx, ty] = city.nodeXY.get(to)
  const h = (n) => {
    if (!guess) return 0
    const [x, y] = city.nodeXY.get(n)
    return Math.hypot(x - tx, y - ty)
  }
  const walked = new Map([[from, 0]])
  const cameFrom = new Map()
  const settled = new Set()
  const expanded = [], relaxed = [], pushStep = new Map([[from, 0]])
  const open = makeHeap()
  open.push([h(from), from])

  while (open.size) {
    const [, node] = open.pop()
    if (settled.has(node)) continue
    settled.add(node)
    const step = expanded.length
    expanded.push(node)
    if (node === to) break
    for (const link of links.get(node) ?? []) {
      if (settled.has(link.node)) continue
      const g = walked.get(node) + link.length
      if (g >= (walked.get(link.node) ?? Infinity)) continue
      walked.set(link.node, g)
      cameFrom.set(link.node, { node, points: link.points })
      relaxed.push({ step, points: link.points })
      if (!pushStep.has(link.node)) pushStep.set(link.node, step)
      open.push([g + h(link.node), link.node])
    }
  }

  // Follow the trail back from the destination and join the edge lines into one line.
  const pieces = []
  for (let n = to; n !== from; n = cameFrom.get(n).node) pieces.push(cameFrom.get(n).points)
  const points = [city.nodeXY.get(from)]
  for (const piece of pieces.reverse()) points.push(...piece.slice(1))
  return { expanded, relaxed, pushStep, points, length: walked.get(to) }
}

// Everything the page needs for one origin and one destination node.
export function findRoute(city, links, from, to) {
  const astar = search(city, links, from, to, true)
  const dijkstra = search(city, links, from, to, false)

  // Distance along the path at every point, for the walkthrough and the colour gradient.
  const along = [0]
  for (let i = 1; i < astar.points.length; i++) {
    const [a, b] = [astar.points[i - 1], astar.points[i]]
    along.push(along[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }

  return {
    ...astar,
    along,
    drawnLength: along[along.length - 1],
    minutes: astar.length / SPEED_M_PER_MIN,
    dijkstraExpanded: dijkstra.expanded.length,
  }
}
