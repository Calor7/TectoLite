# TASK_22 — Fixed-Timestep Deterministic Playback

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/SimulationEngine.ts` advances time using wall-clock delta: `deltaMa = (deltaMs / 1000) * timeScale` where `deltaMs` comes from `performance.now()`. This makes playback **non-deterministic**: frame drops cause smaller deltas, tab-throttling slows time, and the same playback produces different results on different runs.

A fixed-timestep accumulator decouples simulation time from wall-clock time, making playback reproducible.

## Task

### 1. Read the current tick loop
Read `src/SimulationEngine.ts` around lines 85-280 (toggle, tick, update). Understand:
- How `isRunning` controls the RAF loop.
- How `deltaMa` is computed.
- How `currentTime` advances.
- How `timeScale` factors in.

### 2. Implement a fixed-timestep accumulator
Replace the variable-delta tick with a fixed-timestep accumulator:

```typescript
private static readonly FIXED_DT = 0.1; // 0.1 Ma per simulation step
private accumulator = 0;

private tick = (now: number): void => {
    if (!this.isRunning) return;

    const elapsed = now - this.lastTime;
    this.lastTime = now;

    // Convert wall-clock ms to simulation Ma, then accumulate
    const simMaElapsed = (elapsed / 1000) * this.getState().world.timeScale;
    this.accumulator += simMaElapsed;

    // Step the simulation in fixed increments
    let steps = 0;
    const MAX_STEPS = 10; // prevent spiral of death
    while (this.accumulator >= SimulationEngine.FIXED_DT && steps < MAX_STEPS) {
        this.step(SimulationEngine.FIXED_DT);
        this.accumulator -= SimulationEngine.FIXED_DT;
        steps++;
    }

    // If we hit MAX_STEPS, drop the remaining accumulator (avoid catching up
    // after a long stall — better to slow down than spiral)
    if (steps >= MAX_STEPS) {
        this.accumulator = 0;
    }

    this.rafId = requestAnimationFrame(this.tick);
};

private step(dt: number): void {
    const state = this.getState();
    const newTime = state.world.currentTime + dt;
    this.update(state, dt, newTime);
}
```

### 3. Make `update` deterministic
`update()` currently takes `deltaMa` computed from wall-clock. With the accumulator, it receives a fixed `dt` (0.1 Ma). Verify that `update()` and `calculatePlateAtTime` are pure given `(state, dt, newTime)` — they should be, since `calculatePlateAtTime` is time-based (computes position at `newTime`), not delta-based.

The key insight: `calculatePlateAtTime(plate, newTime)` computes geometry at an absolute time, not by integrating from the previous frame. So determinism is about **which time values are sampled**, not about integration error. With fixed timestep, the sampled times are `t, t+0.1, t+0.2, ...` — reproducible regardless of frame rate.

### 4. Handle time scrubbing
`setTime(targetTime)` (scrubbing) is already deterministic — it computes at an absolute time. No change needed. But after scrubbing, reset the accumulator: `this.accumulator = 0;` so playback continues from the scrubbed time cleanly.

### 5. Handle time scale changes
When the user changes `timeScale` (playback speed), the accumulator approach naturally handles it: higher `timeScale` → more sim-Ma per wall-clock ms → more fixed steps per frame. No special handling needed.

### 6. Add a deterministic replay test
Create `src/SimulationEngine.test.ts` (or add to it if TASK_18 created it):
- Create a world with 2 plates, known motion.
- Run 100 fixed steps from time 0 to time 10.
- Record the final state (plate positions).
- Reset, run the same 100 steps again.
- Verify the final state is identical (bit-for-bit, or within floating-point tolerance).
- Run with "simulated frame drops" (vary the elapsed time per step) — verify the final state is still identical (deterministic).

### 7. Add a "deterministic mode" flag (optional)
For full reproducibility (e.g. for testing or recording), add a `deterministic: boolean` option:
- When `true`: ignore wall-clock entirely, step at exactly `FIXED_DT` per `tick` call (one step per frame, no accumulator).
- When `false` (default): use the accumulator approach (smooth playback, deterministic sampling).

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass (determinism test added)
3. `npx vite build` — must pass
4. **Determinism test**: Run the same simulation twice — identical final state.
5. **Frame drop test**: Simulate frame drops (throttle the RAF) — playback slows but produces the same result as full-speed.
6. **Manual test**: Play a simulation, pause, scrub back, play again — motion should be consistent and smooth.

## Notes
- `FIXED_DT = 0.1` Ma means 10 simulation steps per Ma. At `timeScale = 1` (1 Ma/sec), that's 10 steps/sec. At `timeScale = 10`, that's 100 steps/sec — may be too many. Adjust `FIXED_DT` or `MAX_STEPS` based on performance.
- The `MAX_STEPS` cap prevents the "spiral of death": if the sim falls behind (e.g. tab was inactive), it doesn't try to catch up with hundreds of steps. Instead, it drops the accumulated time and continues from now.
- `calculatePlateAtTime` is the expensive part. With fixed timestep, it's called `steps` times per frame. If `steps` is high (fast timeScale), this could be slower than the current variable-delta approach (which calls it once per frame). Monitor performance.
- If TASK_09 (memoize plate derivation) is done, the cache helps here: within a single frame, multiple fixed steps at different times won't cache-hit (different times), but scrubbing back to a previously-visited time will.
- Floating-point determinism: JavaScript `number` is IEEE 754 double — deterministic across runs on the same architecture. Across different browsers/architectures, there may be tiny differences. For strict cross-platform determinism, consider fixed-point math (overkill for this app).