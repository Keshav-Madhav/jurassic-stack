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

## Intaken — game-ready in `public/models/dinos/`

| Species | Source | License | Tris | Bones | Clips | Raw→Compressed | Verdict |
|---|---|---|---|---|---|---|---|
| Velociraptor | Quaternius via poly.pizza | CC0 | 1,248 | 29 | 6 (attack/death/idle/jump/run/walk) | 286→130 KB | PASS |
| TRex | Quaternius via poly.pizza | CC0 | 1,820 | 29 | 6 | 337→149 KB | PASS |
| Triceratops | Quaternius via poly.pizza | CC0 | 1,332 | 29 | 6 | 310→150 KB | PASS |
| Stegosaurus | Quaternius via poly.pizza | CC0 | 2,282 | 29 | 6 | 423→183 KB | PASS |
| Apatosaurus | Quaternius via poly.pizza | CC0 | 1,438 | 29 | 6 ¹ | 381→178 KB | PASS |
| Parasaurolophus | Quaternius via poly.pizza | CC0 | 1,412 | 29 | 6 | 291→134 KB | PASS |

¹ Apatosaurus's death clip is named `Armature|Stegosaurus_Death` in the source export (Quaternius
quirk). Functionally the death clip — the species table's clip map must use this exact name.

All six: no textures (vertex-colored materials) → KTX2 not applicable; meshopt only.
Shared traits: 29 bones (within the 40-bone crowd budget), TRIANGLES mode, ~2.5s idles.

## Pending — tier-A Sketchfab roster (needs logged-in download)

Sketchfab downloads require an authenticated account; do these in a session with the user
(download glTF format from each page, drop into `public/models/_raw/sketchfab/`, then run the
pipeline above). Origin labels and clip counts from the 2026-09-01 census.

| Species | URL (sketchfab.com/models/…) | License | Clips | Note |
|---|---|---|---|---|
| Velociraptor (PBR) | 8f1744af7b0847a2aabe3df90be802f0 | CC-BY | 26 | ferociousindustries — richest moveset |
| Stegosaurus (PBR) | ec254ea1554941fe8a131f62db0faf3d | CC-BY | 13 | ferociousindustries |
| Pachycephalosaurus | 6eea5cee4afa4730bf75c6329a43e56d | CC-BY | 21 | ferociousindustries |
| T-Rex | 38007d947ae74dea83988cb0b08ee053 | CC-BY | 5 | LasquetiSpice |
| Triceratops | d5658e6fe77d40bda00d59bb840cd856 | CC-BY | 13 | Unity root-motion clips |
| Brachiosaurus | fa1f38e22804414da22b464e0ac0e794 | CC-BY | 5 | ValeGoG |
| Therizinosaurus | de82fe0d9e3f468b95790c0ef517723e | CC-BY | 4 | victory_ |
| Allosaurus | 5de1fcc39f314723b5e230ab0730f713 | CC-BY-NC | 8 | caps future public release |
| Carnotaurus | 41927d12f870431f92613025e8816839 | CC-BY | 8 | origin UNCLEAR — private repo only |
| Terror bird | 41ce87a9f3a3498da1141b7645e0e4fb | CC-BY | 11 | origin UNCLEAR — private repo only |
| Pteranodon | 7d7683df41d1405283f160e81a5dff1b | CC-BY | 3 | flyer (M7 milestone) |
| Columbian mammoth | e47d442b22d64fbd9a3b7a539fc47987 | CC-BY-NC-SA | 3 | NHMLA museum, stylized |
| Spinosaurus | c11709dbf9e3472f9533343f1f342564 | CC-BY | 1 | tier-b: ~98K tris, decimate |
| Mosasaurus | 4a1feecff6c7468b8c07ba0ad439e0e0 | CC-BY-NC | 1 | tier-b: 67K, aquatic (M7) |
| Sauropelta | c6373f12f3954facb8d5fe48055c9161 | CC-BY | 1 | tier-b: 83K, decimate |
| Dilophosaurus | 32ed5b98069b4acd8865ac506a2b9b4f | CC-BY | 3 | tier-b: 87K, decimate |

## Also pending (direct download, no auth — next intake batch)

- Quaternius Ultimate Animated Animals (12 species, CC0) — fauna/tames filler
- KayKit character + Character Animations pack (CC0) — the player (M3)
- Quaternius Stylized Nature MegaKit + Ultimate Nature (CC0) — foliage (M5/M6)
- Quaternius Ultimate Modular Ruins, KayKit Medieval Builder + Dungeon Remastered (CC0) — M5/M8
