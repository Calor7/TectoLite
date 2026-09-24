Method: dual-agent (A: design_review · B: detector_review)

# TectoLite app UX critique — 24 September 2026

Target: `src/ui/AppTemplate.ts` and the running TectoLite editor. The design review used a fresh production tab for the first-run state and a temporary local preview for blank, example, linking and narrow-screen workflows. The review did not alter production recovery data.

## Design health before this pass

| # | Nielsen heuristic | Score / 4 | Main observation |
| --- | --- | ---: | --- |
| 1 | Visibility of system status | 3 | Tool hints, linking stages and save status are visible. |
| 2 | Match with the real world | 2 | Covers, cratons, Euler poles and Ma need explanation at first use. |
| 3 | User control and freedom | 3 | Undo, Cancel and Clear selection are available. |
| 4 | Consistency and standards | 3 | Controls are coherent, but template and entity language varies. |
| 5 | Error prevention | 3 | Linking confirms roles and time before applying. |
| 6 | Recognition rather than recall | 2 | Global icon controls and hidden panel content require discovery. |
| 7 | Flexibility and efficiency | 3 | Hotkeys and Explorer search help experts; panel travel slows work. |
| 8 | Aesthetic and minimalist design | 3 | The globe has focus, but the shell and tool rail are dense. |
| 9 | Help with error recovery | 2 | Undo exists; complex selection and world mistakes remain hard to diagnose. |
| 10 | Help and documentation | 3 | Help and tool guidance exist, but first-run concepts need context. |
| | **Total** | **27/40** | Functional editor with clear room to improve first use. |

The globe, graticule, Ma timeline and plate-motion model are specific to TectoLite. The surrounding dark panels, uniform choice buttons and blue control outlines could belong to many editors. Product character is strongest while working on the map and weakest at the first decision. This is a workflow and hierarchy problem more than a need for decorative effects.

## What works

- The globe and geological time controls make the subject tangible immediately.
- Draw changes the canvas instruction and tool controls together, so the next action is clear once selected.
- Link states the leader, follower and start time, offers Swap and Cancel, and checks the relationship before applying it.

## Priority issues and changes

| Severity | Issue and effect | Action |
| --- | --- | --- |
| P1 | Blank starts with Select active and asks the user to select a nonexistent plate. | Blank now opens in Draw with an explicit first-plate prompt. |
| P1 | Six equal-weight first-run choices force file-structure terminology into the first decision. | Welcome now offers Draw, Explore, or Open; examples move to a second choice with Covers explained. |
| P1 | Linking can open Tool Options, Explorer and Properties together, squeezing the map. | Link/Fuse temporarily put Properties away and restore it afterward; the workflow panel opens immediately. At phone width it becomes a bottom sheet. |
| P2 | Every Explorer group displays seven tiny actions, including destructive ones, beside a shortened name. | Visibility and lock remain direct; the other actions live in a named menu. Group controls have explicit accessible names and larger touch targets. |
| P2 | Ma and other geology terms require recall from the manual. | The example chooser explains Covers and plates; the timeline now explains Ma on hover. More in-place definitions remain useful. |
| P2 | Global icon controls are hard to recognize, especially Help. | Help keeps its word label at standard desktop width. Other actions still depend on tooltips. |
| P3 | Toasts overlap the centered canvas instruction. | Notifications now sit above the timeline at the right. |

Jordan, a first-time creator, could previously choose Blank and then face an empty Select instruction. Maya, a worldbuilder, could choose the 693-entity Earth example without understanding Covers versus Plates. Alex, an expert, has shortcuts and a precise Link sequence but can lose most of the map to three open panels. The implemented changes target those exact moments. The example's 693 entities and its colorful, flat regions still merit a compact map legend and a clearer suggested first inspection; those are larger follow-up design decisions.

## Assessment limits

The deterministic Impeccable scanner could not start. With `IMPECCABLE_HOME` pointed at a writable workspace cache, its engine download failed from the plugin's GitHub release URL. No CLI finding count or rule-level result is available. Browser inspection succeeded, but its evaluation API is read-only, so overlay injection stopped at the mutation preflight and no user-visible detector overlay exists. The temporary cache, browser tabs and preview started by the two assessments were cleaned up. The parent task used its own local preview for implementation QA. `.impeccable/critique/ignore.md` was absent; the plugin's slug/persistence helper was unavailable with the same engine failure, so this source document records the critique.
