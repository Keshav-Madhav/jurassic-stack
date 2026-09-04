// THE HAND-DRAWN CONTROL GEOMETRY OF THE ISLAND — one file, every vertex a
// decision. The coastline, the river, the lakes, the ranges' crests and the
// forests are traced here; nothing is a center+radius+noise formula and
// nothing is generated. Story: PLAN.md → "The island v2 — the Lasso".
//
// Read by tools/bake-island.mjs (carves + bakes it) and tools/map.mjs (draws
// the planning map you trace against). Coordinates are world metres on the
// 4×4 km canvas (x, z ∈ [-2048, 2048]): x east, z south (north is -z).
// Polygons are [x, z] pairs, any winding.

export const HALF = 2048
export const SPAWN = { x: 0, z: 1560 }
export const VOLCANO = { x: 0, z: -1250 }

// ---------- THE COAST: the island's outline ----------
// Clockwise from the spawn bay. The land inside is held up, the beach band
// eases to the shore just inside this line, the sea floor falls away outside.
// Ranges are added after the beach easing, so where a range meets this line
// it meets it as cliffs.
export const COAST = [
  // THE SPAWN BAY — a wide south-facing crescent between two headlands
  [0, 1620], [180, 1625], [340, 1640], [470, 1670], [600, 1700], // → East Head
  // round East Head into the Estuary Bay, where the outflow deltas
  [680, 1660], [720, 1580], [760, 1500], [820, 1440], [920, 1400], [1040, 1360],
  [1120, 1330], [1220, 1290], [1300, 1300], [1380, 1360], [1470, 1420],
  [1560, 1440], // THE SPIT's tip
  [1600, 1380], [1560, 1300], [1500, 1200], [1480, 1080],
  // the east coast under the East Range, out to East Cape
  [1540, 940], [1600, 800], [1650, 660], [1700, 520], [1740, 380], [1720, 240],
  [1660, 140], [1640, 20], [1660, -120], [1620, -280], [1600, -440], [1580, -580],
  [1540, -720], [1560, -880], [1540, -1000], [1500, -1100],
  // the north-east: the Wellspring's cove, a notch where the gorge meets the sea
  [1440, -1180], [1330, -1250], [1250, -1300], [1195, -1265], [1150, -1330], [1080, -1400],
  // the north coast, the volcano's long north flank falling to the sea
  [940, -1490], [780, -1560], [600, -1630], [400, -1700], [200, -1740], [20, -1760],
  [-160, -1750], [-340, -1720], [-520, -1680], [-680, -1620], [-800, -1540],
  // THE NORTH-WEST BIGHT — the coast recedes, then a cape
  [-900, -1450], [-1010, -1380], [-1140, -1370], [-1280, -1300], [-1400, -1180],
  [-1480, -1040], [-1560, -880], [-1620, -720],
  // the west coast — range cliffs, with one fjord inlet
  [-1600, -560], [-1500, -480], [-1470, -380], [-1560, -300], [-1640, -200],
  [-1680, -40], [-1700, 120], [-1680, 300], [-1700, 460], [-1660, 620], [-1620, 780],
  [-1560, 940], [-1500, 1060],
  // DUNE BAY — the desert's wide low coast, receding, then out to West Head
  [-1400, 1160], [-1280, 1200], [-1160, 1260], [-1080, 1360], [-1000, 1460],
  [-880, 1540], [-740, 1620], [-640, 1720], // West Head
  [-520, 1690], [-400, 1650], [-260, 1620], [-120, 1610],
]

// ---------- THE RANGES: crest paths, a height at every vertex ----------
// The bake raises a massif around each crest and a sharp ridge on it; the
// vertex heights ARE the skyline — dips are the passes. `width` is the
// massif's half-width in metres.
export const RANGES = [
  {
    // WEST RANGE — long, north–south, the island's spine on the west; kinked
    // crest with spurs; the Alpine Tarn sits in its high saddle (M10b)
    name: 'west', width: 300,
    crest: [
      { x: -1400, z: -940, h: 140 }, { x: -1440, z: -760, h: 290 }, { x: -1360, z: -600, h: 380 },
      { x: -1320, z: -440, h: 340 }, { x: -1370, z: -300, h: 330 }, // the Tarn's saddle
      { x: -1290, z: -160, h: 420 }, { x: -1330, z: -20, h: 370 }, { x: -1250, z: 100, h: 395 },
      { x: -1200, z: 240, h: 270 }, // the pass to the west coast
      { x: -1240, z: 380, h: 340 }, { x: -1180, z: 520, h: 350 }, { x: -1120, z: 660, h: 240 },
      { x: -1080, z: 800, h: 130 },
    ],
  },
  {
    // EAST RANGE — the north-east quadrant's wall, inland of the east coast.
    // Its northern foot is the coastal bluff the Wellspring gorge is cut into.
    name: 'east', width: 260,
    crest: [
      { x: 1215, z: -1290, h: 100 }, // the Wellspring Bluff: the sea cliff the gorge is cut through
      { x: 1180, z: -1100, h: 130 }, { x: 1220, z: -960, h: 250 }, { x: 1200, z: -820, h: 300 },
      { x: 1290, z: -700, h: 340 }, { x: 1250, z: -560, h: 290 }, { x: 1320, z: -440, h: 350 },
      { x: 1300, z: -300, h: 320 }, { x: 1370, z: -170, h: 330 }, { x: 1330, z: -40, h: 280 },
      { x: 1360, z: 100, h: 230 }, { x: 1300, z: 250, h: 160 },
    ],
  },
]

