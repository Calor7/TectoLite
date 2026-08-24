# TectoLite release process

Tagged pushes (`v*`) verify the application on Windows, macOS, and Linux, then publish the supported Windows packages. The workflow audits the complete npm dependency tree, creates an unpacked Electron app on every platform, and smoke-tests an export from the packaged Linux app. Windows release files must be non-empty and receive a SHA-256 manifest before they are uploaded.

## Package targets

- Windows: NSIS installer and portable executable
- macOS and Linux: verification-only until signed native distribution is configured and tested

The packaged application uses an ASAR archive with Electron's ASAR integrity and restricted code-loading fuses enabled. Runtime `node_modules` are intentionally excluded: the Electron main process uses only built-in modules and the renderer dependencies are bundled into `dist`.

## Code signing and notarization

The repository does not contain credentials and does not pretend unsigned files are signed. Without the secrets below, electron-builder emits unsigned artifacts suitable for testing only. Do not describe or distribute an artifact as trusted/signed unless its platform signature has been independently verified.

For signed Windows tag builds, configure these GitHub Actions secrets:

- `WINDOWS_CSC_LINK`: a base64-encoded certificate, HTTPS URL, or supported certificate path value accepted by electron-builder
- `WINDOWS_CSC_KEY_PASSWORD`: the certificate password

Before re-enabling signed and notarized macOS tag builds, configure:

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
4. Push a matching `v<version>` tag and wait for all three verification jobs plus the Windows release job.
5. Verify Windows Authenticode when signing credentials are configured.
6. Download every Windows release artifact and validate it against `SHA256SUMS-win32.txt`.
7. Install the native packages on a clean supported Windows system before publishing release notes.
