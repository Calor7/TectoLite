# Mid-ocean ridges in TectoLite

Source review: 8 October 2026. Implements the existing `continuous` experimental
strategy, shown as **Settings → Experimental → Mid-Ocean Ridges + Seafloor**.
Split a plate, give the children different Euler-pole motions, enable this strategy,
and play or scrub. Heightmap export displays the associated underwater relief.
The saved option value and default (`off`) remain compatible with older projects.

## Source guidance

- [Worldbuilding Pasta, Part Va: Tectonic History (January 2020)](https://worldbuildingpasta.blogspot.com/2020/01/an-apple-pie-from-scratch-part-va.html):
  new ocean crust forms roughly symmetrically on the two adjacent plates, so a
  ridge migrates at their relative midpoint. A stationary plate next to a plate
  moving west at 10 cm/yr gives a ridge moving west at 5 cm/yr. Transform motion
  creates no new crust. Ridges are passive consequences of prescribed plate
  separation; this implementation does not use them to drive plate motion.
- [Part V Supplement: Using GPlates (June 2020)](https://worldbuildingpasta.blogspot.com/2020/06/an-apple-pie-from-scratch-part-v.html):
  persistent ridge polylines start at rifting, reference both flanking plates,
  and use Half Stage Rotation. Junction extensions need separate attention;
  neighboring ridge sections do not always meet automatically.
- [Part VIIb: Erosion and Deposition — Mid-Ocean Ridge (February 2022)](https://worldbuildingpasta.blogspot.com/2022/02/an-apple-pie-from-scratch-part-viib.html):
  young hot seafloor is buoyant; older crust cools, subsides and becomes smoother.
  Fast spreading usually produces a central crest; slower spreading often
  produces an axial rift valley and parallel relief. Transform faults offset
  ridges into zigzags. The typical ridge crest is about 2.6 km below sea level,
  roughly 2 km above the abyssal floor. Routine ridges do not form island chains.

## Implementation and approximations

`src/systems/MidOceanRidgeSystem.ts` is a pure reconstruction. Birth polylines and
prescribed motion are authoritative; legacy isochron and junction playback caches
are preserved for save compatibility but are not used to generate new geometry.
The same path serves scrubbing and playback, so revisiting a time or changing an
Euler pole cannot accumulate stale strips. Derived entity IDs are deterministic.

Each motion step uses the midpoint of the two rotation quaternions (half stage),
including inherited motion, link handoffs and pre-birth parent lineage. The model
samples spherical polylines and projects relative velocity onto the local normal.
Only positive normal opening produces paired strips. Along-axis motion appears as
transform segments and adds no crust. Existing authored offsets are preserved;
the system does not invent random zigzags. A 0.01 cm/yr numerical deadband suppresses
floating-point slivers; it is an engineering tolerance, not a geological threshold.

Older and younger strip edges move with their respective flank, and their actual
formation-time range is stored for age-dependent depth. Freezing or killing an
axis stops accretion at that timestamp while the old strips continue moving.
Current-time project exports retain the old seafloor as moving snapshots, shift
its formation times to preserve age, and reconstruct the new ridge origin at the
export time. Full-timeline saves retain authoritative axes and motions.

Nearby endpoints share a sampling timeline and are matched at new branch births; a tangent-plane intersection is used
to close ordinary ridge junctions, including unequal opening rates and staggered births. This is a
geometric approximation, not a triple-junction stability solver. New microplates,
slab consumption, mantle dynamics and hotspot intersections are not simulated.
Plate motion and subsequent topology edits remain user-authored. Initial split
lines can represent continental rifts before a basin opens; the generated relief
is always underwater and does not create volcanic islands.

The illustrative depth curve is `2600 + 2200*(1-exp(-sqrt(ageMa)/5))` meters below
sea level. It approaches 4.8 km in old seafloor. Local relief blends a central
valley with flanking shoulders at slow rates into a low crest at fast rates;
the blend spans full spreading rates of 2–4 cm/yr. The blog supplies qualitative
behavior and approximate dimensions, **not these equations or thresholds**.
Sediment smoothing and variable volcanic pulses are represented only by the
broad thermal background and local relief; detailed abyssal hills are not modeled.

Heightmaps remain relative grayscale artwork, not calibrated elevation rasters.
Geographic buffers keep widths in km and clip at map seams and the globe horizon.
Land covers the underwater buffer at coasts. Ocean shades stay below the
continental base; open geological lines are never filled as continental polygons.

Regular temporal samples are at most 5 Ma apart (or finer requested intervals),
with motion handoffs included. Extreme durations coarsen regular samples to a
256-step budget. Detailed lines are sampled/coarsened to a finite spatial budget;
antipodal segments are rejected because their shortest path is ambiguous.
These limits favor interactive worldbuilding, not high-precision reconstruction.

## Verification

Independent behavior tests cover symmetric/asymmetric spreading, co-motion,
transforms, convergence and reversal, frozen/dead axes, seam/pole coordinates,
rewinding, motion edits, stable IDs, immutable inputs, interval bounds and save
round trips. Heightmap tests use real d3 geographic projections to verify relative
shades, slow/fast morphology, seam/horizon clipping and open-line handling.
An independent agent reviews the final changes against the three blog articles.