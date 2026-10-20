import { useEffect, useMemo, useState } from 'react'
import City from './City.jsx'
import { prepareCity, computeReach, MINUTES, SPEED_M_PER_MIN, BAND_M, MAX_SNAP_M } from './reach.js'
import { USES, REACH_COLORS, labelForUse } from './colors.js'

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

  return (
    <div className="app">
      {city ? (
        <City city={city} size={data.kit.size_m} reach={reach} marked={marked}
          onPick={(xy) => {
            setReach(computeReach(city, xy))
            setMarked(null)
          }}
        />
      ) : (
        <p className="loading">{error ? `The city kit didn't load (${error}).` : 'Loading the city kit…'}</p>
      )}

      <aside className="panel">
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
