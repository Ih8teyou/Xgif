/*
 * Xgif - content script.
 * Everything happens locally: the video is read, frames are drawn to a canvas,
 * encoded with gifenc, and saved via a normal download. No network requests are
 * made except fetching the video file X itself already serves to you.
 */
(() => {
  "use strict";

  // ---- Settings: edit these to taste -------------------------------------
  const MAX_WIDTH = 480;     // GIF width in px (height keeps aspect ratio)
  const FPS = 15;            // frames per second
  const MAX_SECONDS = 15;    // cap length for long videos
  // -------------------------------------------------------------------------

  const { GIFEncoder, quantize, applyPalette } = globalThis.gifenc;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Frame sources -------------------------------------------------------

  function makeCanvas(vw, vh) {
    const w = Math.min(MAX_WIDTH, vw);
    const h = Math.round((vh * w) / vw);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }), w, h };
  }

  /** Direct MP4 (X's "GIF" posts): download it, then seek through it frame by frame. */
  async function* framesFromFile(url, onProgress) {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error("Could not fetch video (" + res.status + ")");
    const blobUrl = URL.createObjectURL(await res.blob());
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = blobUrl;
    try {
      await new Promise((ok, bad) => {
        v.onloadeddata = ok;
        v.onerror = () => bad(new Error("Video could not be decoded"));
      });
      const { ctx, w, h } = makeCanvas(v.videoWidth, v.videoHeight);
      const duration = Math.min(v.duration || 0, MAX_SECONDS);
      const step = 1 / FPS;
      const total = Math.max(1, Math.floor(duration * FPS));
      for (let i = 0; i < total; i++) {
        v.currentTime = Math.min(i * step, v.duration - 0.001);
        await new Promise((r) => (v.onseeked = r));
        ctx.drawImage(v, 0, 0, w, h);
        onProgress(i / total);
        yield { data: ctx.getImageData(0, 0, w, h).data, w, h, delay: Math.round(1000 / FPS) };
      }
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  /** Streamed video (blob: MediaSource): can't be fetched, so capture while it plays. */
  async function* framesFromPlayback(v, onProgress) {
    const wasPaused = v.paused, oldTime = v.currentTime, wasMuted = v.muted;
    const { ctx, w, h } = makeCanvas(v.videoWidth, v.videoHeight);
    const duration = Math.min(v.duration || MAX_SECONDS, MAX_SECONDS);
    const interval = 1000 / FPS;
    v.muted = true;
    v.currentTime = 0;
    await v.play();
    try {
      let last = -Infinity;
      while (!v.ended && v.currentTime < duration) {
        const now = performance.now();
        if (now - last >= interval - 2) {
          last = now;
          ctx.drawImage(v, 0, 0, w, h);
          onProgress(v.currentTime / duration);
          yield { data: ctx.getImageData(0, 0, w, h).data, w, h, delay: Math.round(interval) };
        }
        await sleep(Math.max(1, interval / 3));
      }
    } finally {
      v.muted = wasMuted;
      v.currentTime = oldTime;
      if (wasPaused) v.pause();
    }
  }

  // ---- Encoding & saving ---------------------------------------------------

  async function makeGif(video, onProgress) {
    const src = video.currentSrc || video.src || "";
    const frames = src.startsWith("blob:")
      ? framesFromPlayback(video, onProgress)
      : framesFromFile(src, onProgress);

    const gif = GIFEncoder();
    let count = 0;
    for await (const f of frames) {
      const palette = quantize(f.data, 256);
      const index = applyPalette(f.data, palette);
      gif.writeFrame(index, f.w, f.h, { palette, delay: f.delay });
      count++;
      if (count % 3 === 0) await sleep(0); // keep the page responsive
    }
    if (!count) throw new Error("No frames captured");
    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---- UI ------------------------------------------------------------------

  function tweetId(article) {
    const link = article.querySelector('a[href*="/status/"]');
    const m = link && link.getAttribute("href").match(/\/status\/(\d+)/);
    return m ? m[1] : String(Date.now());
  }

  function addButton(article) {
    if (article.dataset.xgif) return;
    const video = article.querySelector("video");
    const bar = article.querySelector('div[role="group"]:last-of-type');
    if (!video || !bar) return;
    article.dataset.xgif = "1";

    const wrap = document.createElement("div");
    wrap.className = "xgif-wrap";
    const btn = document.createElement("button");
    btn.className = "xgif-btn";
    btn.type = "button";
    btn.textContent = "GIF";
    btn.title = "Save this video as a GIF";
    wrap.appendChild(btn);
    bar.appendChild(wrap);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.remove("xgif-err");
      try {
        const blob = await makeGif(video, (p) => (btn.textContent = Math.round(p * 100) + "%"));
        save(blob, "x_" + tweetId(article) + ".gif");
        btn.textContent = "GIF";
      } catch (err) {
        console.error("[X to GIF]", err);
        btn.classList.add("xgif-err");
        btn.textContent = "ERR";
        btn.title = String(err.message || err);
        setTimeout(() => { btn.textContent = "GIF"; btn.classList.remove("xgif-err"); }, 4000);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function scan() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(addButton);
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, 400);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
