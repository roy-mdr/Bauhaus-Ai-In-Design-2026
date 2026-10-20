import { useEffect, useMemo, useRef, useState } from 'react'
import City, { WALK_M_PER_S, EYE_M } from './City.jsx'
import { prepareCity, MAX_SNAP_M, SPEED_M_PER_MIN } from './reach.js'
import { prepareRouting, snapToNode, findRoute } from './route.js'
import { USES, ROUTE_COLORS } from './colors.js'

const FILES = { kit: 'kit.json', buildings: 'buildings.geojson', graph: 'streets.graph.json', zensus: 'zensus.geojson' }

// Worded as in public/data/SOURCES.md.
const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

// The steps shown in the banner, and which one each stage belongs to.
const STEPS = ['Origin', 'Destination', 'A* search', 'Walkthrough']
const STEP_OF = { origin: 0, destination: 1, search: 2, found: 2, walking: 3, done: 4 }

// What the banner tells you to do at each stage.
const INSTRUCTIONS = {
  origin: 'Click on the map where the walk should start.',
  destination: 'Origin set. Now click on the map where the walk should end.',
  search: 'A* is searching for the shortest route…',
  found: 'Route found. The walkthrough starts in a moment.',
  walking: 'Gliding along the route at eye height…',
  done: 'Done. Click on the map to start a new route, or walk this one again.',
}

// Asking for a click: show a crosshair over the map.
const PICKING = new Set(['origin', 'destination', 'done'])

