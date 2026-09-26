# Ocean slab linking investigation — 2026-09-26

The supplied `tectolite_ocean_slab_tests.json` (version 12, 140 plates) and three
comparison recordings show changed continental assembly after adding manual ocean
slabs. There are both saved-history changes and rotation-engine defects.

## Saved-history changes

Comparison with the existing `TectoLite_frtjhrfgjnrgtfj-links-fixed.json` identifies
three original continents following newly created slabs. Their original geometry
stages are unchanged, but linking inserted stationary motion segments:

| Continent ID | New leader ID | Link time | Additional stationary segments |
| --- | --- | --- | --- |
| `7fi8wtyi0` | `syw3k4yl0` | 116 | 116, 169 |
| `pcneucu1j` | `0mjvgf4kw` | 210 | 169, 170, 210 |
| `jgx7aa7h7` | `kfsozb0u5` | 194 | 194 |

The intended direction is inferred from the request to add slabs to the existing
animation and from the earlier save. The recordings show the resulting movement,
not the clicks that created these relationships. The current linking dialog
already states leader/follower direction, offers swapping, and explains that the
follower's motion becomes zero. No automatic import heuristic was added: legitimate
projects can deliberately link these objects in either direction.

The separate `tectolite_ocean_slab_tests-repaired.json` restores only these three
continents' motion segments and link fields from the earlier save. It makes
`kfsozb0u5` follow `jgx7aa7h7` from 194 and `0mjvgf4kw` follow `pcneucu1j` from 210.
`syw3k4yl0` retains its existing link to `acgq9o1xl`.

Slabs `j2wgvk063` and `0mjvgf4kw` were drawn after their leaders' trajectories had
changed. Their birth geometry and geometry stages are rotated by the difference
between the original and restored leader transforms at each anchor time. This
preserves their placement relative to the chosen continent. All 140 plates,
later original-plate edits, and other authored motion are retained. Rendered
geometry caches are recomputed. The supplied files are untouched.

## Engine corrections

1. **Linked relative motion used the query start as a new reference frame.**
   Multiplying the parent's interval rotation by the child's own interval rotation
   fails when axes differ and the query begins after linking. A slab created later,
   or an inserted geometry snapshot, therefore drifts from the same physical point
   on its leader. The corrected interval uses
   `P(anchor→to) · O(from→to) · inverse(P(anchor→from))`, with the frame anchored at
   link start (birth for inherited or undated links). Pure followers keep the direct
   parent-interval path.
2. **Split children were mistaken for fusion successors.** Successor lookup accepted
   any `parentPlateIds` entry, including a single-parent split. A surviving slab
   could follow whichever split child appeared first in the array. Delegation now
   requires a fusion with multiple parents. A manual slab still needs an explicit
   choice of split branch or a split of its own; no arbitrary branch is selected.

For a concrete reproduction in the supplied save, take the first birth vertex of
`7fi8wtyi0`, `[-96.94440195723796, -1.7899769780776744]`. Carry it from time 92 to 240
directly, and compare with carrying it via an anchor at 169. Before the fix the
results are `[-68.52299057574811, -16.158611672941543]` and
`[-71.33393221489062, -22.68400318881417]`. Afterward both paths give the first result.

## Verification

- Three regression tests failed before the engine changes and pass afterward:
  later slab alignment, geometry-stage insertion, and split successor ordering.
- All 256 application tests pass; TypeScript, Electron syntax checks, and all four
  finite-rotation scenario checks pass.
- ESLint has zero errors (98 existing warnings); production build succeeds with
  its existing chunk-size warning.
- The repaired file passes the real project parser and retains all 140 plates.
- At each integer time from 0 through 263, every live original plate was compared
  with the earlier save: 95,925 vertex comparisons, zero difference.
- This validates restored continental history through assembly, not a geological
  redesign of the manually drawn slab shapes or their lifetimes. No automatic
  deletion, subduction, or repartition of those slabs is inferred.

The fixes are in the workspace build; an installed desktop release must be rebuilt
to include them.
