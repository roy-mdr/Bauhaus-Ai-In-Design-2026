# Walking reach: Weimar

A 3D map of central Weimar that shows how far you can walk in 5, 10 and 15 minutes from any point, which buildings you reach, and about how many people live there.

## What it does

- Shows every building of the city kit in 3D, extruded from its footprint to its measured height, coloured by its main use (legend at the top right), with the pedestrian network drawn as thin lines.
- Click on the ground (or on a building) to start a walk. The app draws three nested areas in three shades of orange: dark for 5, middle for 10, light for 15 minutes. Buildings touching an area take its shade.
- The panel lists, for each of the three times, the number of buildings reached and about how many residents live in the area.
- Drag to orbit, right-drag to pan, scroll to zoom.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
npm run build   build the site into dist/, as GitHub Pages does
```

On GitHub, set Settings → Pages → Source to "GitHub Actions"; every push to `main` then publishes the app at `https://<user>.github.io/<repo>/`.

## Method

- **Walking speed:** 4.8 km/h, that is 80 m per minute, so 400, 800 and 1200 m for 5, 10 and 15 minutes.
- **Start:** the network node nearest to the click. If no walkable street is within 100 m of the click, the app says so and draws nothing.
- **Walking:** the shortest walking distance from the start to every node along the walkable edges of `streets.graph.json`, using each edge's `length` in metres. Edges can be walked both ways.
- **Areas:** the street segments reached in the time, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. It follows the streets: it is not a circle and not a convex hull, and it has holes where blocks are not reached.
- **Buildings:** a building counts when its footprint touches the area, that is when it lies within 25 m of a reached piece of street. A building touching the 5-minute area also counts for 10 and 15 minutes.
- **Residents:** from the Zensus 2022 grid of 100 m cells. For every cell that overlaps the area, its population times the share of the cell's area that lies inside the area. These are added up and rounded to the nearest 10.
- **Cells without a figure:** some cells have no published population (`null`). They are not zero: they are left out of the sum, and the panel shows next to it how many such cells overlap the area.

## Limits

- The walk starts at a street node, not at the exact click point; the few metres from the click to the node are not counted.
- Every walker moves at the same steady speed: no waiting at crossings, no slopes, no stairs, no crowding.
- The network is a drawing for a walking simulation. Paths it does not contain, such as through courtyards or private ground, are not walked.
- The 25 m band is a stand-in for "close to the street"; it does not know where the entrances of buildings are.
- Residents are spread evenly over each 100 m cell, which is rarely true. The census also changes small counts slightly at random to protect privacy, so single cells are approximate. Treat the numbers as "about".
- The kit covers only part of Weimar. Areas near its edge are cut off by the end of the network, and residents outside the kit's census cells are not counted.

## Data sources

All data is in `public/data/`; see `public/data/SOURCES.md`.

| Data | Source | Licence |
| --- | --- | --- |
| Building footprints and heights | 3D building models LoD2 of Thuringia, © GDI-Th; uses added by Egor Gaydukov | dl-de/by-2-0 |
| Pedestrian network | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Census grid | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the data and `SOURCES.md`, then wrote the 3D city, the walking and resident calculation, the panel and this README, and checked the page in a headless browser.
4. I checked:
