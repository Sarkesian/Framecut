# Framecut Studio

A local Windows desktop video editor built with Electron, Preact, JavaScript, and FFmpeg. Framecut combines a multitrack timeline with media management, preview playback, captions, audio tools, and video export.

## Features

- Timeline editing with trimming, splitting, snapping, transitions, keyframes, and undo.
- Media import, project persistence, thumbnails, and proxy workflows.
- Captions, text overlays, audio mixing, and a native Windows audio helper.
- Online asset discovery with source and licensing information; network access is needed for online providers and model downloads.
- FFmpeg rendering with export controls and size estimates.

This is development source. Third-party asset availability and licenses depend on the provider; review the source information before using downloaded media.

## Run and build

Use Windows with Node.js and npm. The native audio helper additionally requires the .NET SDK.

```powershell
npm ci
npm run build
npm start
```

`npm run dev` starts the local development server. `npm run package` builds the Windows installer and fetches its Python packaging dependency. Generated builds and personal media are excluded from Git.

## Verification

```powershell
npm test
npm run build
```

The Node tests cover editing and composition logic, project handling, export calculations, and media-provider behavior. Additional browser and native integration journeys live under `tests/` and can require installed desktop dependencies or network access.

## Code map

| Directory | Responsibility |
| --- | --- |
| `src/` | Preact editor, timeline, preview, and UI state |
| `desktop/` | Electron host, local APIs, media jobs, and asset providers |
| `shared/` | Project model, edit planning, rights metadata, and export calculations |
| `native/` | Windows audio integration |
| `tests/` | Unit, service, browser, and desktop checks |

The repository retains the original development commits and feature branches. Older experimental work is preserved separately from `main`.
