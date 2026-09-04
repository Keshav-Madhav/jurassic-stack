// THE HAND-DRAWN CONTROL GEOMETRY OF THE ISLAND — one file, every vertex a
// decision. Rivers are traced paths, lakes and forests are traced polygons.
// No center+radius+noise formulas here, and nothing in here is generated.
//
// Read by tools/bake-island.mjs (carves + bakes it) and tools/map.mjs (draws
// the planning map you trace against). Coordinates are world metres:
// x east, z south (north is -z). Polygons are [x, z] pairs, any winding.

// ---------- RIVERS: traced paths, source tarn → sea ----------
export const RIVERS = [
  // EAST RIVER: born in a tarn on the volcano's SE shoulder, cuts the canyon,
  // crosses the flats in lazy S-bends, deltas through the swamp to the sea
  [
    { x: 148, z: -438 }, { x: 185, z: -408 }, { x: 228, z: -372 },
    { x: 272, z: -338 }, { x: 312, z: -296 }, { x: 344, z: -248 },
    { x: 372, z: -198 }, { x: 398, z: -152 }, { x: 424, z: -108 },
    { x: 442, z: -62 }, { x: 448, z: -14 }, { x: 440, z: 34 },
    { x: 452, z: 82 }, { x: 478, z: 124 }, { x: 502, z: 168 },
    { x: 512, z: 218 }, { x: 522, z: 272 }, { x: 540, z: 328 },
    { x: 558, z: 388 }, { x: 582, z: 448 }, { x: 606, z: 508 },
    { x: 634, z: 566 }, { x: 668, z: 622 }, { x: 712, z: 672 }, { x: 758, z: 716 },
  ],
  // WEST RIVER: born in a highland tarn, runs down the west slopes, flows the
  // LENGTH of the west lake (inlet neck → south bay), then crosses the desert
  // as its oasis line and reaches the SW coast
  [
    { x: -202, z: -392 }, { x: -238, z: -352 }, { x: -278, z: -312 },
    { x: -318, z: -268 }, { x: -352, z: -222 }, { x: -378, z: -172 },
    { x: -398, z: -124 }, { x: -408, z: -76 }, { x: -398, z: -30 }, // approach the inlet neck
    { x: -412, z: 8 }, { x: -438, z: 48 }, { x: -458, z: 92 }, { x: -478, z: 130 }, // through the lake
    { x: -505, z: 158 }, // exit the south bay
    { x: -532, z: 206 }, { x: -552, z: 258 }, { x: -576, z: 312 },
    { x: -598, z: 368 }, { x: -622, z: 428 }, { x: -640, z: 486 },
    { x: -654, z: 540 }, { x: -664, z: 592 },
  ],
]

// ---------- LAKES: traced shorelines ----------
// `level` is chosen against the surrounding terrain and asserted by the bake
// validator; `deep` is the hand-picked deepest spot.
export const LAKES = [
  {
    // WEST LAKE — elongated highland lake the west river flows through.
    // Design: wide southern basin, narrowing north neck where the river
    // enters, a peninsula pinching the east side, a small west bay.
    name: 'west',
    level: 8.2,
    deep: { x: -445, z: 55 },
    shore: [
      [-390, -95], [-355, -60], [-345, -15], [-360, 20],   // NE inlet neck (river enters)
      [-385, 40], [-395, 75], [-380, 105],                 // east shore → peninsula root
      [-410, 120], [-450, 150], [-490, 165],               // peninsula pinch + south bulge
      [-525, 150], [-545, 115], [-540, 75],                // SW shore (river exits ~here)
      [-560, 45], [-555, 5], [-530, -25],                  // west bay
      [-495, -40], [-470, -70], [-435, -95], [-405, -105], // NW shore back to inlet
    ],
  },
  {
    // EAST LAKE — smaller lowland lake with a marshy south end and one bay.
    name: 'east',
    level: 5.4,
    deep: { x: 310, z: 290 },
    shore: [
      [255, 240], [290, 225], [330, 230], [355, 250],  // north shore
      [370, 280], [360, 315], [372, 345],              // east + SE bay notch
      [345, 370], [305, 380], [270, 365],              // south (marshy)
      [245, 335], [238, 295], [242, 262],              // west shore
    ],
  },
  {
    // EAST SPRING TARN — the east river's source pool on the volcano's SE
    // shoulder; the river visibly flows OUT of standing water
    name: 'east-tarn',
    level: 24.5, // iterated: shore min 25.2 (low side is the outlet)
    deep: { x: 140, z: -452 },
    shore: [
      [112, -470], [132, -482], [158, -478], [172, -460],
      [168, -438], [150, -424], [126, -428], [110, -448],
    ],
  },
  {
    // WEST SPRING TARN — the west river's highland source pool
    name: 'west-tarn',
    level: 14, // iterated: shore min 14.6
    deep: { x: -212, z: -408 },
    shore: [
      [-238, -424], [-216, -436], [-192, -428], [-182, -406],
      [-192, -386], [-216, -380], [-236, -392], [-244, -410],
    ],
  },
]

