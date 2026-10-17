import type { Scene } from "@babylonjs/core";

/** Length of one frame-rate probe. */
export const PROBE_MS = 2000;
/** Frames skipped before a probe starts (shader compiles, first texture uploads). */
const WARMUP_FRAMES = 20;

/**
 * Quality levels to drop for a measured frame rate: smooth (≥ 48 fps) keeps the level,
 * noticeably slow drops one, unplayable (< 32 fps) drops two.
 */
export function qualityDrop(fps: number): number {
  if (fps >= 48) return 0;
  return fps >= 32 ? 1 : 2;
}

/**
 * Median frame rate over PROBE_MS of rendered frames. Restarts while the tab is hidden, since
 * browsers throttle background tabs and that would read as a slow device.
 */
export function probeFps(scene: Scene): Promise<number> {
  return new Promise((resolve) => {
    let warmup = WARMUP_FRAMES;
    let start = 0;
    let last = 0;
    let intervals: number[] = [];
    const observer = scene.onAfterRenderObservable.add(() => {
      const now = performance.now();
      if (document.hidden) {
        warmup = WARMUP_FRAMES;
        intervals = [];
        return;
      }
      if (warmup > 0) {
        warmup--;
        start = last = now;
        return;
      }
      intervals.push(now - last);
      last = now;
      if (now - start < PROBE_MS) return;
      scene.onAfterRenderObservable.remove(observer);
      intervals.sort((a, b) => a - b);
      resolve(1000 / intervals[intervals.length >> 1]);
    });
  });
}