const fmt = (n) => Math.round(n).toLocaleString('en-GB')

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [origin, setOrigin] = useState(null) // { node, xy, click }: the street node, its position, and where you clicked
  const [destination, setDestination] = useState(null)
  const [route, setRoute] = useState(null)
  const [phase, setPhase] = useState('origin')
  const [message, setMessage] = useState(null)
  const [walkCmd, setWalkCmd] = useState(null) // a button press for the walk: { kind: 'start' | 'skip' }
  const progressRef = useRef(null)
  const routeCount = useRef(0)

  useEffect(() => {
    Promise.all(
      Object.entries(FILES).map(([key, file]) =>
        fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => {
          if (!r.ok) throw new Error(`data/${file}: ${r.status}`)
          return r.json().then((json) => [key, json])
        }),
      ),
    )
      .then((entries) => setData(Object.fromEntries(entries)))
      .catch((e) => setError(e.message))
  }, [])

  const city = useMemo(() => data && prepareCity(data), [data])
  const links = useMemo(() => city && prepareRouting(city), [city])

  const reset = () => {
    setOrigin(null)
    setDestination(null)
    setRoute(null)
    setWalkCmd(null)
    setMessage(null)
    setPhase('origin')
  }

  const pick = (xy) => {
    if (phase === 'search' || phase === 'found' || phase === 'walking') return // let the show finish
    const snap = snapToNode(city, xy)
    if (snap.error) return setMessage(snap.error)
    setMessage(null)
    const point = { ...snap, click: xy }
    if (phase !== 'destination') {
      // A new origin: forget the old route.
      reset()
      setOrigin(point)
      setPhase('destination')
      return
    }
    if (snap.node === origin.node) return setMessage('That is the origin. Pick a destination further away.')
    setDestination(point)
    setWalkCmd(null)
    setRoute({ ...findRoute(city, links, origin.node, snap.node), id: ++routeCount.current })
    setPhase('search')
  }

  const showStats = route && phase !== 'search'

  return (
    <div className={PICKING.has(phase) ? 'app picking' : 'app'}>
      {city ? (
        <City city={city} size={data.kit.size_m} origin={origin} destination={destination} route={route}
          walkCmd={walkCmd} onPick={pick} onPhase={setPhase} progressRef={progressRef} />
      ) : (
        <p className="loading">{error ? `The city kit didn't load (${error}).` : 'Loading the city kit…'}</p>
      )}

      {city && (
        <div className="steps" role="status">
          <ol>
            {STEPS.map((label, i) => (
              <li key={label} className={i < STEP_OF[phase] ? 'past' : i === STEP_OF[phase] ? 'now' : ''}>
                <span className="number">{i < STEP_OF[phase] ? '✓' : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <p className={message ? 'instruction error' : 'instruction'}>{message ?? INSTRUCTIONS[phase]}</p>
        </div>
      )}

      <aside className="panel">
        <h1>A* route walk</h1>
        <p className="hint">Drag to orbit, right-drag to pan, scroll to zoom.</p>

        <ul className="points">
          {[['Origin', origin, ROUTE_COLORS.origin], ['Destination', destination, ROUTE_COLORS.destination]].map(([label, p, c]) => (
            <li key={label}>
              <span className="swatch" style={{ background: c }} />
              <strong>{label}:</strong>{' '}
              {p ? (
                Math.hypot(p.click[0] - p.xy[0], p.click[1] - p.xy[1]) < 3
                  ? 'set, on a street corner'
                  : `set, ${fmt(Math.hypot(p.click[0] - p.xy[0], p.click[1] - p.xy[1]))} m from your click to the nearest street corner`
              ) : (
                <span className="note">not set yet</span>
              )}
            </li>
          ))}
        </ul>

        {phase === 'walking' && (
          <div className="actions">
            <span className="progress" ref={progressRef} />
            <button onClick={() => setWalkCmd({ kind: 'skip' })}>Skip to the end</button>
          </div>
        )}
        {phase === 'done' && (
          <div className="actions">
            <button onClick={() => setWalkCmd({ kind: 'start' })}>Walk again</button>
            <button onClick={reset}>New route</button>
          </div>
        )}

        {showStats && (
          <table className="results">
            <tbody>
              <tr>
                <th>Route</th>
                <td>{fmt(route.length)} m, about {Math.max(1, Math.round(route.minutes))} min on foot</td>
              </tr>
              <tr>
                <th>A* looked at</th>
                <td>{fmt(route.expanded.length)} of {fmt(city.neighbours.size)} street nodes</td>
              </tr>
              <tr>
                <th>Dijkstra would</th>
                <td>{fmt(route.dijkstraExpanded)} nodes for the same route</td>
              </tr>
            </tbody>
          </table>
        )}

        <ul className="key">
          <li><span className="swatch" style={{ background: ROUTE_COLORS.frontier, borderColor: '#999' }} />Frontier: nodes waiting to be looked at</li>
          <li><span className="swatch" style={{ background: ROUTE_COLORS.explored }} />Streets the search has walked along</li>
          <li>
            <span className="swatch" style={{ background: `linear-gradient(90deg, ${ROUTE_COLORS.origin}, ${ROUTE_COLORS.destination})` }} />
            Shortest route
          </li>
        </ul>

        <div className="method">
          <p>
            A* searches the pedestrian network from the origin. It keeps a frontier of street nodes it could look at
            next and always takes the one where the distance walked so far plus the straight line still to go is the
            smallest. So it reaches towards the destination instead of spreading evenly in all directions, as
            Dijkstra's search does. The straight line is never longer than the real walk, so the route A* finds is
            still the shortest one along the network.
          </p>
          <p>
            Origin and destination are the network nodes nearest to your clicks; if no walkable street is within{' '}
            {MAX_SNAP_M} m, nothing is set. The walking time is at 4.8 km/h. The walkthrough moves at {WALK_M_PER_S} m
            per second, about {Math.round(WALK_M_PER_S / (SPEED_M_PER_MIN / 60))} times walking pace, with the eye {EYE_M} m above the ground.
          </p>
        </div>
      </aside>

      <aside className="legend">
        <h2>Main use</h2>
        <ul>
          {USES.map((u) => (
            <li key={u.use}>
              <span className="swatch" style={{ background: u.color }} />
              {u.label}
            </li>
          ))}
        </ul>
      </aside>

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
