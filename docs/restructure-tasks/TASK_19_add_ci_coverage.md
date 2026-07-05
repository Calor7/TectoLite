# TASK_19 — Add CI Workflow + Coverage Gate

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`, hosted on GitHub at `Calor7/TectoLite`.

There is **no CI configuration**. The `package.json` has a `verify` script (`npm run typecheck && npm run test && npm run build`) but it's not wired to any CI. There's no coverage reporting or gate.

## Task

### 1. Create GitHub Actions workflow
Create `.github/workflows/verify.yml`:

```yaml
name: Verify

on:
  push:
    branches: [main, 'Automatation-*']
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

### 2. Add coverage reporting
Update `package.json` scripts:
```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage",
    "test:coverage:check": "vitest run --coverage -- --coverage.thresholds.lines=10 --coverage.thresholds.branches=10"
  }
}
```

Install coverage provider:
```bash
npm install -D @vitest/coverage-v8
```

Update `vite.config.ts` (or create `vitest.config.ts`) with coverage config:
```typescript
test: {
    coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        exclude: [
            'node_modules/',
            'dist/',
            'release/',
            '**/*.test.ts',
            'src/types.ts',        // type definitions only
            'src/**/types.ts',
            'electron-main.cjs',
            'preload.cjs',
        ],
        thresholds: {
            lines: 10,
            branches: 10,
            functions: 10,
            statements: 10,
        },
    },
},
```

### 3. Add coverage to CI
Add a coverage step to `.github/workflows/verify.yml`:
```yaml
      - run: npm run test:coverage
```

The coverage thresholds will fail the CI if coverage drops below 10% (start conservative, ratchet up over time).

### 4. Add a lint step to CI
```yaml
      - run: npm run lint
```
If `npm run lint` currently produces warnings (not errors), configure it to fail on errors only (the existing eslint config has `no-explicit-any: 'warn'` — that's fine, warnings don't fail CI).

### 5. Add a PR template
Create `.github/pull_request_template.md`:
```markdown
## Summary
Brief description of what this PR changes.

## Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes
- [ ] Manual testing performed (describe below)

## Coverage
- [ ] Tests added for new functionality
- [ ] Coverage does not decrease
```

### 6. Add badge to README
Add a CI status badge to `README.md`:
```markdown
[![Verify](https://github.com/Calor7/TectoLite/actions/workflows/verify.yml/badge.svg)](https://github.com/Calor7/TectoLite/actions/workflows/verify.yml)
```

## Verification
1. `npm run typecheck` — passes locally
2. `npm run test:coverage` — runs, produces coverage report, meets 10% threshold
3. `npm run build` — passes
4. Push to a branch — GitHub Actions workflow triggers and passes.
5. Verify the coverage report shows ≥ 10% lines/branches/functions/statements.

## Notes
- Start with a **10% coverage threshold** — conservative, won't block PRs, but prevents coverage from dropping. Ratchet up over time (15%, 20%, etc.).
- `@vitest/coverage-v8` is the fast V8-based coverage provider (no Istanbul instrumentation overhead).
- The `npm ci` command in CI requires `package-lock.json` to be committed. Verify it exists.
- If the repo uses a different Node version, update `node-version` in the workflow.
- The workflow triggers on `main` and `Automatation-*` branches (matching the current `Automatation-3rd-try` branch pattern).
- If TASK_18 (add tests) is done, coverage should be well above 10%. If not, 10% is still achievable from the existing 5% + any new tests.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list