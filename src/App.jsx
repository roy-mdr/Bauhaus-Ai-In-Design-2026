import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import City from './City.jsx'
import { prepareCity, computeReach, MINUTES, SPEED_M_PER_MIN, BAND_M, MAX_SNAP_M } from './reach.js'
import { computeGrowth, RADII, GRADIENTS, STOREY_M } from './growth.js'
import { sunPosition, newShadow, DAYS, MIN_SUN_ALTITUDE } from './shadows.js'
import { windBase, windSpeed, windChange, WIND_DIRS } from './wind.js'
import { makeTerrain, EXAGGERATIONS } from './terrain.js'
import {
  USES, REACH_COLORS, GROWTH_COLOR, NEW_SHADOW_COLOR, WIND_CALM, WIND_NORMAL, WIND_STRONG, WINDIER_COLOR, CALMER_COLOR,
  labelForUse,
} from './colors.js'

const FILES = { kit: 'kit.json', buildings: 'buildings.geojson', graph: 'streets.graph.json', zensus: 'zensus.geojson', plots: 'plots.geojson' }

// Worded as in public/data/SOURCES.md.
const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const fmt = (n) => n.toLocaleString('en-GB')
const round100 = (n) => Math.round(n / 100) * 100
const clock = (hours) => `${Math.floor(hours)}:${String(Math.round((hours % 1) * 60)).padStart(2, '0')}`
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8]
const Swatch = ({ color }) => <span className="swatch" style={{ background: color }} />

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [reach, setReach] = useState(null)
  const [marked, setMarked] = useState(null) // the building index of the shop picked in the list
  const [mode, setMode] = useState('growth') // 'reach' for walking, 'growth' for city growth
  const [growthCentre, setGrowthCentre] = useState(null)
  const [radius, setRadius] = useState(300)
  const [storeys, setStoreys] = useState(6)
  const [gradient, setGradient] = useState('smooth')
  const [shadowsOn, setShadowsOn] = useState(true)
  const [day, setDay] = useState('mar')
  const [hour, setHour] = useState(15)
  const [windOn, setWindOn] = useState(true)
  const [windFrom, setWindFrom] = useState('W') // westerly winds are the most common in Thuringia
  const [exaggeration, setExaggeration] = useState(1) // 0 flat, 1 true scale, 3 three times higher

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
  const terrain = useMemo(() => city && makeTerrain(data.plots, city.project, data.kit.size_m), [city, data])
  const growth = useMemo(
    () => city && growthCentre && computeGrowth(city, growthCentre, { radius, storeys, gradient }),
    [city, growthCentre, radius, storeys, gradient],
  )
  const growthMode = mode === 'growth'

  // Sun and shadows. The new shadow waits for the slider to settle, so dragging stays smooth.
  const sun = useMemo(() => data && sunPosition(day, hour, data.kit.center), [data, day, hour])
  const sunUp = sun?.altitude >= MIN_SUN_ALTITUDE
  const settledSun = useDeferredValue(sun)
  const shadow = useMemo(
    () => (growthMode && shadowsOn && growth ? newShadow(city, data.kit.size_m, growth, settledSun) : null),
    [growthMode, shadowsOn, city, data, growth, settledSun],
  )

  // Wind: the flow around the footprints depends only on the direction; the heights change shelter and corner winds.
  const base = useMemo(
    () => growthMode && windOn && city && windBase(city, data.kit.size_m, WIND_DIRS.find((d) => d.id === windFrom).deg),
    [growthMode, windOn, city, data, windFrom],
  )
  const windBefore = useMemo(() => base && windSpeed(city, base, city.buildings.map((b) => b.height)), [city, base])
  const windAfter = useMemo(
    () => base && growth?.count && windSpeed(city, base, city.buildings.map((b, i) => b.height + growth.added[i])),
    [city, base, growth],
  )
  const windDiff = useMemo(() => windAfter && windChange(base, windBefore, windAfter), [base, windBefore, windAfter])
  const wind = useMemo(
    () => base && { base, speed: windAfter || windBefore, change: windDiff?.change },
    [base, windBefore, windAfter, windDiff],
  )

  return (
    <div className="app">
      {city ? (
        <City city={city} size={data.kit.size_m} terrain={terrain} exaggeration={exaggeration} marked={mode === 'reach' ? marked : null}
          reach={mode === 'reach' ? reach : null}
          growth={growthMode ? growth : null}
          sun={growthMode && shadowsOn && sunUp ? sun : null}
          newShadow={growthMode ? shadow : null}
          wind={growthMode ? wind : null}
          onPick={(xy) => {
            if (mode === 'growth') return setGrowthCentre(xy)
            setReach(computeReach(city, xy))
            setMarked(null)
          }}
        />
      ) : (
        <p className="loading">{error ? `The city kit didn't load (${error}).` : 'Loading the city kit…'}</p>
      )}

      <nav className="topbar">
        <div className="modes" role="tablist">
          <button role="tab" aria-selected={mode === 'growth'} onClick={() => setMode('growth')}>City growth</button>
          <button role="tab" aria-selected={mode === 'reach'} onClick={() => setMode('reach')}>Walking reach</button>
        </div>
        {mode === 'growth' && (
          <div className="controls">
            <label>
              Radius
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                {RADII.map((r) => <option key={r} value={r}>{r} m</option>)}
              </select>
            </label>
            <label>
              Storeys at the centre
              <input type="range" min="1" max="20" value={storeys} onChange={(e) => setStoreys(Number(e.target.value))} />
              <span className="value">+{storeys}</span>
            </label>
            <label>
              Gradient
              <select value={gradient} onChange={(e) => setGradient(e.target.value)}>
                {GRADIENTS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
            <button className="clear" disabled={!growthCentre} onClick={() => setGrowthCentre(null)}>Reset</button>
          </div>
        )}
        <label className="terrain-select">
          Terrain (simulated)
          <select value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value))}>
            {EXAGGERATIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      </nav>

      {mode === 'growth' ? (
        <aside className="panel">
          <h1>City growth</h1>
          <p className="hint">
            Click on the ground or a building to choose the centre of a new development. Buildings near it gain the most
            storeys; the gain fades to none at the edge of the radius.
          </p>
          <div className="gradient-key">
            <span style={{ background: `linear-gradient(to right, ${GROWTH_COLOR}, #e8c6d6)` }} />
            <div className="note"><span>+{storeys} storeys</span><span>+1 storey</span></div>
          </div>
          {growth ? (
            <table className="results">
              <tbody>
                <tr><td>Buildings raised</td><td>{fmt(growth.count)}</td></tr>
                <tr><td>Storeys added</td><td>{fmt(growth.totalStoreys)}</td></tr>
                <tr><td>New floor area</td><td>about {fmt(Math.round(growth.floorArea / 100) * 100)} m²</td></tr>
                <tr><td>Tallest building</td><td>{growth.count ? `${fmt(Math.round(growth.tallest))} m` : '–'}</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="note">No centre chosen yet.</p>
          )}
          <section className="layer">
            <label className="layer-toggle">
              <input type="checkbox" checked={shadowsOn} onChange={(e) => setShadowsOn(e.target.checked)} />
              Sun and shadows
            </label>
            {shadowsOn && (
              <>
                <div className="layer-controls">
                  <select value={day} onChange={(e) => setDay(e.target.value)}>
                    {DAYS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                  <input type="range" min="5" max="21" step="0.25" value={hour} onChange={(e) => setHour(Number(e.target.value))} />
                  <span className="value">{clock(hour)}</span>
                </div>
                <p className="note">
                  {sunUp
                    ? `The sun is ${Math.round(sun.altitude)}° above the horizon, in the ${compass(sun.azimuth)}.`
                    : 'The sun is down, or too low for useful shadows, at this time.'}
                </p>
                {sunUp && shadow && (
                  <p><Swatch color={NEW_SHADOW_COLOR} />New shadow on the ground: about {fmt(round100(shadow.area))} m²</p>
                )}
              </>
            )}
          </section>

          <section className="layer">
            <label className="layer-toggle">
              <input type="checkbox" checked={windOn} onChange={(e) => setWindOn(e.target.checked)} />
              Wind at street level (indicative)
            </label>
            {windOn && (
              <>
                <div className="layer-controls">
                  <label>
                    Wind from
                    <select value={windFrom} onChange={(e) => setWindFrom(e.target.value)}>
                      {WIND_DIRS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="note">
                  Streaks: <Swatch color={WIND_CALM} />calm <Swatch color={WIND_NORMAL} />as in the open{' '}
                  <Swatch color={WIND_STRONG} />stronger
                </p>
                {windDiff && (
                  <p>
                    <Swatch color={WINDIER_COLOR} />Windier after growth: about {fmt(round100(windDiff.windier))} m²
                    <br />
                    <Swatch color={CALMER_COLOR} />Calmer after growth: about {fmt(round100(windDiff.calmer))} m²
                  </p>
                )}
              </>
            )}
          </section>

          <div className="method">
            <p>
              Each building's distance is measured from the centre to the middle of its footprint. The gain is the
              number of storeys at the centre times the gradient, rounded to whole storeys of {STOREY_M} m each.
              "Even" falls off in a straight line, "Soft edge" keeps a plateau near the centre, "Sharp peak"
              concentrates growth on the closest buildings.
            </p>
            <p>
              New floor area is each raised building's footprint times its added storeys. It is a rough sketch of
              density, not a planning calculation: it ignores setbacks, structure, daylight and building rules.
            </p>
            <p>
              Shadows follow the sun over Weimar on the chosen day and clock time. New shadow is ground in shade after
              the growth that was not in shade before; shade falling on roofs and walls is not counted.
            </p>
            <p>
              The wind layer is a sketch from rules of thumb, not a wind simulation. Air flows around the footprints;
              closed courtyards stay calm; each building shelters about four times its height downwind; a building
              much taller than its neighbours speeds up the wind at its corners. Use it to see where to look closer,
              not to judge comfort or safety.
            </p>
            <p>
              New shadow and wind are worked out on flat ground: they ignore the simulated terrain.
            </p>
          </div>
        </aside>
      ) : (
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
      )}

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
        {terrain && (
          <p className="note terrain-note">
            Ground heights are simulated, not measured: the kit has none. Lowest along the river plots
            ({Math.round(terrain.min)} m above sea level), rising to {Math.round(terrain.max)} m away from them.
          </p>
        )}
      </aside>

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
