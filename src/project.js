// Turns longitude/latitude into metres east (x) and north (y) of the kit centre.
// Over an area of 2 km this flat projection is off by far less than a metre.
const EARTH_RADIUS_M = 6371008.8

export function makeProjection([lon0, lat0]) {
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M
  const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180)
  return ([lon, lat]) => [(lon - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat]
}
