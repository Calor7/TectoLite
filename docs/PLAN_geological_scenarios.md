# Editable geological scenario templates

Status: implemented, independently reassessed, and verified for v1.1.0.

## Product plan

Keep the four existing static Earth/Pangaea starts and add four playable variants (Covers and Covers + Plates for each era). Past: 200 Ma to present. Future: present to +500 million years. These are editable native projects, including lifecycle transitions, changing motion, shape evolution, new land and timed geological features, with a chapter guide and offline source notes.

Use a curated set of major landmasses. Historical motion uses representative reconstruction plate IDs from the bundled rotation file; merged modern outlines are not a complete paleogeographic reconstruction. Coastline deformation, discrete lifecycle dates and emergence are authored teaching examples. Future motion illustrates Pacific-closure Amasia; the map, schedule and post-assembly breakup are authored possibilities, not a consensus forecast.

## Independent reassessment incorporated

- Do not reuse the old linear Euler-angle/rate preprocessing. Resolve reference chains and reference switches, SLERP finite rotations, and convert chronological increments as Q(younger) × inverse(Q(older)). Missing/cyclic chains fail preprocessing.
- Preserve internal elapsed time. Show geological age in the chapter guide and label scenario editor time as elapsed Myr, with the age conversion visible.
- Implement real parent death/child birth/parentPlateIds events. Preserve matching geometry at split/fusion boundaries and align optional detail layers.
- Share interpolated polygon derivation between the rotation module and SimulationEngine; include interpolation in the derivation cache signature. Only interpolate matching topology in a common moving frame.
- Preauthor land/feature stages rather than relying on simulation-step-dependent generation. Direct jumps, playback and backward scrubs must agree.
- Validate and preserve scenario metadata and interpolation through save/open and undo. Keep dataset size within normal project limits.

## Delivery sequence

1. Generate a compact, reproducible source asset from the existing outlines and resolved finite rotations.
2. Add opt-in shape interpolation, native scenario builders, sources and chapter metadata.
3. Add the static/timeline chooser and compact chapter guide with jump and play controls.
4. Verify rotations, transition continuity, deterministic scrubbing, serialization, edits, layer alignment, load/scrub cost, globe/dateline appearance and narrow UI.
5. Commit, package Windows, publish the release and deploy the matching browser build.

## Sources and limits

- Bundled `gplates_references/1000_0_rotfile.rot`: reconstruction poles carry their own references. The bundled modern/200 Ma exports list additional rotation files that are not present. Do not force agreement across differing frames or claim these inputs reproduce the original export exactly.
- [EarthByte GPlates models](https://gwsdoc.gplates.org/models/): finite rotations and reconstruction-model context.
- [Huang, Li & Zhang (2022), Will Earth's next supercontinent assemble through the closure of the Pacific Ocean?](https://pmc.ncbi.nlm.nih.gov/articles/PMC9743166/): support for Pacific-closure assembly under their model assumptions, not an exact future coast map or a universal consensus.
- [USGS, The Himalayas](https://pubs.usgs.gov/gip/dynamic/himalaya.html): India–Asia collision and mountain-building context. Timing of collision is approximate and model-dependent.

The geological examples demonstrate authoring tools. They do not solve mantle convection, conserve crustal mass during illustrative deformation, predict sea level, or calculate exposed land from lithospheric production.

## Implementation and review results

- Four native, offline timelines are exposed separately from the original static templates. Historical rotations resolve reference circuits; five independent sample points reproduce the bundled 200 Ma export to within 0.000001 degree.
- Compatible shape stages use great-circle interpolation in their moving frame. Splits and fusions retain matching boundary snapshots, with linked carrier/craton lifecycles synchronized.
- The reassessment identified and corrected lifecycle retiming/deletion, deterministic parent-feature derivation, future-successor retention on trimmed saves, future feature anchors, and label rebasing.
- Amasia assembly and its later breakup are authored geometry. Modern outlines are simplified; representative craton attachments and process markers do not claim full boundary reconstruction.
- The scripted endpoint pauses automatically. Users can save the remainder or branch the current geometry into a fresh project. Editing lifecycle dates replaces the original chapter narrative with an explicitly edited timeline.

Regenerate the compact source asset with `node scripts/build-scenario-data.cjs`. Validate finite rotations with `npm run test:scenario-data`; `npm run verify` runs the full release checks.

Release validation: 242 application tests and four finite-rotation checks pass; lint, TypeScript, production build, and the coverage ratchet pass. Browser checks cover the Pangaea start/modern endpoint, future assembly, chapter navigation, automatic pause, fresh-world branching, and a 390px-wide guide without horizontal overflow. Existing lint warnings and the main-bundle size advisory remain.
