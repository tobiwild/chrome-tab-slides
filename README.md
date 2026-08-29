# Tab Slides Archiver

A Chrome/Brave extension that captures every open HTTP(S) tab in the current window
as a numbered PNG slide and downloads them plus a `manifest.json` as `slides.zip`.

## Setup
1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin the extension icon for convenience.

## Usage
1. Click the **Tab Slides Archiver** icon.
2. In the small window that opens, click **Capture and download**.
3. The current window's HTTP(S) tabs are captured in order (they briefly switch
   as each is captured) and `slides.zip` is downloaded, containing:
   - `01-host.png`, `02-host.png`, ...
   - `manifest.json`
