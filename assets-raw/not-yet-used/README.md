# Downloaded, kept, not yet shipped

Game-ready models for species that **do not exist in the game yet**. They live
here rather than in `public/models/` because Vite copies `public/` verbatim
into `dist/`, so anything parked there is uploaded and STORED on every single
deployment — 5.1 MB of it, forever, for a flyer and an aquatic that PLAN
explicitly defers (decision 7: *"the flyer and the aquatic are movement modes
and come after"*).

Move one back into `public/models/dinos/` the day its species is added to
`src/scripts/species.ts`.

| file | for |
|---|---|
| `Mosasaurus.glb` | the aquatic tame (PLAN beat 4, deferred by the user) |
| `Pteranodon.glb` | the flyer (PLAN decision 7) |
