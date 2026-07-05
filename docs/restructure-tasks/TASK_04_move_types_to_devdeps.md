# TASK_04 — Move @types/* to devDependencies

## Context
TectoLite is a tectonic plate simulation app (TypeScript + Vite + Electron). Repo at `c:\GIT\TectoLite`.

In `package.json`, `@types/d3` and `@types/d3-geo` are listed under `dependencies` instead of `devDependencies`. These are TypeScript type definition packages — they're only needed at build/compile time, not at runtime. Shipping them in the Electron bundle adds unnecessary bloat.

## Task

### 1. Move type packages to devDependencies
In `package.json`:
- Move `"@types/d3": "^7.4.3"` from `dependencies` → `devDependencies`
- Move `"@types/d3-geo": "^3.1.0"` from `dependencies` → `devDependencies`
- Keep them in alphabetical order within `devDependencies` (the existing devDeps are sorted).

### 2. Verify runtime dependencies are correct
After the move, `dependencies` should contain only:
- `d3-delaunay`
- `d3-geo`
- `d3-geo-projection`
- `polygon-clipping`
- `sql.js`

(If `sql.js` has been replaced by TASK_20, it won't be there — that's fine.)

### 3. Reinstall to update lockfile
Run `npm install` to update `package-lock.json`.

## Verification
1. `npx tsc --noEmit` — must pass (types are still available in dev)
2. `npx vitest run` — must pass
3. `npx vite build` — must pass (Vite bundles runtime deps; types are dev-only)
4. Check `package.json`: `@types/d3` and `@types/d3-geo` are in `devDependencies`, NOT in `dependencies`.

## Notes
- This is a low-risk change. Type packages are never needed at runtime — they're consumed by `tsc` and the IDE.
- If `npm install` produces a diff in `package-lock.json`, that's expected and should be committed.
- Do NOT move `d3-geo`, `d3-geo-projection`, or `d3-delaunay` — those are runtime dependencies used by the app.