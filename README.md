# Xgif
Adds a small **GIF** button to the action bar of any post with a video on x.com / twitter.com.
Click it and a real `.gif` is saved to your Downloads folder.

## Install (Brave / Chrome / any Chromium browser)
1. download the `.zip` folder somewhere permanent.
2. Open `brave://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and choose the folder containing `manifest.json`. (*aka the folder within the folder*)
5. Reload x.com.

## How it works
- **GIF posts** (direct MP4 on video.twimg.com): the file is fetched, decoded in a hidden `<video>`, and frames are encoded locally.
- **Regular videos** (streamed): X doesn't expose a downloadable file, so frames are captured while the video plays muted for up to 15 s, then it's restored.

## Privacy / safety
- No permissions requested besides running on x.com and twitter.com. No background script, no storage, no analytics.
- No network requests except fetching the video file that X already serves you.
- Only third-party code: `lib/gifenc.js` (MIT, vendored unmodified from npm `gifenc@1.0.3`).

## Tweak
Edit `MAX_WIDTH`, `FPS`, `MAX_SECONDS` at the top of `content.js`, then click reload on the extension card.

## Known limits
- X changes its markup often; if the button disappears, the selectors in `addButton()` need updating.
- If a GIF post shows `ERR` with a CORS message in the console, video.twimg.com blocked the fetch; that would need a background-worker fetch plus a host permission.
- GIFs are large for long/high-res clips. Lower `MAX_WIDTH`/`FPS` to shrink them.
