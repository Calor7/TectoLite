# TASK_20 — Replace sql.js (WASM SQLite) with Lighter GeoPackage Writer

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/GeoPackageExporter.ts` (~471 lines) uses `sql.js` (WASM SQLite, ~1MB) to serialize data to OGC GeoPackage (.gpkg) format. `sql.js` is a heavy runtime dependency pulled in solely for this one export format. It's loaded via dynamic `<script>` injection + WASM, with a singleton promise and no error recovery.

The goal is to replace `sql.js` with a lighter-weight GeoPackage writer that doesn't require a full SQLite engine.

## Task

### 1. Assess GeoPackage spec requirements
Read `src/GeoPackageExporter.ts` fully. Catalog what it writes:
- `gpkg_contents` table
- `gpkg_geometry_columns` table
- `gpkg_spatial_ref_sys` table
- `gpkg_tile_matrix` table (for raster)
- Vector layers (plates, features) with WKB geometry
- Optional raster layer (single tile heightmap)

Determine the minimum SQLite features needed: table creation, row insertion, binary blob storage, integer/string/real types. No queries, no joins, no indexes needed — it's write-only.

### 2. Evaluate replacement options
Research and choose one:

**Option A: Hand-rolled SQLite writer**
- SQLite file format is documented (https://www.sqlite.org/fileformat.html). A minimal write-only implementation needs: file header, page management, B-tree leaf pages for table data, the `sqlite_master` table.
- Pros: zero dependencies, ~50-100KB of code.
- Cons: complex to implement correctly, risk of corrupt files, spec compliance is hard.
- **Verdict**: Too risky for a single task. Only choose if you have deep SQLite format knowledge.

**Option B: `@ngageoint/geopackage` (geopackage-js)**
- A purpose-built GeoPackage library for JavaScript.
- Pros: spec-compliant, handles WKB/SRS/tiles correctly.
- Cons: may itself depend on sql.js or similar — check bundle size.
- **Verify**: check if it's lighter than the current sql.js setup.

**Option C: Move GeoPackage export to a server-side / Electron main process**
- Use Node.js `better-sqlite3` (native, not WASM) in the Electron main process. The renderer sends data via IPC, the main process writes the .gpkg file.
- Pros: `better-sqlite3` is fast and spec-compliant, no WASM in renderer.
- Cons: requires IPC plumbing, only works in Electron (not web build).
- **Recommended if Electron-only**: this is the cleanest approach.

**Option D: Keep sql.js but lazy-load it**
- Don't replace — just ensure sql.js is dynamically imported ONLY when GeoPackage export is triggered, so it never loads unless needed.
- Pros: minimal change, no risk.
- Cons: still a heavy dep, just deferred.
- **Fallback if A/B/C are too complex**.

### 3. Implement the chosen option
Based on your evaluation:

**If Option C (Electron main process)**:
1. Add `better-sqlite3` to `dependencies` (it's a native module — works in Electron main).
2. Create `electron-geopackage.cjs` — a main-process module that receives plate data via IPC and writes a .gpkg file.
3. Update `preload.cjs` to expose an `exportGeoPackage(data, filePath)` IPC bridge.
4. Update `src/GeoPackageExporter.ts` to send data via IPC instead of using sql.js in the renderer.
5. Remove `sql.js` from `dependencies` and `public/vendor/sql.js/`.

**If Option D (lazy-load)**:
1. Change the `sql.js` import from static to dynamic: `const { default: initSqlJs } = await import('sql.js')` inside the export function.
2. Remove the `<script>` injection approach — use the npm package with dynamic import.
3. Verify the bundle doesn't include sql.js in the main chunk.

### 4. Update `package.json`
- Remove `sql.js` from `dependencies` (if Option C) or keep it (if Option D).
- Add `better-sqlite3` to `dependencies` (if Option C) + `@types/better-sqlite3` to `devDependencies`.
- Remove `public/vendor/sql.js/` directory (if Option C).

### 5. Test the export
- Export a simple world to .gpkg and verify it opens in QGIS or a GeoPackage viewer.
- Verify vector layers (plates, features) are correct.
- Verify the optional raster/heightmap layer (if implemented).

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass, and the main bundle should be smaller (if Option C/D)
4. **Manual test**: Export to GeoPackage, open in QGIS — verify data integrity.
5. `du -sh dist/` — bundle size should be reduced (if Option C/D).

## Notes
- **This is the riskiest task** — GeoPackage spec compliance is hard. If the hand-rolled approach produces corrupt files, users lose data.
- **Recommended**: Option C (Electron main process with `better-sqlite3`) — it's the cleanest, most reliable, and removes WASM from the renderer entirely. The downside is it only works in Electron, not the web build. If web-build GeoPackage export is needed, fall back to Option D (lazy-load sql.js).
- If neither Option C nor a lighter library works, **Option D (lazy-load) is the safe fallback** — it doesn't remove the dependency but at least defers loading.
- The `loadSqlJsFactory` singleton in `GeoPackageExporter.ts` has no error recovery — if WASM fails to load, the export silently fails. Any replacement should handle errors gracefully.
- Check `electron-builder.yml` — if `better-sqlite3` is used, it needs to be rebuilt for Electron's Node version (`electron-rebuild`).