// ---------- THE HOLM: the plateau the ring is cut into ----------
// Land inside this line is held at ~20 m so the ring, the Reservoir and the
// Knot all sit IN ground (a carve, never a raised donut).
export const HOLM = [
  [-560, 380], [-520, 160], [-400, -30], [-200, -130], [40, -150], [260, -80],
  [420, 80], [520, 260], [520, 470], [430, 660], [240, 800], [0, 850],
  [-240, 810], [-430, 690], [-540, 540],
]

// ---------- THE LASSO: one river, three parts ----------
// `flow` 1 = current runs source→end along the path; 0 = dead water at
// `level`. Bed profiles: legs are monotonic downhill, the ring is level.
export const RIVER = {
  knot: { x: 310, z: 380 },
  level: 14, // the Knot's water surface: the ring and the Reservoir sit here
  parts: [
    {
      // INFLOW — out of the Wellspring pool in its coastal gorge at the East
      // Range's northern foot, then south down the long valley between the
      // north pines and the range, meandering across the flats to the Knot
      name: 'inflow', flow: 1, halfWidth: 11, canyon: [0.02, 0.36],
      path: [
        { x: 1100, z: -1195 }, { x: 1068, z: -1130 }, { x: 1010, z: -1090 }, { x: 980, z: -990 },
        { x: 920, z: -900 }, { x: 900, z: -790 }, { x: 840, z: -700 }, { x: 800, z: -600 },
        { x: 760, z: -520 }, { x: 700, z: -440 }, { x: 690, z: -350 }, { x: 630, z: -280 },
        { x: 600, z: -190 }, { x: 540, z: -110 }, { x: 520, z: -20 }, { x: 470, z: 60 },
        { x: 450, z: 150 }, { x: 410, z: 230 }, { x: 370, z: 300 }, { x: 310, z: 380 },
      ],
    },
    {
      // THE RING — dead water round the Holm, back to the Knot. Closed path,
      // egg-shaped; the Ford is the shallow bar on its far west side.
      name: 'ring', flow: 0, halfWidth: 17, closed: true,
      path: [
        { x: 310, z: 380 }, { x: 300, z: 270 }, { x: 262, z: 165 }, { x: 190, z: 85 },
        { x: 90, z: 30 }, { x: -40, z: 5 }, { x: -180, z: 20 }, { x: -300, z: 80 },
        { x: -390, z: 175 }, { x: -445, z: 330 }, // the Ford
        { x: -435, z: 440 }, { x: -380, z: 560 }, { x: -280, z: 660 }, { x: -140, z: 720 },
        { x: 10, z: 730 }, { x: 150, z: 690 }, { x: 250, z: 610 }, { x: 300, z: 500 },
      ],
      ford: { x: -445, z: 330 },
    },
    {
      // OUTFLOW — from the Knot south-east in S-bends through the swamp's
      // delta to the Estuary Bay
      name: 'outflow', flow: 1, halfWidth: 12,
      path: [
        { x: 310, z: 380 }, { x: 345, z: 440 }, { x: 410, z: 480 }, { x: 450, z: 560 },
        { x: 520, z: 610 }, { x: 560, z: 690 }, { x: 640, z: 730 }, { x: 700, z: 810 },
        { x: 730, z: 900 }, { x: 800, z: 960 }, { x: 880, z: 1000 }, { x: 930, z: 1080 },
        { x: 1010, z: 1120 }, { x: 1050, z: 1210 }, { x: 1120, z: 1260 }, { x: 1160, z: 1330 },
        { x: 1200, z: 1400 },
      ],
    },
  ],
}

// ---------- STANDING WATER: traced shorelines ----------
// The Reservoir and the Wellspring are part of the river's story; the two
// lakes come in M10b. `level` is asserted by the bake validator; `deep` is the
// hand-picked deepest spot; `depth` the max carve below the surface.
export const LAKES = [
  {
    // THE RESERVOIR — the deep basin where the river crosses itself; four
    // arms of water meet here
    name: 'reservoir', level: RIVER.level, depth: 11, deep: { x: 310, z: 380 },
    shore: [
      [235, 330], [275, 300], [330, 300], [385, 325], [405, 375],
      [390, 430], [345, 462], [285, 458], [240, 425], [222, 378],
    ],
  },
  {
    // THE WELLSPRING — the source pool at the head of the gorge; the river
    // pours out of the sea cliffs here
    name: 'wellspring', level: 38, depth: 6, deep: { x: 1110, z: -1215 },
    shore: [
      [1075, -1203], [1092, -1238], [1125, -1251], [1152, -1231], [1148, -1199],
      [1122, -1175], [1088, -1179],
    ],
  },
]

