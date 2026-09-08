# Asset intake ledger

Every model that enters `public/models/` must pass `tools/gate.mjs` and get a row here.
Raw originals are archived in `public/models/_raw/` (committed while small; packs >50 MB stay out
of git — archive locally/cloud instead). Game-ready copies (meshopt-compressed) live in
`public/models/dinos/` etc.

Pipeline per model:

1. Download → `_raw/<source>/<Species>.glb` (archive immediately — free listings vanish)
2. `node tools/gate.mjs <raw>` — must not FAIL
3. `node tools/turntable.mjs <raw>` — visual check, clips listed
4. `npx gltf-transform meshopt <raw> <out> --level medium` (+ KTX2 when the model has textures)
5. Re-gate + re-turntable the compressed output (proves clips survive; loads via the same
  GLTFLoader+MeshoptDecoder path the game uses)
6. Row goes below



**Sketchfab conversion gotchas learned at intake (apply to every future Sketchfab model):**

- Their auto-glTF uses `KHR_materials_pbrSpecularGlossiness` (marked *required*) — three.js
  ignores it and renders untextured clay. **Always run `gltf-transform metalrough` first.**
- `gltf-transform resize` re-encodes JPEG textures as lossless PNG and can *inflate* the file —
  always follow with `webp`. Full tier-A pipeline: `metalrough → resize 2048 → webp → meshopt`.
- KTX2 deferred to M6 (no toktx installed; WebP covers download size, KTX2 will cover VRAM).

## Intaken — primary roster, game-ready in `public/models/dinos/` (14)

All Sketchfab tier-A, converted via metalrough → resize 2048 → webp → meshopt. Turntable-verified
textured + animating through the game's GLTFLoader+MeshoptDecoder path. 37 MB total.

| Species | Source (sketchfab.com/models/…) | License | Tris | Bones | Clips | Size | Verdict |
|---|---|---|---|---|---|---|---|
| Velociraptor | 8f1744af7b0847a2aabe3df90be802f0 | CC-BY | 15,098 | 137 | **26** (full moveset: idles/roars/bites/leaps/sleep/death×2/walk/jog/sprint) | 5.5M | PASS ² |
| TRex | 38007d947ae74dea83988cb0b08ee053 | CC-BY | 11,938 | 72 | 5 (run/bite/roar/tail/idle) | 3.5M | PASS |
| Triceratops | d5658e6fe77d40bda00d59bb840cd856 | CC-BY | 8,844 | 65 | 13 (root-motion walk/turn set) | 664K | PASS |
| Stegosaurus | ec254ea1554941fe8a131f62db0faf3d | CC-BY | 19,839 | 53 | 13 (incl. TailWhip/KnockedDown/Death) | 2.5M | PASS |
| Pachycephalosaurus | 6eea5cee4afa4730bf75c6329a43e56d | CC-BY | 26,112 | 107 | **21** (incl. Charge/Headbutt/KnockedOut/sleep cycle) | 5.5M | PASS |
| Carnotaurus | 41927d12f870431f92613025e8816839 | CC-BY ³ | 13,936 | 29 | 8 (walk/attack/fall/idle/run/stand) | 1.4M | PASS |
| Allosaurus | 5de1fcc39f314723b5e230ab0730f713 | CC-BY-NC | 11,268 | 91 | 8 (call/attack/die×2/hit/idle/run/walk) | 3.5M | PASS |
| TerrorBird | 41ce87a9f3a3498da1141b7645e0e4fb | CC-BY ³ | 4,492 | 37 | 11 (attack/headsmash/roar/die/idles) | 1.2M | PASS |
| Mammoth | e47d442b22d64fbd9a3b7a539fc47987 | CC-BY-NC-SA | 1,668 | 58 | 3 (idle/trumpet/walk) | 620K | PASS |
| Dilophosaurus | 32ed5b98069b4acd8865ac506a2b9b4f | CC-BY | 87,512 | 92 | 1 real (2.08s) + 2 junk 0.04s | 1.1M | PASS (decimate at M6) |
| Spinosaurus | c11709dbf9e3472f9533343f1f342564 | CC-BY | 97,908 | 78 | 1 (6.8s) | 2.5M | PASS (decimate; clips to author) |
| Sauropelta | c6373f12f3954facb8d5fe48055c9161 | CC-BY | 82,708 | 31 | 1 (5s) | 2.5M | PASS (decimate; clips to author) |
| Mosasaurus | 4a1feecff6c7468b8c07ba0ad439e0e0 | CC-BY-NC | 67,434 | 50 | 1 (13.2s swim) | 2.5M | PASS (aquatic, M7) |
| Pteranodon | 7d7683df41d1405283f160e81a5dff1b | CC-BY ³ | 13,494 | 125 | 3 (flying/walking/standing) | 3.5M | PASS (flyer, M7) |

