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
    // crest with spurs; the Alpine Tarn sits in its high saddle
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
  {
    // THE NORTHERN HORNS — a third, smaller range on the north-west shoulder
    // between the Bight and the volcano's foot: two horns and a col
    name: 'horns', width: 200,
    crest: [
      { x: -1060, z: -1180, h: 90 }, { x: -920, z: -1280, h: 190 }, { x: -800, z: -1220, h: 230 },
      { x: -690, z: -1330, h: 150 }, { x: -560, z: -1420, h: 210 }, { x: -430, z: -1460, h: 120 },
    ],
  },
  // FOOTHILLS — soft rolling chains (no rock terraces, no snow): the ground
  // between the ranges and the tableland rises and falls instead of lying flat
  {
    name: 'west-foothills', width: 170, soft: true,
    crest: [
      { x: -1020, z: -900, h: 75 }, { x: -940, z: -760, h: 95 }, { x: -980, z: -600, h: 70 },
      { x: -900, z: -440, h: 88 }, { x: -930, z: -280, h: 60 }, { x: -860, z: -120, h: 80 },
    ],
  },
  {
    name: 'south-west-foothills', width: 160, soft: true,
    crest: [
      { x: -940, z: 620, h: 70 }, { x: -820, z: 720, h: 92 }, { x: -700, z: 860, h: 66 },
      { x: -600, z: 1000, h: 80 }, { x: -520, z: 1140, h: 55 },
    ],
  },
  {
    name: 'east-foothills', width: 180, soft: true,
    crest: [
      { x: 1000, z: -560, h: 80 }, { x: 960, z: -380, h: 105 }, { x: 1010, z: -200, h: 85 },
      { x: 960, z: -20, h: 98 }, { x: 1000, z: 160, h: 72 }, { x: 950, z: 330, h: 88 }, { x: 1000, z: 500, h: 60 },
    ],
  },
  {
    name: 'north-foothills', width: 170, soft: true,
    crest: [
      { x: 500, z: -1420, h: 70 }, { x: 640, z: -1300, h: 95 }, { x: 760, z: -1160, h: 78 },
      { x: 860, z: -1020, h: 92 }, { x: 900, z: -870, h: 65 },
    ],
  },
  {
    name: 'south-mounds', width: 130, soft: true,
    crest: [
      // low mounds on the south plains between the ring and the Southwood
      { x: 500, z: 800, h: 48 }, { x: 640, z: 940, h: 60 }, { x: 560, z: 1080, h: 44 },
    ],
  },
]

// ---------- THE HOLM: the plateau the ring is cut into ----------
// Land inside this line is held at ~20 m so the ring, the Reservoir and the
// Knot all sit IN ground (a carve, never a raised donut).
export const HOLM = [
  [-640, 400], [-620, 200], [-520, 20], [-380, -110], [-190, -200], [30, -220], [250, -170],
  [420, -60], [530, 120], [570, 330], [560, 520], [480, 700], [340, 850], [140, 930],
  [-80, 950], [-300, 900], [-480, 780], [-600, 600],
]

// ---------- SHELVES: hand-cut benches in the mountains ----------
// A traced polygon held at height `h` (feathered 40 m outward): the flat
// ground a range otherwise never offers — the Alpine Tarn's cirque bench.
export const SHELVES = [
  { name: 'tarn-bench', h: 232, edge: 40, shore: [[-1320, 300], [-1260, 268], [-1200, 300], [-1180, 360], [-1210, 420], [-1270, 442], [-1320, 402], [-1342, 350]] },
  // THE GATE PORTAL — cut INTO the volcano's south flank: a flat apron at the
  // foot of a 33 m rock face, the arch set against the face. From the
  // corridor the mountain has a door in it (user: "the gate isn't dug into
  // the volcano, it looks like any other ruin")
  { name: 'gate-apron', h: 71, edge: 70, shore: [[-48, -850], [48, -850], [52, -906], [-52, -906]] },
  { name: 'gate-wall', h: 104, edge: 12, shore: [[-80, -909], [80, -909], [80, -1010], [-80, -1010]] },
  // THE CRATER FLOOR — a 175 m bench sunk 100 m into the summit: the arc's
  // last room, walled by the cone's own rim, reached only by the Ravine
  { name: 'crater', h: 175, edge: 34, shore: [[-92, -1250], [-72, -1318], [-18, -1352], [46, -1340], [88, -1290], [92, -1224], [58, -1170], [0, -1150], [-58, -1170], [-90, -1206]] },
]

