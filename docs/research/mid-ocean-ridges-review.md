# Independent mid-ocean ridge review

Reviewed on 8 October 2026 by the separately assigned review agent. Scope: the
uncommitted ridge implementation against base commit
`d89a4fb4ce715b4e8fa17867eb3be0209e6c6c3c`, including the pure reconstruction,
SimulationEngine integration, current-time export, heightmap generation, canvas
integration, related tests and source note. Existing user changes to `.gitignore`
and `docs/research/strive-tectonic-history.md` were excluded.

## Result

No remaining actionable findings in the reviewed implementation after the fixes
below. The implementation follows the selected blog guidance within its explicitly
documented worldbuilding approximations. This is not a claim of geological
calibration or an assurance that arbitrary future inputs cannot expose defects.

## Source comparison

- [Worldbuilding Pasta, Part Va: Tectonic History](https://worldbuildingpasta.blogspot.com/2020/01/an-apple-pie-from-scratch-part-va.html):
  paired crust grows on the two flanks; asymmetric prescribed motion moves the
  ridge at half stage; stationary, converging and purely sliding segments do not
  accrete ocean crust.
- [Part V Supplement: Using GPlates](https://worldbuildingpasta.blogspot.com/2020/06/an-apple-pie-from-scratch-part-v.html):
  persistent polylines reference both adjacent plates and start at rifting.
  Common reconstruction now joins ordinary junctions, including later branch
  births, and current-time export uses those same joined polylines.
- [Part VIIb: Erosion and Deposition, Mid-Ocean Ridge](https://worldbuildingpasta.blogspot.com/2022/02/an-apple-pie-from-scratch-part-viib.html):
  cooling crust deepens with age; slow axes have valleys and shoulders, faster
  axes have crests; authored transform offsets are preserved. Ordinary generated
  ridge relief remains underwater and does not introduce volcanic island chains.

The numerical subsidence curve, 2-4 cm/year morphology blend, deadband and sampling
budgets are implementation choices, not formulas provided by the blog. The source
note makes this distinction explicit.

## Review findings resolved

- Historical ridges remain visible when their axes have been rerouted to children
  born later. Current-time exports resolve those references and captured-crust
  motion links to the ancestor alive at export time.
- Valid detailed cut paths of 256 or more vertices are coarsened rather than
  silently discarded.
- Local polygon occupancy and nearest local boundaries orient ridge normals even
  on fragmented plates whose remote components invert their global centroids;
  this also works after exporting an already offshore ridge.
- Later branches share reconstruction times and join the existing ridge, removing
  a reproduced approximately 109 km gap in an unequal-rate junction.
- Current-time export uses joined ridge geometry and the selected sampling interval,
  preserves seafloor formation ages and motion, and separates captured IDs from
  newly generated IDs.
- Continuous mode suppresses the older midpoint overlay. Derived ridge and
  transform lines are excluded from polygon-overlap boundary detection.

## Independent validation

Read the relevant implementations and callers. Executed separate Vite SSR
reproductions for historical ancestry, detailed paths, fragmented flank geometry,
offshore current-time snapshots, staggered junctions and joined snapshot geometry.
After fixes, fragmented snapshots continued with one active ridge and paired new
crust; staggered junction endpoints and rebased endpoints agreed; ancestry exports
retained their axis, resolved it to the live parent, linked captured crust to that
parent and continued accreting before its death cutoff.

Behavior-test coverage also addresses symmetric/asymmetric opening, reversal,
transform motion, lifecycle cutoffs, dateline/pole geometry, immutable inputs,
deterministic revisits, motion edits, interval bounds and persistence. Heightmap
tests exercise real d3 projections with a recording canvas context. The parent
agent separately reported a passing full test suite, build, typecheck and lint,
and inspected actual browser-generated slow/fast heightmaps. Those final broad
checks and browser inspection were not independently repeated by this reviewer.

## Coverage limits

No quantitative validation against a geological reconstruction dataset; no mantle
or sediment simulation, hotspot islands, slab consumption or unstable-junction
microplate solver. The existing scenario-specific timeline-trimming export branch
was not separately exercised by this review. Browser interaction and rendered
pixels were verified by the implementation agent, not this reviewer.

## Reviewed core file fingerprints

SHA-256 at the final code review; subsequent changes require proportionate review.

| File | SHA-256 |
| --- | --- |
| `src/systems/MidOceanRidgeSystem.ts` | `103C1FA5958AD2D529972A9B604DCA628928486AD248C4BBB60CFDD523291A7A` |
| `src/SimulationEngine.ts` | `D64F2E5D98FFFFA5C279A79B0FABEB31240F1358BD2FD1E5202E188E65873880` |
| `src/systems/HeightmapGenerator.ts` | `F2EBD6693943847E43D5A2315A455277FD90A1EB2EB5C572E4CCB91B522FF977` |
| `src/export.ts` | `A48598605D4D931AD3EC13AC75839864CD9CEF25B0869C53798992032654F532` |