² 137 bones — fine as a hero/nearby rig; excluded from dense-crowd LOD0 scenes (budget 40).
³ Origin UNCLEAR per census — private repo only, never deploy publicly.

### Rejected / held at intake

| Species | Why | Disposition |
|---|---|---|
| Brachiosaurus (fa1f38e2…) | Museum diorama, not a game asset: two T-posed brachios + display base, 244 bones across duplicate armatures, all clips 0s poses | REJECTED — Quaternius Apatosaurus is the sauropod |
| Therizinosaurus (de82fe0d…) | Renders empty: skinned bind pose far from node origin (poisoned bounds); clips animate an Empty/Speaker node (12.5s "EmptyAction"/"SpeakerAction") | HOLD — needs Blender rig surgery; roster deep enough without it |

## Fallback roster — `public/models/fallback/` (6, Quaternius CC0)

Low-poly stand-ins for any primary that breaks, and instant new-species placeholders.
Vertex-colored (no textures → KTX2 n/a), meshopt only.

| Species | Tris | Bones | Clips | Size | Verdict |
|---|---|---|---|---|---|
| Velociraptor | 1,248 | 29 | 6 (attack/death/idle/jump/run/walk) | 130K | PASS |
| TRex | 1,820 | 29 | 6 | 149K | PASS |
| Triceratops | 1,332 | 29 | 6 | 150K | PASS |
| Stegosaurus | 2,282 | 29 | 6 | 183K | PASS |
| Apatosaurus | 1,438 | 29 | 6 ¹ | 178K | PASS |
| Parasaurolophus | 1,412 | 29 | 6 | 134K | PASS |

¹ Apatosaurus's death clip is named `Armature|Stegosaurus_Death` in the source export (Quaternius
quirk). Functionally the death clip — the species table's clip map must use this exact name.

