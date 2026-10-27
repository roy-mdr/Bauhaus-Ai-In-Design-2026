// Fresh, glossy "Frutiger Aero" colours for the main use of each building, in the order of the
// legend: pearl white for homes, then aquas, blues, limes and lilacs.
// No oranges here: orange is kept for the walking areas.
export const USES = [
  { use: 'residential', label: 'Residential', color: '#eef2f4' },
  { use: 'service', label: 'Service', color: '#86c9f2' },
  { use: 'office', label: 'Office', color: '#4a94d8' },
  { use: 'retail', label: 'Retail', color: '#c3a2ef' },
  { use: 'food_and_drink', label: 'Food and drink', color: '#f2a6d4' },
  { use: 'accommodation', label: 'Accommodation', color: '#63d5c8' },
  { use: 'entertainment', label: 'Entertainment', color: '#2fb796' },
  { use: 'culture', label: 'Culture', color: '#9fd65e' },
  { use: 'education', label: 'Education', color: '#dce95e' },
  { use: 'health', label: 'Health', color: '#9be6ff' },
  { use: 'civic', label: 'Civic', color: '#7491ab' },
  { use: 'sport', label: 'Sport', color: '#bdf08f' },
  { use: 'transport', label: 'Transport', color: '#a3acff' },
  { use: 'light_industrial', label: 'Light industrial', color: '#a69a8e' },
  { use: 'undefined', label: 'Use not known', color: '#c8d3db' },
]

const byUse = Object.fromEntries(USES.map((u) => [u.use, u.color]))

// The one building without a use goes with "use not known".
export const colorForUse = (use) => byUse[use] ?? byUse.undefined

const labels = Object.fromEntries(USES.map((u) => [u.use, u.label]))
export const labelForUse = (use) => labels[use] ?? labels.undefined

// One accent colour in three shades: darkest for 5 minutes, lightest for 15.
export const REACH_COLORS = ['#b8431c', '#e2804f', '#f4bf9f']

export const GROUND_COLOR = '#eaf6f8'
export const STREET_COLOR = '#7fb2c8'

// The sky and the glass of the Frutiger Aero look.
export const AERO = {
  zenith: '#1677d2',
  sky: '#7fd0ff',
  horizon: '#effcff',
  sun: '#fff4d6',
  meadow: '#bfe88f',
  grass: '#6cc04a',
  deepGrass: '#2f8a34',
  haze: '#dcf3ff',
  glass: '#7fd8f5',
}

// The solarpunk districts: warm white structure, sea-green glass, deep blue solar panels and many greens.
export const SOLARPUNK = {
  slab: '#f3efe4',
  struct: '#ece9df',
  glass: '#8fd0d6',
  panel: '#1f3563',
  lawn: '#7fb35b',
  trunk: '#6d5340',
  conifer: '#2f6a45',
  leaves: ['#4f8f3a', '#6aa84f', '#3f7a3a', '#8bbf5a', '#5d9a48'],
  blossom: ['#f2a7c3', '#f6d26b', '#e98b9a'],
  people: ['#d9534f', '#f0ad4e', '#5bc0de', '#3b5998', '#f7f7f2', '#7a4f9a', '#2e8b57', '#333333', '#e07b39'],
  rail: '#f4f3ee',
  glow: '#5fe8d2',
  pod: '#fbfbf8',
  airship: '#f6f4ec',
}
