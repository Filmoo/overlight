/**
 * FPS-capped render loop. Streams run at 30/60 fps — rendering faster
 * than the stream only heats the streamer's GPU.
 */
export function startLoop(fps: number, cb: (dt: number, time: number) => void): () => void {
  const frameMs = 1000 / fps;
  const start = performance.now();
  let last = start;
  let raf = 0;

  const step = (now: number) => {
    raf = requestAnimationFrame(step);
    const elapsed = now - last;
    if (elapsed < frameMs) return;
    // Snap to the frame grid so we don't accumulate drift.
    last = now - (elapsed % frameMs);
    const dt = Math.min(elapsed, 100) / 1000; // clamp huge tab-switch gaps
    cb(dt, (now - start) / 1000);
  };

  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
