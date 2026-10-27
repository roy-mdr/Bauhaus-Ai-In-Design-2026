# Solarpunk Weimar and walking reach

A 3D map of central Weimar with two tools. **Solarpunk**: click anywhere and today's city grows into a speculative solarpunk district around that point. **Walking reach**: click to see how far you can walk in 5, 10 and 15 minutes, which buildings you reach, and about how many people live there.

## What it does

- Shows every building of the city kit in 3D, from its footprint and measured height, coloured by its main use (legend at the top right), with the pedestrian network drawn as thin lines. Windows, floor lines and a darker plinth are drawn on every facade; narrow, nearly rectangular buildings get a gable roof.
- The look is "Frutiger Aero", the glossy optimism of the 2000s: the city stands on a round disc with a glass rim, under a dome that runs from grass green below the horizon to blue sky above, with a low sun in the west-south-west and its lens flares; buildings are glossy with aqua window glass, and the panels are frosted glass with aqua buttons.
- The tabs at the top of the panel choose what a click does.

### Solarpunk

- Click on the ground or a building: a district grows out from that point to the radius set with the slider (120 to 420 m), over 7 seconds, with a soft edge. Click elsewhere to grow more districts (up to 8); "Reset the city" removes them.
- Inside a district, today's buildings stay and change: flat roofs become gardens and solar fields, south-facing pitched roofs carry solar panels, plants climb the walls, and some flat-roofed buildings grow up to three terraced green storeys.
- On open ground rise new buildings, highest near the centre: garden spires (round floor plates that swell and sway, a hedge on every floor, hanging gardens, cantilevered terraces with trees and a crown of solar "leaves") and terraced hills (glass storeys that shrink and turn as they rise, each roof a garden).
- Glass skybridges with planted decks join neighbouring towers, and people walk across them.
- A sky tram runs on a loop between platforms on the tallest towers; air taxis circle above and a solar airship drifts around the district.
- The ground turns into meadow with flowers and trees, the streets get solar trees, people walk the streets and turn at junctions, and small groups rest on the meadows.
- The panel lists, for each district, how many towers, skybridges, crowned buildings, trees, solar trees and people it has.

### Photo mode

- Click a spot in the city to stand there as a citizen: the camera flies down to eye height (1.65 m) and widens to a 15 mm lens on a full-frame sensor (about 99° across). If you click inside a building, you stand on the nearest point of a street instead.
- The view shows the screen of a 2000s compact digital camera: frame corners, a grid of thirds, green focus brackets, mode, image size and shots left, flash, white balance, battery, an exposure scale, shutter speed, aperture, ISO, focal length and an orange date stamp.
- In a grown solarpunk district you can also stand up high: click a skybridge deck, a spire's floor, terrace or roof garden, a terraced tower's garden level, a new green storey on an old building, or a sky-tram platform (from above or below), and you stand on it at eye height. If the spot is right next to a tree or hanging garden, you are moved a step away so it doesn't fill the picture. The camera screen shows your eye height above the ground.
- Drag to look around; click another spot to walk there; "Back to map" flies back up to where you were.
- The round shutter button takes a photo: the camera flashes, the app captures the 3D view (without the camera screen) and writes a description of it: where you stand and how high, whether you are inside a solarpunk district, which way you look, and where the sun is. Google's Nano Banana on Replicate turns the view into a realistic photograph of solarpunk Weimar in the Frutiger Aero style, always with a 2000s lens flare (through the sun when it is in the frame, from the edge or a corner when it is not) and a natural landscape of wooded Thuringian hills at the horizon. The photo appears in the app with a Download button; it usually takes 10 to 30 seconds.
- **Taking photos only works locally** (`npm run dev`). The page sends the view and the description to the dev server on your laptop (`scripts/replicate.mjs`), which reads `REPLICATE_API_TOKEN` from `.env` and talks to Replicate; the key never goes into the page or the build. Put `REPLICATE_API_TOKEN=...` in `.env` at the root of the repository (it is git-ignored). On GitHub Pages there is no such server, so the shutter explains that instead. Each photo is one paid Replicate prediction.
- The AI keeps the view and its mood but redraws details: towers, trees and people may move or change a little from the model.

### Walking reach

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

A one-minute demo video is published at `https://<user>.github.io/<repo>/demo/` (locally `http://localhost:5173/demo/`). The page is `demo/index.html`; the video is `public/demo.mov` (H.264, 1920 × 1080).

## Method

- **Walking speed:** 4.8 km/h, that is 80 m per minute, so 400, 800 and 1200 m for 5, 10 and 15 minutes.
- **Start:** the network node nearest to the click. If no walkable street is within 100 m of the click, the app says so and draws nothing.
- **Walking:** the shortest walking distance from the start to every node along the walkable edges of `streets.graph.json`, using each edge's `length` in metres. Edges can be walked both ways.
- **Areas:** the street segments reached in the time, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. It follows the streets: it is not a circle and not a convex hull, and it has holes where blocks are not reached.
- **Buildings:** a building counts when its footprint touches the area, that is when it lies within 25 m of a reached piece of street. A building touching the 5-minute area also counts for 10 and 15 minutes.
- **Residents:** from the Zensus 2022 grid of 100 m cells. For every cell that overlaps the area, its population times the share of the cell's area that lies inside the area. These are added up and rounded to the nearest 10.
- **Cells without a figure:** some cells have no published population (`null`). They are not zero: they are left out of the sum, and the panel shows next to it how many such cells overlap the area.

## How the solarpunk districts are placed

- **Towers:** on a grid of points every 11 m inside the radius, keep those at least 9 m from any building and 6 m from any street, and pick the most open ones, at least 55 m apart: at most the radius squared divided by 5,500, so 10 towers for 240 m. Where there is too little open ground, up to three towers grow out of the roofs of large flat-roofed buildings. Height falls from about 165 m at the centre to 55 m at the edge, with some variation.
- **Skybridges:** each tower links to its one or two nearest neighbours between 25 and 160 m away, at a random height between their bases and tops.
- **Trees, people, solar trees:** trees on a 7 m grid wherever there is no building, street or tower; solar trees every 34 m beside the streets; walkers spread over the streets by length.
- **Pitched roofs:** a building gets a gable roof when it has no courtyard, fills at least 82% of its smallest surrounding rectangle, is 5 to 18 m wide and at least 6 m high, and is not a transport, sport or light-industrial building. The roof rises at 42°, its ridge along the longer side, and ends at the building's measured height.
- The same click always grows the same district.

## Limits

- The walk starts at a street node, not at the exact click point; the few metres from the click to the node are not counted.
- Every walker moves at the same steady speed: no waiting at crossings, no slopes, no stairs, no crowding.
- The network is a drawing for a walking simulation. Paths it does not contain, such as through courtyards or private ground, are not walked.
- The 25 m band is a stand-in for "close to the street"; it does not know where the entrances of buildings are.
- Residents are spread evenly over each 100 m cell, which is rarely true. The census also changes small counts slightly at random to protect privacy, so single cells are approximate. Treat the numbers as "about".
- The kit covers only part of Weimar. Areas near its edge are cut off by the end of the network, and residents outside the kit's census cells are not counted.
- The solarpunk districts are a speculative picture, not a plan. Towers stand on ground the kit shows as free, not on real plots, and ignore ownership, heritage protection, structure and planning law. The gable roofs are a guess from the footprint's shape: the data has heights but no roof shapes, and windows are drawn as a pattern, not where real windows are.

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
3. The agent did: read the data and `SOURCES.md`, then wrote the 3D city, the walking and resident calculation, the panel and this README; later added detailed facades and gable roofs and the growing solarpunk districts, and checked the page in a headless browser.
4. I checked:
