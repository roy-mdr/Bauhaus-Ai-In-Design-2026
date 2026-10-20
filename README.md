# A* route walk: Weimar

A 3D map of central Weimar. Pick an origin and a destination, watch the A* search algorithm find the shortest walking route through the street network, then walk the route in first person.

## What it does

- Shows every building of the city kit in 3D, extruded from its footprint to its measured height, coloured by its main use (legend at the top right), with the pedestrian network drawn as thin lines.
- Parks are drawn on green ground and filled with trees made of point clouds, a trunk and a leafy crown each, so you can tell a park from above and when you pass through one in the walkthrough.
- A banner at the top of the map shows the four steps (origin, destination, A* search, walkthrough), marks the current one, and says what to do next.
- Click on the map to set the origin, then click again to set the destination. Each gets a large glowing sphere on a pillar with its name above it (green for the origin, yellow for the destination), and the buildings around the click light up in the same colour, closest first. If the nearest street corner is away from the click, a small dot and a line join the two; the panel says how far it is.
- The city fades to night and the camera moves in to frame both points. The search is then replayed step by step: streets flash white and cool to blue as A* walks along them, white dots mark the frontier (the nodes waiting to be looked at), and a ring bursts outwards each time a node is settled.
- When the destination is reached, the shortest route is drawn from origin to destination in a green-to-yellow gradient, with light pulses running along it.
- The camera then flies down to eye height and walks the route in first person, then rises again to show the whole route. "Skip to the end" ends the walk early; "Walk again" repeats it; "New route" starts over. A click on the map after the walk also starts a new route.
- The panel shows the route length, the walking time, and how many street nodes A* looked at compared with Dijkstra's search for the same route.
- Drag to orbit, right-drag to pan, scroll to zoom.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
npm run build   build the site into dist/, as GitHub Pages does
```

On GitHub, set Settings → Pages → Source to "GitHub Actions"; every push to `main` then publishes the app at `https://<user>.github.io/<repo>/`.

## Method

- **Network:** the walkable edges of `streets.graph.json`, each with its `length` in metres. Edges can be walked both ways.
- **Origin and destination:** the network nodes nearest to the two clicks. If no walkable street is within 100 m of a click, the app says so and sets nothing.
- **A\*:** from the origin, the search keeps a frontier of nodes it could look at next. It always takes the one with the smallest "distance walked so far + straight-line distance still to the destination", so it reaches towards the destination instead of spreading in all directions. The straight line is never longer than the real walk, so the route found is the shortest along the network.
- **Comparison:** the app also runs Dijkstra's search, which ignores the straight-line distance, and shows how many nodes it would have looked at for the same route.
- **Walking time:** route length at 4.8 km/h, that is 80 m per minute.
- **Walkthrough:** a smooth camera glide, no walking motion, at 40 m per second, about thirty times walking pace, with the eye 1.7 m above the ground. Corners are rounded off slightly, and the camera turns smoothly towards a point 30 m ahead.

## Limits

- The route starts and ends at street nodes, not at the exact click points; the few metres from a click to its node are not counted.
- The walk is on flat ground at a steady speed: no waiting at crossings, no slopes, no stairs.
- The network is a drawing for a walking simulation. Paths it does not contain, such as through courtyards or private ground, are not used.
- Buildings in the walkthrough are simple blocks with flat roofs at their highest point; roofs, façades and trees are not modelled.
- The kit covers only part of Weimar. Routes can only use the network inside it.
- The census grid in `public/data/` is loaded but not used by this version.
- The trees are an illustration, not data: the kit has no trees. They are scattered over the plots with the land use `recreation` in `plots.geojson`, about one every 9 m, at least 3.5 m from the walking network and 2 m from buildings, with random heights of 8 to 18 m. Trees in streets, courtyards and cemeteries are not drawn.

## Data sources

All data is in `public/data/`; see `public/data/SOURCES.md`.

| Data | Source | Licence |
| --- | --- | --- |
| Building footprints and heights | 3D building models LoD2 of Thuringia, © GDI-Th; uses added by Egor Gaydukov | dl-de/by-2-0 |
| Pedestrian network | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Land use per plot (parks) | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Census grid | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the data and `SOURCES.md`, then wrote the 3D city, the walking and resident calculation, the panel and this README, and checked the page in a headless browser. Later it replaced the walking areas with the A* search replay and the first-person walk.
4. I checked:
