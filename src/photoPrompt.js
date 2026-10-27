import { FOCAL_MM } from "./photo.js";

// The description sent to Replicate with a photo-mode view: where the citizen stands, what is
// around them, where the sun is, and the look (solarpunk Weimar in the Frutiger Aero style,
// lens flares, and a natural landscape at the horizon in every picture).

const PLACES = {
  ground: "standing on open ground in the city",
  street: "standing on a street",
  bridge:
    "standing on a glass skybridge with a planted deck, high between two towers",
  spireFloor:
    "standing on the planted balcony of an organic garden-spire tower, between its hanging gardens",
  spireTerrace:
    "standing on a cantilevered garden terrace with small trees, on the side of a garden-spire tower",
  spireRoof:
    "standing in the roof garden on top of a garden-spire tower, under its crown of solar leaves",
  hillTerrace:
    "standing on a lawn terrace of a stepped glass tower whose every level is a garden",
  crown:
    "standing in a roof garden on new green storeys built on top of a historic building",
  platform: "standing on a sky-tram platform on the side of a tall tower",
};

const SOLARPUNK = `This is Weimar in a hopeful solarpunk future, where new architecture lives in a healthy relation with nature and the historic town:
- organic garden-spire towers of round white floor plates that swell and sway, with sea-green glass between them, a hedge on every floor, hanging gardens, cantilevered tree terraces and a crown of tilted solar-panel "leaves";
- stepped glass towers that turn as they rise, every level a lawn with trees;
- glass skybridges with planted decks linking the towers, with people walking across;
- a sky tram: white capsule pods running on a slender white rail with a glowing aqua guide line, high between the towers;
- small white air taxis with four rotors, and a white solar airship with deep-blue solar cells on its back;
- the historic town houses are kept: pale plastered facades with climbing plants, roof gardens and solar panels on their roofs, some with new terraced green storeys on top;
- streets of light natural stone with "solar trees" (slim poles carrying tilted solar panels), meadows with wildflowers, many trees, and lots of people walking, cycling, sitting and enjoying the public space.`;

const TODAY = `This is the historic town of Weimar, Germany: two- to four-storey town houses with plastered facades and steep pitched roofs of red clay tiles, a few larger civic buildings, narrow streets of stone paving and some trees.`;

const STYLE = `Mood: the "Frutiger Aero" optimism of the 2000s, but only in the light and the colours, never as a cartoon or computer-graphics look: clean, bright, slightly saturated colours; aqua and sea-green glass; lush vivid greens; a deep clear blue sky with a few soft white clouds; warm low afternoon sunlight; crisp, fresh air; everything new, clean and hopeful.`;

const REALISM = `It must be a REAL PHOTOGRAPH, as if taken in Weimar on a real day: photorealistic, indistinguishable from a real photo. Not a 3D render, not CGI, not an illustration, not a video game, not a toy model. Natural daylight with real shadows and bounce light, real depth, slight atmospheric haze in the distance, real reflections, fine detail everywhere.

Make every building look really built:
- historic houses: real lime plaster with texture and slight weathering, window frames, sills and reflections in the glass, real red clay roof tiles, gutters and chimneys;
- new towers and bridges: real architecture of concrete or steel floor slabs, glass facades with mullions and reflections, real railings, real planters with soil;
- real stone paving, real lawns and meadows with individual blades of grass.

Vegetation: all the green balls, blobs, rings and cones on and around the buildings, towers, balconies, terraces, roofs and bridges are VEGETATION growing there: real shrubs, hanging plants spilling over the edges, climbing plants, planters full of plants and small trees, all with real leaves. On the round towers, every green ball along a floor is a leafy shrub or small tree in a planter at the floor's edge, with ivy and trailing plants hanging down over the slab below; the green rings are planted hedges along the balustrades. Green balls and cones on brown trunks on the ground are real trees, deciduous and conifers, with natural irregular crowns.
IMPORTANT: there must be NO smooth green spheres, balls, blobs or cones anywhere in the photo. Replace every one of them with real, irregular, leafy plants.`;

function sunText(sun) {
  if (sun.inFrame)
    return `The low afternoon sun is in the frame${sun.where ? `, ${sun.where}` : ""}: render it as a bright sun with a classic 2000s lens flare: a soft warm halo, a few hexagonal aperture ghosts and a thin ring in aqua, green, pink and gold, spread in a line across the picture through its centre.`;
  if (sun.ahead)
    return `The low afternoon sun is just outside the frame, ${sun.side}: let warm sunlight flare in from that edge, with a soft lens flare of a few hexagonal ghosts in aqua, green and pink, like a 2000s photograph.`;
  return `The low afternoon sun is behind the camera, lighting the scene warmly from the front. Still add a clearly visible 2000s lens flare: warm sunlight streaming in from one upper corner, with a soft halo and a short line of hexagonal ghosts in aqua, green and pink across the sky.`;
}

// view: { on, standing (metres above the ground), pitch (degrees, + up), sun: { inFrame, where, ahead, side }, district: 'inside' | 'near' | 'none' }
export function photoPrompt(view) {
  const height =
    view.standing > 3
      ? ` about ${Math.round(view.standing)} m above the street`
      : "";
  const looking =
    view.pitch > 20
      ? "looking up"
      : view.pitch < -20
        ? "looking down over the city"
        : "looking ahead";
  const scene =
    view.district === "inside"
      ? SOLARPUNK
      : view.district === "near"
        ? `${TODAY}\nBeyond it, towers of a new solarpunk district rise.\n${SOLARPUNK}`
        : TODAY;

  return `Turn this simple 3D model view into a real photograph taken by a person ${PLACES[view.on] ?? PLACES.street}${height}, ${looking}, with a ${FOCAL_MM} mm wide-angle lens.

${REALISM}

Keep the camera position, the framing, the perspective and every building, tower, bridge, tree, vehicle and person where they are; do not add, remove or move buildings. Small coloured capsules are real people, dressed for a warm day. Large flat dark green shapes at the edge of the frame are the branches and leaves of a tree right beside the camera: render them as real, slightly out-of-focus foliage.

${scene}

The pastel colours of the buildings in the model are only a colour code: render buildings in natural materials (warm white, cream and ochre plaster, red clay tiles, glass, light stone), with the solarpunk structures in white, sea-green glass and green.

${STYLE}

${sunText(view.sun)}

Horizon: wherever the flat green ground, the pale haze or the edge of the model meet the sky, replace them with a natural landscape: the rolling green hills of Thuringia with forests, meadows and fields, fading into blue wooded hills in the distance under the clear sky. The city sits in this landscape; there is no round platform, glass rim or floating disc.

Do not show any camera interface, text, numbers, date stamp, grid or frame. Fill the whole rectangle edge to edge: no dark vignette, no black or rounded corners, no fisheye circle. Shot on a real camera: sharp, high detail, natural perspective with the slight distortion of a wide-angle lens, true-to-life colours and textures. Photorealistic.
`;
}
