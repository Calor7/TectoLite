# Large-save selection freeze

## Reproduction and cause

Tested the local Strive rebuilt (257 plates, 31 MB) and Asterra rebuilt
(119 plates, 7.4 MB) projects through the native JSON import UI in Chromium.
These generated saves live under `output/` and are not test-suite fixtures.

On the original code, load Strive, select Boreal assembly roots, then click empty
ocean to clear selection. `TimelineSystem.render(null)` constructs the entire
world history: 15,381 event rows, including every collapsed editing form. Form
preparation then scans the live controls. This blocked the renderer long enough
that subsequent browser commands timed out. It also happens for label and
fixed-hotspot selections, which have no selected plate.

Selection separately rendered history in both Properties and the selection
handler. Canvas clicks issued another UI update for the edge. Opening a dock
also rebuilt Explorer, Properties and History on every canvas resize during
its animation. Instrumentation showed repeated history renders during that
transition. Selecting the 219-entry Boreal assembly roots history alone took
80.6 ms and 109.3 ms in two successive history renders, before resize work.

## Correction

- Render at most 50 history rows, with Previous/Next access to all events.
- Build each editing form on first expansion; retain its controls when closed
  and reopened. Prepare its fields before attaching them to the live document.
- Refresh history once at the Properties update boundary, including clearing
  selection, label selection, import, undo and redo.
- Deliver plate/feature/edge selection together in one canvas callback.
- Redraw the canvas without rebuilding panels for camera-only state changes.

No saved geometry, motion, or history is removed or simplified.

## Verification

With the same instrumented development page and unchanged Strive save, clearing
selection produced 50 rows and zero collapsed form inputs. World-history render
took 9.4 ms; initial full-world render took 12.6 ms. These are single local
measurements of the history render, not whole-interaction latency guarantees.
The selection that previously took two 80–109 ms history renders fell below the
instrumentation's 5 ms reporting threshold. Dock resizing no longer emitted
repeated history renders.

Asterra selection remained responsive at 0 and 500 Myr; clearing selection at
500 Myr also remained responsive.
Its 1,047-event world history and 94-entry Lantern spreading centre history
remained bounded to 50 rows; paging exposed the remaining entries. Strive's
second history page opened an individual motion editor with four inputs.

Regression tests exercise 20,200 world events, bounded collapsed DOM, complete
page traversal, page preservation/reset/clamping, later-page editing/deletion,
and single-notification canvas selection. All six new tests fail against the
original implementation and pass with the fix. The 262-test suite, TypeScript,
ESLint (existing warnings only), scenario-data checks, Electron syntax checks,
and production build passed.

## Follow-up performance audit

Explorer Actions reproduced the same unbounded-list pattern: Strive created
5,358 rows whenever Actions was open, including each subsequent selection.
It now mounts 50 action buttons with paging. Filters reset the page and redraw
only Actions. Selecting an action preserves the page; shrinking the history
clamps it. Four redundant Explorer refreshes were also removed from import,
recovery and duplication paths.

The simulation's cache signature formatted every historical number with
`toFixed(4)` on every scrub/frame. It now hashes numeric bits directly, preserving
in-place mutation detection without allocating formatted coordinate strings.
The original rounding also missed edits smaller than 0.00005; a regression test
confirmed stale cache reuse after a 0.00001-degree edit before the correction.
The signature now changes for those geometry and motion edits, and returns to
its original value after undoing them.

Motion integration rescanned the entire earlier segment prefix for each time
interval. It now advances one index through sorted segments. A 1,000-segment
regression went from 504,496 timestamp reads to below the 25,000-read budget.
Rotation-only calls also avoid sorting geometry stages that they never use.
Duplicate timestamps, unsorted inputs, backwards motion and linked rotations
remain covered.

Local Node measurements using the unchanged, migrated saves and
`SimulationEngine.setTime`, with the same sequence 0/100/500/0/100/500:

| Work | Before | After |
| --- | --- | --- |
| Strive first three scrubs | 205.6–225.0 ms | 14.2–27.5 ms |
| Strive repeated three scrubs | 179.5–186.9 ms | 10.1–12.2 ms |
| Asterra first three scrubs | 10.9–11.8 ms | 2.7–6.0 ms |
| Asterra repeated three scrubs | 9.5–14.3 ms | 1.4–4.1 ms |
| 10,000-segment rotation, mean of five | 93.6 ms | 3.5 ms |

These measure simulation work, excluding browser rendering and input latency.
The temporary measurement harness is retained locally under ignored `release/`;
generated saves and `output/` are not committed. Permanent tests generate their
own data. The expanded suite passes 271 tests and the unchanged release coverage
thresholds. The dependency audit is clean after compatible patches, including
Electron 43.7.7.

Final browser verification also committed a motion-rate edit on Strive history
page two and undid it, restoring 0.1 from 0.2 while retaining bounded panels.

The final Windows build produced portable and NSIS installer executables. The
packaged application passed its isolated recovery-storage and GeoPackage export
smoke test (57,344-byte output). Its archived renderer matches the final
production build. Local packaging used the already downloaded Electron runtime
and the unchanged Windows icon generated for 1.1.3 to work around local
archive-renaming and icon-converter failures. No production configuration was
weakened. A fresh-machine installer walkthrough was not performed.