// ---------- THE CAVES: three dark places (PLAN beat 4) ----------
// A heightmap cannot have an overhang, so a cave here is a BOWL carved into a
// hillside with a stone roof laid over it (caves.ts builds the shell). That
// gives a real interior you walk down into: the terrain is the floor and the
// walls, the shell is the ceiling and the mouth's lintel, and M47's baked sky
// view darkens the inside for free — a deep bowl sees no sky.
//
// `mouth` is where you walk in, `into` is the compass direction of the hill
// behind it, and the chamber sits `reach` metres in. `mouthY` / `floorY` are
// HAND-AUTHORED absolute heights (metres): the bake composes its grid in one
// pass and cannot sample itself mid-pass, and a designed floor level is what
// the hand-geometry mandate wants anyway. `reach` must clear `radius + 22`
// (the chamber's outer blend) or the carve swallows its own mouth — the first
// cut dropped the dune mouth from 30 m to 17 (M51).
export const CAVES = [
  {
    name: 'dune-hollow',
    // low and early: the first dark place, a short walk from the west dunes
    mouth: { x: -670, z: 1090 }, into: { x: -0.55, z: -0.84 },
    reach: 62, radius: 26, mouthY: 30, floorY: 17, keystone: false,
  },
  {
    name: 'east-adit',
    // the east foothills at 122 m — the FIRST site here was down by the swamp
    // at (690, 970) and the bake's own outflow validator threw it out: the
    // chamber cut under the river's bed and made the water run uphill (M51)
    mouth: { x: 1410, z: 50 }, into: { x: -0.90, z: 0.44 },
    reach: 66, radius: 27, mouthY: 122, floorY: 108, keystone: false,
  },
  {
    name: 'range-deep',
    // 156 m up the West Range: behind the cold (M50), and it holds a keystone
    mouth: { x: -1270, z: -590 }, into: { x: -0.72, z: -0.69 },
    reach: 74, radius: 30, mouthY: 156, floorY: 139, keystone: true,
  },
]

// ---------- THE RAVINE: the way into the mountain ----------
// A slot canyon cut through the volcano's south flank from the gate's rock
// face up into the crater — floor climbs from the apron to the crater bench
// along the traced path (switchbacks keep it walkable), walls are the cone.
export const RAVINE = {
  halfWidth: 8,
  throatHalfWidth: 6.5, // the mouth, where the gate arch (13 m across) stands between the rock walls
  wallSlope: 3.5, // rise per metre out from the floor's edge (74°) — 2.4 (67°) left a 40° ramp beside the door where the cap cut the wall shelf (M19)
  floorStart: 71,
  floorEnd: 175,
  // the first leg runs straight north so the slot at the DOOR (z −912) is
  // square to the arch — an angled start left half the slot open beside the slab
  path: [
    { x: 0, z: -890 }, { x: 0, z: -928 }, { x: 24, z: -950 }, { x: 62, z: -975 }, { x: 112, z: -1012 }, { x: 128, z: -1060 },
    { x: 100, z: -1104 }, { x: 52, z: -1136 }, { x: 14, z: -1162 }, { x: 0, z: -1196 },
  ],
}

