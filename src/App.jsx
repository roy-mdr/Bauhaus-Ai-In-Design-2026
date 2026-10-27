import { useEffect, useMemo, useState } from 'react'
import City from './City.jsx'
import { prepareCity, computeReach, MINUTES, SPEED_M_PER_MIN, BAND_M, MAX_SNAP_M } from './reach.js'
import { growDistrict, GROW_SECONDS, MAX_DISTRICTS } from './solarpunk.js'
import { USES, REACH_COLORS, labelForUse } from './colors.js'
import { standPoint, EYE_HEIGHT_M, FOCAL_MM } from './photo.js'
import CameraHud from './CameraHud.jsx'

const FILES = { kit: 'kit.json', buildings: 'buildings.geojson', graph: 'streets.graph.json', zensus: 'zensus.geojson' }

// Worded as in public/data/SOURCES.md.
const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const fmt = (n) => n.toLocaleString('en-GB')

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [reach, setReach] = useState(null)
  const [marked, setMarked] = useState(null) // the building index of the shop picked in the list
  const [mode, setMode] = useState('solarpunk') // what a click does: grow a solarpunk district, or walk
  const [districts, setDistricts] = useState([])
  const [radius, setRadius] = useState(240)
  const [notice, setNotice] = useState(null)
  const [photo, setPhoto] = useState(null) // in photo mode: where the citizen stands, { eye: [x, y] }

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

  const pick = (xy) => {
    if (mode === 'photo') {
      setPhoto({ eye: standPoint(city, xy) })
      return
    }
    if (mode === 'reach') {
      setReach(computeReach(city, xy))
      setMarked(null)
      return
    }
    if (districts.length >= MAX_DISTRICTS) {
      setNotice(`The city holds up to ${MAX_DISTRICTS} districts. Reset to start again.`)
      return
    }
    setNotice(null)
    setDistricts([...districts, growDistrict(city, xy, radius, performance.now())])
  }

  const choose = (m) => {
    setMode(m)
    if (m !== 'photo') setPhoto(null)
  }

  return (
    <div className="app">
      {city ? (
        <City city={city} size={data.kit.size_m} reach={mode === 'reach' ? reach : null} marked={mode === 'reach' ? marked : null} districts={districts} photo={photo} onPick={pick}
          onStand={mode === 'photo' ? ([x, y, z]) => setPhoto({ eye: [x, y], z }) : null}
        />
      ) : (
        <p className="loading">{error ? `The city kit didn't load (${error}).` : 'Loading the city kit…'}</p>
      )}

      {photo && <CameraHud standing={photo.z ?? 0} onExit={() => setPhoto(null)} />}

      <aside className="panel" hidden={!!photo}>
        <div className="tabs" role="tablist">
          {[['solarpunk', 'Solarpunk'], ['reach', 'Walking reach'], ['photo', 'Photo']].map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => choose(m)}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'photo' ? (
          <section>
            <h1>Photo mode</h1>
            <p className="hint">
              Click a spot in the city to stand there as a citizen, at eye height ({EYE_HEIGHT_M} m), looking through a{' '}
              {FOCAL_MM} mm wide-angle lens. If you click a building, you stand on the street nearest to it.
            </p>
            <p className="hint">
              In a grown solarpunk district you can also stand up high: click a skybridge, a tower's floor, terrace or
              roof garden, a new green storey or a sky-tram platform.
            </p>
            <div className="method">
              <p>
                At eye level, drag to look around and click another spot to walk there. "Back to map" takes you back up.
                Grow some solarpunk districts first to stand among their towers, trees and people.
              </p>
              <p>The shutter button does not take pictures yet.</p>
            </div>
          </section>
        ) : mode === 'solarpunk' ? (
          <section className="solarpunk">
            <h1>Solarpunk Weimar</h1>
            <p className="hint">
              Click anywhere in the city: from there, today's Weimar grows into a solarpunk district within the radius
              below, over {GROW_SECONDS} seconds and with a soft edge. Click again elsewhere to grow more.
            </p>
            <label className="slider">
              <span>
                Radius <strong>{radius} m</strong>
              </span>
              <input type="range" min={120} max={420} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
            </label>
            {notice && <p className="error">{notice}</p>}
            {districts.length > 0 && (
              <>
                <ol className="districts">
                  {districts.map((d, i) => (
                    <li key={d.born}>
                      <strong>District {i + 1}</strong>, {d.radius} m:{' '}
                      <span className="note">
                        {d.stats.towers} towers, {d.stats.bridges} skybridges, {d.stats.crowned} buildings with new green storeys,{' '}
                        {fmt(d.stats.trees)} trees, {d.stats.solarTrees} solar trees, {fmt(d.stats.people)} people
                      </span>
                    </li>
                  ))}
                </ol>
                <button className="reset" onClick={() => (setDistricts([]), setNotice(null))}>
                  Reset the city
                </button>
              </>
            )}
            <div className="method">
              <p>
                <strong>What grows.</strong> Existing buildings stay: their flat roofs become gardens and solar fields,
                south-facing pitched roofs carry solar panels, plants climb the walls, and some flat-roofed buildings
                grow terraced green storeys. On open ground, away from streets and buildings, rise garden spires and
                terraced towers, highest near the centre, joined by glass skybridges with planted decks. A sky tram
                circles between stations on the tallest towers; air taxis and a solar airship fly above. Streets get
                solar trees, the ground turns into meadow with trees, and people walk the streets and bridges.
              </p>
              <p>
                This is a speculative picture, not a plan: towers are placed by simple rules on open ground in the kit
                data, not on real plots or by any planning law.
              </p>
            </div>
          </section>
        ) : (
          <section>
        <h1>Walking reach</h1>
        <p className="hint">Click on the ground to start walking from the nearest street node. Drag to orbit, right-drag to pan, scroll to zoom.</p>

        {reach?.error && <p className="error">{reach.error}</p>}

        <table className="results">
          <thead>
            <tr>
              <th>Walk</th>
              <th>Buildings</th>
              <th>Residents</th>
            </tr>
          </thead>
          <tbody>
            {MINUTES.map((m, i) => {
              const l = reach?.levels?.[i]
              return (
                <tr key={m}>
                  <td>
                    <span className="swatch" style={{ background: REACH_COLORS[i] }} />
                    {m} min
                  </td>
                  <td>{l ? fmt(l.buildings) : '–'}</td>
                  <td>
                    {l ? `about ${fmt(l.residents)}` : '–'}
                    {l?.cellsWithoutFigure > 0 && (
                      <span className="note">
                        {' '}+ {l.cellsWithoutFigure} {l.cellsWithoutFigure === 1 ? 'cell' : 'cells'} without a figure
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {reach?.levels && (
          <section className="shops">
            <h2>Shops within 5 minutes</h2>
            {reach.levels[0].shops.length === 0 ? (
              <p className="note">No building with retail floor area is in the 5-minute area.</p>
            ) : (
              <>
                <p className="note">
                  Buildings with retail floor area, largest first. The kit has no shop names, only building ids. Click
                  a row to mark the building.
                </p>
                <ul>
                  {reach.levels[0].shops.map((s) => (
                    <li key={s.id}>
                      <button className={marked === s.index ? 'marked' : ''} onClick={() => setMarked(marked === s.index ? null : s.index)}>
                        <span>Building {s.id}</span>
                        <span className="note">
                          {fmt(Math.round(s.retail))} m² retail{s.use !== 'retail' && `, mainly ${labelForUse(s.use).toLowerCase()}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <div className="method">
          <p>
            Walking speed is 4.8 km/h, that is {SPEED_M_PER_MIN} m per minute, along the walkable streets and paths of the
            network. The walk starts at the network node nearest to your click; if no walkable street is within{' '}
            {MAX_SNAP_M} m, nothing is drawn.
          </p>
          <p>
            Each area is the street segments reached in 5, 10 or 15 minutes, including the reachable part of the last
            segment, with a band of {BAND_M} m on each side, joined into one shape. A building counts when it touches the
            area.
          </p>
          <p>
            Residents come from the Zensus 2022 grid of 100 m cells: for each cell that overlaps the area, its population
            times the share of the cell's area inside it, added up and rounded to the nearest 10. Cells without a
            published figure are left out of the sum, not counted as zero; their number is shown next to it.
          </p>
        </div>
          </section>
        )}
      </aside>

      <aside className="legend" hidden={!!photo}>
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
