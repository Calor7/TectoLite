# TectoLite release process

Tagged pushes (`v*`) build the configured native packages on Windows, macOS, and Linux. The workflow first runs the full verification suite, audits the complete npm dependency tree, creates an unpacked Electron app, and smoke-tests an export from the packaged Linux app. Release files must be non-empty and receive platform-specific SHA-256 manifests before they are uploaded.

## Package targets

- Windows: NSIS installer and portable executable
- macOS: DMG and ZIP
- Linux: AppImage and Debian package

The packaged application uses an ASAR archive with Electron's ASAR integrity and restricted code-loading fuses enabled. Runtime `node_modules` are intentionally excluded: the Electron main process uses only built-in modules and the renderer dependencies are bundled into `dist`.

## Code signing and notarization

The repository does not contain credentials and does not pretend unsigned files are signed. Without the secrets below, electron-builder emits unsigned artifacts suitable for testing only. Do not describe or distribute an artifact as trusted/signed unless its platform signature has been independently verified.

For signed Windows tag builds, configure these GitHub Actions secrets:

- `WINDOWS_CSC_LINK`: a base64-encoded certificate, HTTPS URL, or supported certificate path value accepted by electron-builder
- `WINDOWS_CSC_KEY_PASSWORD`: the certificate password

For signed and notarized macOS tag builds, configure:

- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Electron-builder also supports Apple API-key notarization for local or separately configured runners via `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. The API-key file should be created from a secret in the runner's temporary directory and removed after packaging; never commit it.

## Release checklist

1. Update `version` in `package.json` and install with `npm ci` from a clean checkout.
2. Run `npm audit --audit-level=moderate`, `npm run verify`, and `npm run test:coverage`. Coverage thresholds are a ratchet: raise them as tests improve and never lower them to make a change pass.
3. Run `npm run package:dir` and exercise open, edit, save/load, and export in the unpacked app.
4. Push a matching `v<version>` tag and wait for all three platform jobs.
5. Verify the Windows Authenticode and macOS codesign/notarization results when credentials are configured.
6. Download every release artifact and validate it against the corresponding `SHA256SUMS-<platform>.txt` manifest.
7. Install each native package on a clean supported OS before publishing release notes.