// ---------- FORESTS: traced woodland regions ----------
// kind: 'broadleaf' (wide-canopy woods + elder giants) · 'pine' (highland
// conifers) · 'mixed'. density 0..1 is the interior fullness; the bake
// feathers it to zero over `edge` metres inside the boundary so wood lines
// thin out rather than stop dead. Clearings punch holes.
export const FORESTS = [
  {
    // THE SOUTHWOOD — the first forest. Lowland broadleaf woods that start a
    // meadow's width north of the spawn beach and run up to the east lake,
    // wrapping its south shore and filling the SE coastal lowland below the
    // swamp. Ragged southern wood line so the beach reads as a clearing;
    // a long tongue of trees reaches west toward the plains.
    name: 'southwood', kind: 'broadleaf', density: 0.85, edge: 45,
    shore: [
      [-170, 700], [-150, 640], [-190, 600], [-230, 560], [-200, 520],   // west tongue toward the plains
      [-140, 500], [-120, 450], [-80, 430], [-60, 380], [-20, 350],       // west wood line, bays and points
      [30, 335], [70, 310], [140, 290],                                   // north edge → the Elderwood joins here
      [215, 300], [225, 370], [250, 420], [310, 445], [370, 470],         // skirt the east lake's south shore
      [420, 480], [440, 540], [410, 610], [360, 660], [300, 700],         // SE coastal lowland under the swamp
      [220, 720], [170, 690], [140, 705], [60, 715], [20, 700], [-20, 725], [-100, 730], // the beach's north wood line
    ],
  },
  {
    // THE ELDERWOOD — the island's heart. Old-growth broadleaf, the densest
    // canopy, where the elder giants stand. Holds the forest temple. Runs
    // from the lake-side highlands east to the east river's plain, and wraps
    // the east lake's north shore.
    name: 'elderwood', kind: 'broadleaf', density: 1, edge: 50,
    shore: [
      [-210, 260], [-230, 180], [-200, 90], [-220, 0], [-180, -80],     // west edge along the lake-side highlands
      [-120, -140], [-30, -160], [60, -150], [150, -120], [230, -110],   // north edge (pines beyond)
      [300, -130], [340, -90], [360, -20], [400, 40], [410, 120],        // NE spur toward the canyon mouth, east edge west of the river
      [390, 180], [350, 200], [280, 205], [235, 210],                    // wrap the east lake's north shore
      [215, 245], [150, 275], [60, 300], [-20, 330], [-110, 320],        // south edge (meets the Southwood)
    ],
  },
  {
    // THE EASTBANK — mixed wood on the strip between the east river and the
    // NE range's foothills; thins where the river plain opens.
    name: 'eastbank', kind: 'mixed', density: 0.7, edge: 40,
    shore: [
      [480, -260], [540, -300], [590, -250], [620, -180], [640, -100],
      [650, -10], [630, 70], [600, 130], [560, 150], [520, 120],
      [495, 60], [485, -20], [470, -100], [460, -180],
    ],
  },
  {
    // THE NORTH PINES — conifer highlands between the two spring tarns, on
    // the rise toward the volcano; holds the highland arch and the vault.
    name: 'north-pines', kind: 'pine', density: 0.8, edge: 50,
    shore: [
      [-440, -150], [-410, -250], [-350, -350], [-280, -430], [-190, -470], // west/north edge round the west tarn
      [-100, -455], [-40, -410], [30, -390], [110, -405], [200, -420],   // along the volcano's foot, south of the east tarn
      [240, -370], [300, -320], [330, -250], [300, -190], [230, -160],   // east edge above the canyon
      [150, -140], [60, -175], [-40, -160], [-140, -140], [-260, -125], [-360, -120], // south edge (Elderwood beyond)
    ],
  },
  {
    // THE WESTWOOD — broadleaf on the NW range's east flank, above the west
    // lake; the west river runs down through its eastern half.
    name: 'westwood', kind: 'broadleaf', density: 0.75, edge: 40,
    shore: [
      [-650, -380], [-570, -420], [-480, -390], [-400, -330], [-330, -280], // north edge, reaching east over the river
      [-300, -220], [-310, -160], [-350, -130], [-400, -120],              // east edge (pines beyond)
      [-455, -120], [-510, -95], [-560, -70], [-610, -35],                 // south edge above the lake's NW shore
      [-655, -20], [-695, -60], [-705, -160], [-695, -260], [-675, -330],  // west edge under the range crest
    ],
  },
  {
    // THE LAKESHORE WOOD — light broadleaf on the west lake's east shore,
    // between the lake and the Elderwood; the way west is through trees.
    name: 'lakeshore', kind: 'broadleaf', density: 0.6, edge: 35,
    shore: [
      [-335, -105], [-260, -115], [-235, -60], [-245, 20], [-240, 120],  // east edge against the Elderwood
      [-235, 200], [-260, 260], [-320, 250], [-370, 200], [-395, 150],   // south end, above the desert
      [-355, 100], [-355, 60], [-330, 30], [-320, -20], [-330, -60],     // west edge, a stride back from the shore
    ],
  },
  {
    // THE RANGE PINES — conifers on the NE range's western flank and passes.
    name: 'range-pines', kind: 'pine', density: 0.7, edge: 40,
    shore: [
      [555, -420], [620, -445], [680, -390], [720, -300], [745, -180],
      [735, -80], [700, -35], [655, -60], [610, -140], [575, -240], [550, -340],
    ],
  },
]

// glades: sunlit holes in the woods — every ruin sits in one, plus two big
// meadows for camps and fights
export const CLEARINGS = [
  // the temple glade (forest-temple 186,75)
  [[135, 40], [165, 20], [215, 25], [245, 55], [240, 100], [215, 130], [175, 135], [140, 110], [125, 75]],
  // the statue glade (beach-statue 51,613)
  [[10, 590], [40, 575], [80, 585], [95, 615], [80, 645], [45, 655], [15, 640], [5, 615]],
  // the arch glade (highland-arch -264,-172)
  [[-300, -200], [-270, -215], [-235, -200], [-225, -170], [-240, -140], [-275, -135], [-300, -155]],
  // the vault glade (foothill-vault -171,-329)
  [[-205, -350], [-175, -365], [-140, -350], [-135, -320], [-155, -298], [-190, -300], [-208, -325]],
  // the hollow — a long meadow in the Elderwood's south, camp ground
  [[-60, 140], [-10, 120], [50, 130], [90, 165], [80, 210], [30, 235], [-30, 230], [-75, 195]],
  // the south meadow — a break in the Southwood halfway to the beach
  [[-70, 480], [-20, 470], [40, 490], [60, 530], [30, 570], [-30, 575], [-80, 540]],
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