**Roster count: 14 primary + 2 fallback-only species (Apatosaurus, Parasaurolophus) = 16 species
intaken and game-ready.** Raw Sketchfab archives (~400 MB zips + GLBs) are gitignored — archived
locally at `public/models/_raw/sketchfab/`; keep a cloud copy too (listings vanish, and a fresh
clone won't have them).




## Also pending (direct download, no auth — next intake batch)

- Quaternius Ultimate Animated Animals (12 species, CC0) — fauna/tames filler
- KayKit character + Character Animations pack (CC0) — the player (M3)
- Quaternius Stylized Nature MegaKit + Ultimate Nature (CC0) — foliage (M5/M6)
- Quaternius Ultimate Modular Ruins, KayKit Medieval Builder + Dungeon Remastered (CC0) — M5/M8


## Decimation pass (M9g, forest density round)

Trees now number ~6K and every triangle counts. The heaviest legacy props were
simplified in place with `gltf-transform simplify` (meshopt simplifier), raw
originals untouched in `_raw/nature/`, turntable-verified:

| Prop | Before | After | Flags |
|---|---|---|---|
| DeadTree (5 variants) | 15,464 tris | 4,327 | `--ratio 0.28 --error 0.004` |
| Palm | 3,134 | 940 | `--ratio 0.3 --error 0.02` |
| Willow | 2,056 | 2,056 (simplifier no-op; left as is) | — |
| Grass1 | 155 | 62 | `--ratio 0.4 --error 0.02` (M10a: 117K tufts on the 4 km island) |
| Bush1 | 360 | 190 | `--ratio 0.4 --error 0.05` (M10d: 27K bushes, the biggest eye-level cost) |
| Fern | 288 | 142 | `--ratio 0.45 --error 0.01` |
| Mushroom | 6,044 | retired | it was a mushroom *creature* (eyes, arms); replaced by a built 60-tri cluster (`trees.ts`) |

Built trees (`src/scripts/trees.ts`, not assets): canopy ≈ 850 tris full / ≈ 250 far LOD;
elder ≈ 1,500 / ≈ 450.


## The kit — items and buildables (M23, 2026-09-06) · `public/models/kit/`

Downloaded, not built (PLAN: CC0 packs first). Intake: `gltf-transform copy` (embeds Kenney's external
`Textures/colormap.png`) → `meshopt --level medium`. Raw archives in `_raw/kenney/` (the two kit zips)
and `_raw/polypizza/` (with `SOURCES.md`: poly.pizza ids, authors, licences). Contact sheets via
`tools/contact-sheet.mjs`. The item icons are RENDERED from these models at load (`kit.ts`), so the
icon is the thing.

| Kit file | Source | Licence | Used as |
|---|---|---|---|
| kenney-campfire-pit / floor / fence-fortified / structure / structure-floor / structure-roof / fence / tool-axe / tree-log / resource-wood / resource-stone / resource-planks / workbench / chest / bedroll / tent | Kenney Survival Kit 2.0 (kenney.nl/assets/survival-kit) | CC0 | campfire · foundation + ceiling (floor planks) · wall (fortified fence) · wood (tree-log) · stone · **bedroll** (M37) · **workbench + chest** (M39) · tent, fence and roof still held for later |

**The kit's colour** (M39): Kenney's colormap is a saturated toy palette and reads as orange plastic
beside this island's greens. The multiply tint that used to fight it could not win — a saturated red
times grey is still a saturated red — so `kit.ts::weathered()` pulls the ATLAS 66% toward its own
luminance and darkens it 14%, once per image, cached across every model that shares it.
| kenney-meat-raw / meat-cooked / meat-ribs / grapes | Kenney Food Kit (kenney.nl/assets/food-kit) | CC0 | raw meat · cooked meat · berries (grapes) |
| pp-Saddle | **Saddle** by *Poly by Google*, poly.pizza/m/dSMm_V4sKNr | **CC-BY 3.0** (attribution required) | the saddle. It used to borrow the Kenney bedroll; when the bedroll became a real item (M37) the two icons were the same picture, so the saddle got a real model (M38). Intake: `gltf-transform copy` → `meshopt --level medium` → `resize 512` → `webp -q 82`, 1.64 MB → 74 KB |
| pp-Spear, pp-Torch, pp-WoodenTorch, pp-AxeStone | Quaternius via poly.pizza (fH1zmvjPNx, Gq38E7hFZw, pNsfJzhXiD, XnqO64KhYx) | CC0 | spear · torch (wooden) · hatchet + flint (the head) |
| pp-AnimalHide | Zsky via poly.pizza GaurgMNrWC | CC-BY 3.0 — credit Zsky | hide |
| pp-Rope | J-Toastie via poly.pizza dkNzi6oDQj | CC-BY 3.0 — credit J-Toastie | fiber |
| pp-CampfireRocks | reyshapes via poly.pizza 5sjLUck886 | CC0 | held |

Kenney's colormap is saturated toy-orange; the kit tints Kenney materials to weathered timber at load
(`kit.ts`), icons keep the true colours. Still wanted: a real saddle, a thatch roof piece, a door.


## The sound (M35, 2026-09-08) · `public/audio/`

Downloaded, not synthesised (PLAN: CC0 packs first — and a synthesised roar sounds like a
synthesiser). 74 files, 1.1 MB total, all CC0, no attribution required (given anyway). Raw archives
in `_raw/kenney-audio/` and `_raw/oga-creatures/`. `src/scripts/sfx.ts` maps game events to these
ids; `tools/gate-sound.mjs` proves each one actually reaches the speakers.

| In the game | File(s) | Source | Licence |
|---|---|---|---|
| footsteps: grass · dirt · sand · rock · snow · wood | `step-<ground>-0..3.ogg` | Kenney **Impact Sounds** (`footstep_grass` / `carpet` / `snow` / `concrete` / `wood`) | CC0 |
| fists, flesh, wood, stone | `hit-punch-*`, `hit-flesh-*` (impactSoft), `hit-wood-*`, `hit-stone-*` (impactMining) | Kenney **Impact Sounds** | CC0 |
| a blade swung, gathering, a plank placed | `blade-*` (knifeSlice), `pick-*` (cloth/leather), `chop.ogg`, `place.ogg` (impactPlank), `craft.ogg` (metalClick) | Kenney **RPG Audio** + Impact Sounds | CC0 |
| the caldera door | `door-open.ogg`, `creak.ogg` | Kenney **RPG Audio** | CC0 |
| the pack, the keystones | `ui-open/close/click/error/confirm.ogg` | Kenney **Interface Sounds** | CC0 |
| eating, drinking, the player hurt | `eat-0..2.ogg`, `drink-0..1.ogg` (burble), `player-hurt-0..1.ogg` | **80 CC0 creature SFX** (opengameart.org/content/80-cc0-creature-sfx) | CC0 |
| the animals: idle calls, grunts, roars, pain, death | `dino-call-0..3` (monster), `dino-grunt-0..2`, `dino-roar-0..2`, `dino-hurt-0..2`, `dino-die-0..1` | **80 CC0 creature SFX** | CC0 |
| the Gatekeeper | `alpha-roar.ogg` (transcoded to mono 22 kHz Vorbis with ffmpeg) | **CC0 deep monster roar** (opengameart.org/content/cc0-deep-monster-roar) | CC0 |

Pitch is a function of the animal: a rex speaks a fifth below a raptor (`rate = 1.55 - height×0.16`)
and carries twice as far. There is no CC0 fire loop in these packs and a short loop tiles audibly,
so the campfire crackle is built from pitched-up wood ticks at random intervals — a crackle IS a
sparse train of little impacts (`Sfx.crackle`).