// ---------- THE LASSO: one river, three parts ----------
// `flow` 1 = current runs source→end along the path; 0 = dead water at
// `level`. Bed profiles: legs are monotonic downhill, the ring is level.
export const RIVER = {
  knot: { x: 400, z: 380 },
  level: 14, // the Knot's water surface: the ring and the Reservoir sit here
  parts: [
    {
      // INFLOW — out of the Wellspring pool in its coastal gorge at the East
      // Range's northern foot, then south down the long valley between the
      // north pines and the range, winding hard across the flats to the Knot
      name: 'inflow', flow: 1, halfWidth: 11, canyon: [0.02, 0.24],
      // BIG SWEEPS, not zigzags: the river leaves the pool south-west, swings
      // back south-east under the east foothills, bends west across the flats
      // and comes round south to the Knot — its average line is an S, not a
      // ruler (user: "curves left then right back to the same direction")
      path: [
        { x: 1100, z: -1195 }, { x: 1040, z: -1130 }, { x: 960, z: -1060 }, { x: 870, z: -1000 },
        { x: 780, z: -940 }, { x: 720, z: -870 }, { x: 700, z: -790 }, { x: 730, z: -710 },
        { x: 790, z: -650 }, { x: 850, z: -590 }, { x: 880, z: -520 }, { x: 860, z: -450 },
        { x: 800, z: -400 }, { x: 720, z: -370 }, { x: 630, z: -360 }, { x: 560, z: -330 },
        { x: 520, z: -270 }, { x: 530, z: -200 }, { x: 580, z: -150 }, { x: 640, z: -110 },
        { x: 690, z: -60 }, { x: 700, z: 10 }, { x: 670, z: 80 }, { x: 610, z: 130 },
        { x: 540, z: 170 }, { x: 480, z: 220 }, { x: 440, z: 290 }, { x: 410, z: 340 }, { x: 400, z: 380 },
      ],
    },
    {
      // THE RING — dead water round the Holm, back to the Knot. A bumpy,
      // wavy oval ~900 × 850 m; the Ford is the shallow bar on its far west.
      name: 'ring', flow: 0, halfWidth: 18, closed: true,
      path: [
        { x: 400, z: 380 }, { x: 395, z: 270 }, { x: 360, z: 170 }, { x: 300, z: 110 },
        { x: 250, z: 20 }, { x: 190, z: -60 }, { x: 60, z: -55 }, { x: -30, z: -20 },
        { x: -160, z: -35 }, { x: -290, z: -30 }, { x: -350, z: 60 }, { x: -400, z: 170 },
        { x: -470, z: 240 }, { x: -500, z: 350 }, // the Ford
        { x: -520, z: 430 }, { x: -450, z: 540 }, { x: -340, z: 610 }, { x: -270, z: 720 },
        { x: -170, z: 800 }, { x: -20, z: 790 }, { x: 90, z: 740 }, { x: 220, z: 720 },
        { x: 320, z: 660 }, { x: 350, z: 560 }, { x: 395, z: 460 },
      ],
      ford: { x: -500, z: 350 },
    },
    {
      // THE SPILL — the Wellspring's second outlet. PLAN has always said the
      // river "pours out of its mouth from a spring pool a few dozen metres
      // up — from the beach it looks like the river comes out of the sea
      // cliffs", and until M72 the pool just sat there: a dammed bowl 90 m
      // behind a 40 m sea cliff with nothing running between them.
      // A short overflow north out of the pool, down the shelf's own fall
      // line, to a lip on the cliff's inner edge. Everything below the lip is
      // rendering, not carving — the cliff is the point and a river bed cut
      // into it would turn it into a ramp.
      name: 'spill', flow: 1, halfWidth: 7, source: 'wellspring', slot: true, cut: 6.5,
      path: [
        // eleven points over 100 m: the bed may only step 0.5 m per point, so
        // the spacing IS the gradient — the gorge needs ~6 m of it to bite

        { x: 1112, z: -1235 }, { x: 1113, z: -1246 }, { x: 1115, z: -1257 },
        { x: 1117, z: -1268 }, { x: 1120, z: -1279 }, { x: 1123, z: -1289 },
        { x: 1127, z: -1299 }, { x: 1131, z: -1309 }, { x: 1135, z: -1318 },
        { x: 1139, z: -1325 }, { x: 1143, z: -1331 },
      ],
    },
    {
      // OUTFLOW — from the Knot south-east in real S-bends through the swamp's
      // delta to the Estuary Bay
      name: 'outflow', flow: 1, halfWidth: 12,
      // one long S through the marsh: east out of the Knot, a wide bend south
      // through the Flats, then a sweep east and south-east to the estuary
      path: [
        { x: 400, z: 380 }, { x: 450, z: 430 }, { x: 520, z: 470 }, { x: 600, z: 490 },
        { x: 680, z: 520 }, { x: 740, z: 580 }, { x: 770, z: 660 }, { x: 760, z: 750 },
        { x: 720, z: 830 }, { x: 700, z: 920 }, { x: 720, z: 1010 }, { x: 780, z: 1080 },
        { x: 860, z: 1130 }, { x: 950, z: 1160 }, { x: 1040, z: 1200 }, { x: 1110, z: 1270 },
        { x: 1160, z: 1340 }, { x: 1200, z: 1400 },
      ],
    },
  ],
}

