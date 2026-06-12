// ESLint flat config — intentionally minimal, high-signal baseline.
// tsc --strict already covers most type-level issues; this adds the
// correctness rules TypeScript doesn't check.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'release/**', 'node_modules/**', '*.cjs', '*.js'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        rules: {
            // tsc handles unused locals/params; avoid double-reporting style noise
            '@typescript-eslint/no-unused-vars': 'off',
            // Legacy codebase uses `any` in places; surface as warning, not error
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'off',
            // High-signal correctness rules
            'eqeqeq': ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-duplicate-imports': 'error',
        },
    }
);