// ---------- FORESTS: traced woodland regions ----------
// kind: 'broadleaf' (wide-canopy woods) · 'pine' (highland conifers) ·
// 'mixed' · 'redwood' (the Holm only, M10d). Rough first pass for M10a so
// the woods don't vanish for a round; retraced properly in M10d.
export const FORESTS = [
  {
    // THE SOUTHWOOD — first forest, a meadow north of the spawn beach
    name: 'southwood', kind: 'broadleaf', density: 0.85, edge: 50,
    shore: [
      [-500, 1440], [-450, 1330], [-340, 1250], [-180, 1200], [40, 1180], [280, 1200],
      [480, 1270], [620, 1370], [630, 1450], [520, 1500], [300, 1480], [60, 1470], [-160, 1480], [-370, 1500],
    ],
  },
  {
    // THE HOLM WOOD — inside the ring (redwoods from M10d)
    name: 'holm', kind: 'broadleaf', density: 1, edge: 40,
    shore: [
      [-360, 200], [-240, 90], [-60, 60], [120, 100], [230, 220], [250, 380],
      [200, 530], [60, 640], [-120, 660], [-290, 580], [-380, 420], [-395, 300],
    ],
  },
  {
    // THE NORTH PINES, WEST — conifers on the northern rise, west of the
    // volcano's south approach (the approach itself stays open so the caldera
    // gate reads from far off)
    name: 'north-pines-west', kind: 'pine', density: 0.8, edge: 50,
    shore: [
      [-700, -420], [-560, -640], [-340, -780], [-250, -760], [-230, -560],
      [-260, -330], [-380, -170], [-620, -240],
    ],
  },
  {
    // THE NORTH PINES, EAST — the other half, running to the inflow valley
    name: 'north-pines-east', kind: 'pine', density: 0.8, edge: 50,
    shore: [
      [250, -760], [440, -700], [560, -520], [520, -320], [380, -200],
      [260, -260], [240, -500],
    ],
  },
]

// ---------- RUINS: hand-placed sites on the arc's spawn→summit gradient ----------
// The bake asserts each is flat, dry, open and off the river; the navmesh
// bake asserts a path from spawn. (Glades for the ones inside woods below.)
export const RUINS = [
  { tag: 'beach-statue', x: 180, z: 1500 }, // the spawn beach's east end, pointing inland
  { tag: 'coast-shrine', x: 560, z: 1480 }, // the root of East Head, looking over the Estuary Bay
  { tag: 'forest-temple', x: -80, z: 380 }, // the Holm glade, heart of the ring
  { tag: 'highland-arch', x: 850, z: -250 }, // the open rise between the inflow and the East Range
  { tag: 'foothill-vault', x: -820, z: -420 }, // the highland shelf under the West Range
  { tag: 'caldera-gate', x: 0, z: -690 }, // the volcano's south foot, on the open approach
]

export const CLEARINGS = [
  // the Holm glade — the temple's clearing at the heart of the ring
  [[-140, 340], [-100, 320], [-40, 325], [-10, 360], [-20, 410], [-60, 440], [-110, 435], [-145, 395]],
]

/** Signed distance to a traced polygon: negative inside. */
export function shoreDist(px, pz, shore) {
  let inside = false
  let minD = Infinity
  for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
    const [xi, zi] = shore[i]
    const [xj, zj] = shore[j]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
    const dx = xj - xi
    const dz = zj - zi
    const t = Math.max(0, Math.min(1, ((px - xi) * dx + (pz - zi) * dz) / (dx * dx + dz * dz)))
    minD = Math.min(minD, Math.hypot(px - (xi + dx * t), pz - (zi + dz * t)))
  }
  return inside ? -minD : minD
}

/** Distance from a point to a polyline of {x,z}; also segment index + local t. */
export function distToPath(px, pz, path) {
  let best = Infinity
  let bseg = 0
  let bt = 0
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].x, az = path[i].z
    const bx = path[i + 1].x, bz = path[i + 1].z
    const dx = bx - ax, dz = bz - az
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
    if (d < best) {
      best = d
      bseg = i
      bt = t
    }
  }
  return { d: best, seg: bseg, t: bt }
}

/** A closed part's path with the first point repeated, for carving/drawing. */
export function closedPath(part) {
  return part.closed ? [...part.path, part.path[0]] : part.path
}

/** Every river part as a plain polyline (closed ones wrapped). */
export const RIVER_PATHS = RIVER.parts.map(closedPath)
