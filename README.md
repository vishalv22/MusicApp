# ViMusic

ViMusic is an Electron desktop music player focused on local-library playback with lyrics, playlists, video attachments, and an integrated online download/search panel.

Current app version: **2.0.0**

## What It Does

- Scans one or more watched music folders recursively.
- Reads audio metadata (title, artist, album, duration, genre, release date, cover art, sample rate, bit depth, lossless flag).
- Supports playlist creation, editing, pinning, merging, custom cover, and custom playlist background.
- Supports category filters such as all songs, recently added, video songs, and rated songs.
- Supports song rating, sorting, queueing, and multi-select operations.
- Supports synced `.lrc` lyrics with auto matching, manual attach/paste, and timing offset controls.
- Supports a floating lyrics window with adjustable size/color and click-through toggle.
- Supports video playback for standalone video files and per-song video attachments.
- Supports main-panel video mode and mini-player mode.
- Provides download panel flow (login, search, preview, download, logs, cancel).
- Includes equalizer controls, theme modes, playback modes, and visualizer.

## Supported Media Formats

- Audio scan/import: `mp3`, `wav`, `ogg`, `m4a`, `flac`
- Video import/scan: `mp4`, `avi`, `mkv`, `mov`, `wmv`, `flv`, `webm`, `m4v`
- Lyrics: `.lrc`

## Stack

- Electron (desktop shell)
- Vanilla JS + HTML + CSS (renderer UI)
- Web Audio API (equalizer/processing)
- `music-metadata` (tag parsing)

## Project Structure

- `main.js`: Electron main process, IPC handlers, filesystem operations, download integration.
- `app.js`: Renderer application logic (player state, UI interactions, playlists, search, queue, settings).
- `app.html`: Main UI layout.
- `style.css`: Base app styling.
- `playlistView.css`: Playlist header/collapse styling.
- `playlistView.js`: Playlist header scroll/collapse behavior.
- `visualizer.js`: Visualizer rendering logic.
- `floating-lyrics.html`: Floating lyrics window UI.
- `icons/`: App icons and UI assets.


## Getting Started

### Prerequisites

- Node.js (recommended LTS)
- npm
- Windows is the primary packaged target in current build config (`nsis`).

### Install

```bash
npm install
```

### Run in Development

```bash
npm start
```

### Build Installer

```bash
npm run build
```

Build output is generated under `dist/`.
Before packaging, make sure these resource paths exist (or update `package.json` build config):

- `ffmpeg/`
- `python-portable/`
- `resources/bin/dab-downloader/bin/`



## Keyboard Shortcuts

- `Space`: Play/Pause
- `Left Arrow`: Previous track
- `Right Arrow`: Next track
- `Esc`: Exit selection mode or close settings panel
- In selection mode, `Ctrl/Cmd + A`: Select all in current view
- In selection mode, `Ctrl/Cmd + I`: Invert selection
- In selection mode, `Ctrl/Cmd + D`: Clear selection
- Global shortcut, `Ctrl/Cmd + Shift + L`: Toggle floating lyrics interactivity

## Key Features by Area

### Library

- Add and manage watched folders.
- Smart metadata parsing with fallback when tags are missing.
- Duplicate path de-duplication when watched folders overlap.

### Playlists

- Create/edit/delete playlists.
- Set cover image and background image.
- Pin and merge playlists.

### Lyrics

- Auto lyric file matching.
- Manual lyric attach and paste.
- Remove lyrics per song.
- Synchronized line highlighting and seek-to-line support.

### Video

- Play local video files.
- Attach custom video to specific songs.
- Remove attached video.
- Full-screen and main-panel playback controls.

### Search (Local Library)

- Supports title, artist, album, and filename-based matching.
- Includes typo-tolerant scoring with weighted relevance.
- Shows no-result state when no meaningful match is found.

### Audio Controls

- Shuffle/repeat modes.
- Ratings.
- 15-band equalizer with presets and custom values.
- Theme and playback preferences with persisted settings.


## Troubleshooting

- No songs appear: verify watched folders are added and accessible.
- Download panel search/download may fail if upstream API is temporarily unavailable.
- Check the download logs panel for detailed runtime error output.
- Lyrics not found: ensure `.lrc` files exist or attach/paste manually.
- Video attachment missing: reattach video and verify the source file still exists on disk.