// ---------- WATERFALLS: hand-placed lips, traced descents ----------
// A fall is not a shape you draw — it is a lip and a direction, and the rock
// decides the rest. The bake walks the baked ground from `lip` along `aim`
// and records the profile it falls down, so the sheet can never hang in the
// air or bury itself: whatever the cliff turned out to be after erosion is
// what the water runs on. `width` is the sheet at the lip.
export const FALLS = [
  {
    // THE WELLSPRING FALL — the spill leaves the shelf here and drops the
    // full height of the bluff into the cove. The one the coast trace has
    // called "the notch where the gorge meets the sea" since M10.
    name: 'wellspring-fall',
    lip: { x: 1143, z: -1331 },
    aim: { x: 0.71, z: -0.71 }, // north-east, square at the cliff face (the steepest line off the lip: 39 m → 1 m in eight)
    width: 11,
    spill: 'spill', // the river part that feeds it
    // A fall digs its own landing. Without this the sheet ended on shingle
    // 1.4 m above the sea with the waterline 38 m away — thirty metres of
    // water arriving on dry sand.
    plunge: { x: 1154, z: -1342, r: 14, floor: -2.6 }
  },
]

// ---------- STANDING WATER: traced shorelines ----------
// The Reservoir and the Wellspring are part of the river's story; the two
// lakes come in M10b. `level` is asserted by the bake validator; `deep` is the
// hand-picked deepest spot; `depth` the max carve below the surface.
export const LAKES = [
  {
    // THE RESERVOIR — the deep basin where the river crosses itself; four
    // arms of water meet here
    name: 'reservoir', level: RIVER.level, depth: 11, deep: { x: 400, z: 380 },
    shore: [
      [318, 335], [345, 300], [385, 288], [428, 296], [470, 322], [492, 366],
      [486, 420], [452, 458], [405, 476], [352, 468], [318, 436], [304, 388],
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
  {
    // LAKE ASTER — the big lowland lake in the west, between the ring hills
    // and the West Range's foot; never touches the river. Bays to the north
    // and west, a peninsula from the south shore.
    name: 'aster', level: 34.5, depth: 7, deep: { x: -830, z: 250 },
    shore: [
      [-940, 130], [-880, 90], [-800, 80], [-730, 120], [-700, 200],   // north shore → NE bay
      [-710, 290], [-690, 360], [-730, 430], [-800, 470],              // east shore
      [-850, 430], [-870, 350], [-900, 420], [-950, 450], [-990, 400], // south shore: a peninsula points north
      [-1010, 320], [-1000, 240], [-990, 170],                         // west shore against the range's foot
    ],
  },
  {
    // THE ALPINE TARN — a small cold lake on a shelf in the West Range's
    // saddle; iterated against the shore probe
    name: 'tarn', level: 231, depth: 5, deep: { x: -1255, z: 352 },
    shore: [
      [-1290, 330], [-1268, 314], [-1236, 318], [-1218, 342], [-1224, 372],
      [-1250, 392], [-1284, 384], [-1300, 358],
    ],
  },
]

// ---------- FORESTS: traced woodland regions ----------
// kind: 'broadleaf' (wide-canopy woods) · 'pine' (highland conifers) ·
// 'mixed' · 'redwood' (the Holm only, M10d). Rough first pass for M10a so
// the woods don't vanish for a round; retraced properly in M10d.
export const FORESTS = [
  // ARK reference (The Island): forest covers most of the land — beaches,
  // the plains, the desert flats, the swamp core, the high peaks and the
  // volcano's cone are the exceptions, not the rule. Woods run up onto the
  // foothills and the ranges' lower flanks (the scatter caps broadleaf at
  // ~130 m and pines at ~210 m; above that is alpine rock).
  {
    // THE SOUTHWOOD — first forest, a meadow north of the spawn beach; runs
    // east over the south mounds to the estuary lowland and north to the ring
    name: 'southwood', kind: 'broadleaf', density: 0.9, edge: 110,
    shore: [
      [-600, 1440], [-560, 1290], [-500, 1150], [-440, 1020], [-330, 930], [-200, 890],
      [0, 880], [200, 860], [380, 880], [520, 940], [620, 1050], [680, 1180], [700, 1320],
      [660, 1400], [540, 1450], [300, 1430], [60, 1420], [-160, 1430], [-370, 1450], [-500, 1440],
    ],
  },
  {
    // THE RINGWOOD — a broad wood over the whole ring country: the Holm, the
    // moat's banks and the land outside it, up to the pines and down to the
    // Southwood, so the river runs through forest, not lawn
    name: 'ringwood', kind: 'broadleaf', density: 0.85, edge: 120,
    shore: [
      [-640, -120], [-450, -260], [-200, -300], [60, -310], [300, -260], [480, -160], [560, 0],
      [600, 200], [560, 420], [520, 600], [420, 800], [200, 880], [-50, 900], [-300, 880],
      [-500, 820], [-650, 700], [-720, 520], [-740, 300], [-720, 80],
    ],
  },
  {
    // THE HOLM WOOD — the redwoods: 55-80 m columns that grow nowhere else
    name: 'holm', kind: 'redwood', density: 1, edge: 40,
    shore: [
      [-420, 260], [-330, 100], [-200, 30], [-40, 20], [130, 30], [250, 110], [320, 230],
      [330, 380], [300, 520], [220, 640], [80, 710], [-100, 720], [-260, 650], [-380, 540], [-440, 400],
    ],
  },
  {
    // THE WESTWOOD — wraps Lake Aster: between the lake and the ring, north to
    // the pines, south toward the desert, west up the range's foot
    name: 'westwood', kind: 'broadleaf', density: 0.85, edge: 110,
    shore: [
      [-720, -20], [-820, 50], [-940, 60], [-1020, 40], [-1080, 140], [-1060, 300], [-1040, 420],
      [-960, 480], [-860, 500], [-820, 560], [-880, 760], [-780, 900], [-620, 880], [-540, 760],
      [-600, 600], [-640, 420], [-620, 250], [-560, 60], [-440, -120], [-560, -180], [-700, -150],
    ],
  },
  {
    // THE NORTH PINES, WEST — conifers over the west foothills and the
    // northern rise, up to the caldera approach (kept open east of x -130)
    name: 'north-pines-west', kind: 'pine', density: 0.85, edge: 120,
    shore: [
      [-1000, -560], [-900, -760], [-760, -940], [-560, -1040], [-320, -1000], [-150, -900],
      [-130, -640], [-150, -420], [-260, -260], [-420, -200], [-600, -220], [-760, -300], [-900, -420],
    ],
  },
  {
    // THE NORTH PINES, EAST — the other half, west of the inflow valley
    name: 'north-pines-east', kind: 'pine', density: 0.85, edge: 120,
    shore: [
      [130, -900], [250, -1000], [420, -1060], [560, -980], [640, -820], [600, -640],
      [560, -480], [500, -330], [400, -240], [280, -260], [150, -420], [130, -700],
    ],
  },
  {
    // THE EASTBANK — mixed wood on the inflow's east bank up the east
    // foothills to the East Range's foot
    name: 'eastbank', kind: 'mixed', density: 0.8, edge: 100,
    shore: [
      [700, -1000], [860, -1080], [980, -960], [1000, -800], [1050, -600], [1100, -400],
      [1120, -200], [1100, 0], [1080, 200], [1000, 380], [880, 420], [780, 300],
      [720, 180], [650, 60], [640, -100], [700, -250], [720, -500], [680, -700], [700, -850],
    ],
  },
  // ---- THE RANGE PINES, RE-TRACED (M79) ----------------------------------
  // These four were single polygons thrown over a whole range — crest and
  // all — and the M73 plantability validator said so: `range-pines-west` was
  // 40% plantable, 32% of it above the 210 m pine line and 28% too steep to
  // stand a tree on. A wood drawn over the top of a mountain is a wood whose
  // middle is bare rock.
  //
  // The feather is 45 m on all four, not the 90 the old blob used: these are
  // RIBBONS 130-250 m wide, and a 90 m ramp in from both edges means the
  // middle never reaches full density — the first cut left the West Range's
  // southern flank with eight trees in a 60 m circle.
  //
  // A range has a flank on BOTH sides of its crest, and a polygon cannot
  // have a hole, so each range is now TWO traced woods — one per flank,
  // following the 210 m contour on the inside and stopping before the
  // lowland on the outside. Traced against `tools/forest-fit.mjs`, which
  // prints the plantable ground cell by cell using the bake's own rule.
  {
    // THE WEST RANGE, INLAND FLANK — the northern two thirds, facing the
    // ring. Its inner edge follows the treeline; the crest above it is bare,
    // as it should be. It STOPS at z 0: south of that the same flank is
    // already the Westwood's, and running a pine ribbon through a broadleaf
    // wood just flips the kind byte back and forth — measured, the first cut
    // overlapped Westwood and grew seven broadleaf trees where it wanted
    // pines. Below z 0 the West Range's inland flank is the Westwood's, which
    // is right: broadleaf at the lake's altitude, conifer above it.
    // 40% -> 99% plantable.
    name: 'range-pines-west', kind: 'pine', density: 0.7, edge: 45,
    shore: [
      [-1420, -1030], [-1340, -890], [-1270, -730], [-1215, -550], [-1200, -350], [-1150, -150],
      [-1130, -10], [-1010, 10], [-960, -140], [-980, -340], [-1000, -540], [-1020, -740],
      [-1120, -920], [-1250, -1050],
    ],
  },
  {
    // THE WEST RANGE, SEAWARD FLANK — the narrower strip between the crest
    // and the west coast. It only exists south of about z -200: north of
    // that the range meets the sea too steeply for anything to root. 99%.
    name: 'range-pines-seaward', kind: 'pine', density: 0.7, edge: 45,
    shore: [
      [-1430, -180], [-1450, -40], [-1400, 100], [-1350, 240], [-1380, 380], [-1340, 500],
      [-1300, 640], [-1220, 760], [-1500, 780], [-1560, 600], [-1580, 420], [-1590, 240],
      [-1580, 60], [-1555, -120],
    ],
  },
  {
    // THE EAST RANGE, INLAND FLANK — over the Eastbank's shoulder. 99%.
    name: 'range-pines-east', kind: 'pine', density: 0.7, edge: 45,
    shore: [
      [1140, -1120], [1130, -960], [1075, -820], [1100, -700], [1135, -580], [1160, -480],
      [1200, -380], [1195, -280], [1250, -180], [1250, -60], [1230, 60], [1265, 180],
      [1270, 300], [1040, 300], [1040, 120], [1040, -80], [1040, -280], [1040, -480],
      [1040, -680], [1045, -880], [1060, -1060],
    ],
  },
  {
    // THE EAST RANGE, SEAWARD FLANK — down to the east coast. 95%.
    name: 'range-pines-east-seaward', kind: 'pine', density: 0.7, edge: 45,
    shore: [
      [1250, -1080], [1300, -940], [1400, -800], [1440, -680], [1410, -540], [1445, -400],
      [1420, -260], [1470, -140], [1450, 0], [1475, 140], [1455, 260], [1360, 340],
      [1600, 340], [1620, 140], [1630, -60], [1620, -260], [1600, -460], [1580, -660],
      [1550, -860], [1440, -1020],
    ],
  },
  {
    // THE HORNS PINES — over the Northern Horns. The old trace ran its east
    // end to x -300, which is inside the volcano's bare ash skirt (43% of
    // the wood was ash). Pulled back west of the skirt. 39% -> 87%.
    name: 'horns-pines', kind: 'pine', density: 0.7, edge: 90,
    shore: [
      [-1250, -1100], [-1250, -1320], [-1120, -1380], [-980, -1420], [-860, -1470],
      [-700, -1510], [-640, -1470], [-680, -1400], [-760, -1340], [-900, -1280],
      [-1040, -1210], [-1120, -1140],
    ],
  },
  {
    // THE NORTH FOOTHILLS WOOD — mixed, between the volcano's NE flank and the
    // East Range's northern end
    // (M79: its west half sat in the cone's ash skirt — 38% of the wood.
    // Shifted east onto ground that can hold a tree. 60% -> 93%.)
    name: 'north-foothills', kind: 'mixed', density: 0.75, edge: 100,
    shore: [
      [600, -1520], [820, -1480], [980, -1360], [1080, -1220], [1060, -1080],
      [900, -1030], [780, -1120], [720, -1260], [700, -1400],
    ],
  },
  {
    // THE VOLCANO SKIRTS — mixed woods on the cone's lower flanks, NW and NE,
    // leaving the south approach open
    // (M79: both skirts reached up into the ash they are named after — 41%
    // and 43% of them were bare cone. Held back to the tree line. 100% each.)
    name: 'skirt-west', kind: 'mixed', density: 0.7, edge: 40,
    shore: [[-860, -1130], [-700, -1130], [-660, -1030], [-430, -960], [-420, -880], [-700, -850], [-860, -880]],
  },
  {
    name: 'skirt-east', kind: 'mixed', density: 0.7, edge: 40,
    shore: [[430, -1110], [610, -1090], [730, -1010], [720, -930], [500, -890], [350, -900], [320, -1010]],
  },
  {
    // THE SOUTH-EAST WOOD — between the outflow and the east coast, south of
    // the swamp
    name: 'southeast', kind: 'broadleaf', density: 0.8, edge: 100,
    shore: [
      [900, 700], [1000, 520], [1150, 440], [1300, 450], [1420, 600], [1460, 800], [1450, 1000],
      [1350, 1150], [1200, 1250], [1050, 1180], [980, 1000], [900, 850],
    ],
  },
  {
    // THE EAST COAST WOOD — the strip under the East Range's seaward side
    // (M79: its seaward edge ran out onto the beach and below it — 43% of
    // the wood was under 6 m. Pulled in to the shore line. 57% -> 98%.)
    name: 'east-coast', kind: 'broadleaf', density: 0.75, edge: 40,
    shore: [[1380, 460], [1560, 480], [1510, 610], [1430, 730], [1340, 860], [1290, 750], [1300, 600]],
  },
]

// ---------- BIOMES: traced edges ----------
// The last formula regions are gone: each biome is a polygon with a floor
// height the ground eases to (feathered over `edge` metres inside the line)
// and a level (the swamp's water table). `floor` null = leave the ground.
export const BIOMES = [
  {
    // THE WRITHING FLATS — the swamp, in the Reservoir's lee: wraps the
    // outflow's upper course east and south of the Knot, lobes toward the
    // east foothills, pinches out where the outflow drops to the estuary
    name: 'swamp', id: 1, floor: 4.8, level: 4.2, edge: 160,
    shore: [
      [560, 300], [640, 240], [760, 260], [880, 320], [980, 420], [1040, 540],
      [1010, 680], [1060, 800], [980, 920], [860, 980], [740, 1010], [640, 940],
      [600, 820], [520, 760], [480, 640], [500, 500], [540, 400],
    ],
  },
  {
    // THE DUNE COUNTRY — the desert in the West Range's rain shadow, from the
    // south-west foothills down to Dune Bay; a long tongue reaches north along
    // the range's foot
    name: 'desert', id: 2, floor: 9, level: null, edge: 160,
    shore: [
      [-1080, 820], [-960, 780], [-840, 840], [-720, 900], [-600, 1000], [-520, 1120],
      [-560, 1260], [-680, 1380], [-820, 1480], [-1000, 1440], [-1160, 1320], [-1280, 1200],
      [-1380, 1080], [-1300, 940], [-1180, 880],
    ],
  },
  {
    // THE SOUTH PLAIN — open grass between the Southwood and the ring, herds
    // and bush seas; a lower shelf on the way down to the beach
    name: 'plains', id: 3, floor: 14, level: null, edge: 120,
    shore: [
      [-520, 760], [-380, 700], [-200, 720], [-40, 800], [40, 920], [-20, 1060],
      [-140, 1150], [-320, 1180], [-460, 1100], [-540, 960], [-560, 850],
    ],
  },
]

// ---------- RUINS: hand-placed sites on the arc's spawn→summit gradient ----------
// The bake asserts each is flat, dry, open and off the river; the navmesh
// bake asserts a path from spawn. (Glades for the ones inside woods below.)
export const RUINS = [
  // THE ARC — five keystone sites and the gate (layouts by tag in ruins.ts)
  { tag: 'beach-statue', x: 180, z: 1500, keystone: true }, // the spawn beach's east end, pointing inland
  { tag: 'coast-shrine', x: 560, z: 1480, keystone: true }, // the root of East Head, looking over the Estuary Bay
  { tag: 'forest-temple', x: -60, z: 380, keystone: true }, // the Holm glade, heart of the ring
  { tag: 'highland-arch', x: 660, z: -240, keystone: true }, // the terrace on the inflow's east bank
  // nudged 12 m (M75, with aster-shrine and wellspring-columns): the ranges
  // are gentler now and their feet moved, taking these three sites just past
  // the 6 m flatness tolerance. Each went to the nearest ground that is both
  // flat and clear of trees.
  { tag: 'foothill-vault', x: -748, z: -320, keystone: true }, // the shelf between the west foothills and the pines
  { tag: 'caldera-gate', x: 0, z: -876 }, // mid-apron; the arch stands 19 m north against the rock face
  { tag: 'crater-beacon', x: 0, z: -1250, layout: 'beacon' }, // the arc's end: the beacon in the crater
  // THE REST OF THE LOST CITY — minor ruins across the 4 km (layouts by kind):
  // a broken ring on the plain, a watch over the estuary, an obelisk in the
  // dunes, shrines by the lake, arches in the pines, columns in the swamp…
  // Seven of them hold keystones too (M20: twelve in all, the gate wants
  // eight — every region has one, and no single lost ruin can block the arc)
  { tag: 'plain-circle', x: -250, z: 1000, layout: 'circle', keystone: true },
  { tag: 'south-mound-columns', x: 550, z: 938, layout: 'columns' },
  { tag: 'estuary-watch', x: 850, z: 1240, layout: 'watch', keystone: true },
  { tag: 'spit-columns', x: 1472, z: 1372, layout: 'columns' },
  { tag: 'coast-statue', x: 1498, z: 1034, layout: 'statue' },
  { tag: 'dune-obelisk', x: -950, z: 1150, layout: 'obelisk', keystone: true },
  { tag: 'dune-shrine', x: -700, z: 1280, layout: 'shrine' },
  { tag: 'aster-shrine', x: -782, z: 60, layout: 'shrine', keystone: true }, // the lake's north-east bay
  { tag: 'ring-west-watch', x: -620, z: 420, layout: 'watch', keystone: true },
  { tag: 'holm-north-shrine', x: -60, z: 110, layout: 'shrine' },
  { tag: 'swamp-columns', x: 884, z: 720, layout: 'columns' },
  { tag: 'foothill-circle', x: 1084, z: 86, layout: 'circle', keystone: true }, // up on the east foothills
  { tag: 'pine-arch-west', x: -500, z: -520, layout: 'arch' },
  { tag: 'pine-arch-east', x: 360, z: -620, layout: 'arch' },
  { tag: 'horns-watch', x: -916, z: -1048, layout: 'watch', keystone: true },
  // nudged 12 m south (M75): smoothing the ranges shifted the bluff's foot
  // under it and the flatness check went to 6.2 m over 24 (tolerance 6).
  // The first move went 43 m and landed in the Eastbank's trees; this is the
  // nearest ground that is both flat AND clear of forest. Still above the
  // gorge, still by the pool.
  { tag: 'wellspring-columns', x: 1026, z: -1200, layout: 'columns' }, // above the gorge, by the pool
]

export const CLEARINGS = [
  // the Holm glade — the temple's clearing at the heart of the ring
  [[-125, 335], [-85, 312], [-20, 320], [15, 362], [0, 415], [-45, 445], [-100, 438], [-135, 395]],
  // the vault glade (foothill-vault -760,-320)
  [[-800, -350], [-770, -365], [-730, -350], [-720, -318], [-735, -288], [-770, -280], [-800, -300]],
  // the arch glade (highland-arch 660,-240)
  [[625, -270], [655, -285], [690, -270], [700, -238], [685, -208], [655, -200], [625, -215]],
  // the shrine glade (coast-shrine 560,1480)
  [[520, 1455], [555, 1440], [595, 1455], [605, 1485], [585, 1512], [550, 1520], [520, 1500]],
  // the statue glade (beach-statue 180,1500)
  [[140, 1478], [180, 1462], [220, 1478], [230, 1505], [205, 1528], [165, 1530], [138, 1508]],
  // the south meadow — a break in the Southwood halfway to the ring
  [[-120, 1250], [-60, 1230], [20, 1250], [50, 1300], [20, 1350], [-50, 1365], [-110, 1330], [-135, 1285]],
  // the bank meadow — open ground on the Eastbank above the inflow
  [[860, -80], [920, -100], [980, -70], [990, -10], [950, 40], [880, 40], [850, -20]],
  // glades for the minor ruins that stand in woods
  [[-850, 10], [-820, -5], [-780, 10], [-770, 45], [-790, 78], [-830, 82], [-855, 50]],          // aster-shrine
  [[-660, 395], [-630, 380], [-590, 395], [-580, 425], [-600, 455], [-640, 460], [-665, 430]],   // ring-west-watch
  [[-100, 85], [-70, 70], [-30, 85], [-20, 115], [-40, 145], [-80, 150], [-105, 120]],           // holm-north-shrine
  [[-540, -545], [-510, -560], [-470, -545], [-460, -515], [-480, -485], [-520, -480], [-545, -510]], // pine-arch-west
  [[320, -645], [350, -660], [390, -645], [400, -615], [380, -585], [340, -580], [315, -610]],   // pine-arch-east
  [[-940, -1075], [-910, -1090], [-870, -1075], [-860, -1045], [-880, -1015], [-920, -1010], [-945, -1040]], // horns-watch
  [[995, -1200], [1025, -1215], [1065, -1200], [1075, -1170], [1055, -1140], [1015, -1135], [990, -1165]],   // wellspring-columns
  [[1050, 60], [1080, 45], [1120, 60], [1130, 90], [1110, 120], [1070, 125], [1045, 95]],          // foothill-circle
  [[520, 905], [550, 890], [590, 905], [600, 935], [580, 965], [540, 970], [515, 940]],          // south-mound-columns
  [[-730, 1255], [-700, 1240], [-660, 1255], [-650, 1285], [-670, 1315], [-710, 1320], [-735, 1290]], // dune-shrine
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
