// Quiet colours for the main use of each building, in the order of the legend.
// No oranges here: orange is kept for the walking areas.
export const USES = [
  { use: 'residential', label: 'Residential', color: '#ddd7c9' },
  { use: 'service', label: 'Service', color: '#9fb3c8' },
  { use: 'office', label: 'Office', color: '#7f97b2' },
  { use: 'retail', label: 'Retail', color: '#b7a3cc' },
  { use: 'food_and_drink', label: 'Food and drink', color: '#cfb0cf' },
  { use: 'accommodation', label: 'Accommodation', color: '#a6c3c0' },
  { use: 'entertainment', label: 'Entertainment', color: '#86ae9d' },
  { use: 'culture', label: 'Culture', color: '#a9bf8f' },
  { use: 'education', label: 'Education', color: '#cdd198' },
  { use: 'health', label: 'Health', color: '#a3cbe0' },
  { use: 'civic', label: 'Civic', color: '#8a9ba1' },
  { use: 'sport', label: 'Sport', color: '#bcd6ae' },
  { use: 'transport', label: 'Transport', color: '#a3a3bd' },
  { use: 'light_industrial', label: 'Light industrial', color: '#8c8577' },
  { use: 'undefined', label: 'Use not known', color: '#b9b9b5' },
]

const byUse = Object.fromEntries(USES.map((u) => [u.use, u.color]))

// The one building without a use goes with "use not known".
export const colorForUse = (use) => byUse[use] ?? byUse.undefined

const labels = Object.fromEntries(USES.map((u) => [u.use, u.label]))
export const labelForUse = (use) => labels[use] ?? labels.undefined

// One accent colour in three shades: darkest for 5 minutes, lightest for 15.
export const REACH_COLORS = ['#b8431c', '#e2804f', '#f4bf9f']

export const GROUND_COLOR = '#efede6'
export const STREET_COLOR = '#8e8b83'
