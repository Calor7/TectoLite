# TectoLite Performance Baseline

Date: 2026-07-10

Measurement harness: `?perf` enables the live overlay. `?perf=bench1` loads the deterministic benchmark world, and `?perf=bench3` loads the stress variant.

## Scenarios

| Scenario | World | Metric | Baseline | After TASK_07 | After TASK_08 | After TASK_09 | After TASK_10 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Idle | bench1 | frame avg / p95 | 3.9 ms / 5.2 ms | 0.4 ms / 0.1 ms | 0.4 ms / 0.2 ms | command verified; browser scrub capture timed out | command verified; heap capture pending |
| Playback | bench1 | frame avg / p95 | pending manual capture | - | - | - | - |
| Time scrub | bench1 | frame avg / p95 | pending manual capture | - | - | - | - |
| Undo push | bench1, 50 edits | ms / heap method | pending manual capture | - | - | - | - |

## Machine

Initial idle smoke capture used the Codex in-app browser against the Vite dev server at `http://127.0.0.1:5173/?perf=bench1`. Overlay reported 102 plates and 72 rings. Add CPU, memory, and browser details when doing the full benchmark pass.

## Notes

- Harness landed before optimization tasks.
- TASK_07 idle smoke capture reported `render 0.0 ms` after the dirty flag settled.
- TASK_08 idle smoke capture remains `render 0.0 ms`; the projection cache mainly affects dirty frames during scrub/playback.
- TASK_09 command verification passed; browser slider automation timed out before producing a trustworthy scrub number.
- TASK_10 command verification passed; structural history now clones mutable owner boundaries while sharing heavy geometry arrays. Heap snapshot/manual 50-edit memory capture remains pending.
- Do not fill optimization columns from different worlds or settings.
- WebGL fence verdict: not opened by current evidence. No verified bench1 playback result below 30 fps was captured after TASK_07 through TASK_10.
