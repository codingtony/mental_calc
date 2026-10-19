import { Curve3, Vector3 } from "@babylonjs/core";
import type { ControlPoint, Span } from "./sceneries/types";

export const SAMPLES_PER_SEGMENT = 40;

/** Closed centreline samples (no duplicated end point), starting exactly at controlPoints[0], in array order. */
export function sampleCenterline(controlPoints: readonly ControlPoint[]): Vector3[] {
  const n = controlPoints.length;
  // A closed Catmull-Rom spline starts at its second input point: feed the last point first.
  const input = [controlPoints[n - 1], ...controlPoints.slice(0, n - 1)];
  const raw = Curve3.CreateCatmullRomSpline(
    input.map(([x, z, y]) => new Vector3(x, y ?? 0, z)),
    SAMPLES_PER_SEGMENT,
    true,
  ).getPoints();
  // A closed spline repeats its first point at the end; drop it so the loop wraps explicitly.
  return raw[raw.length - 1].equalsWithEpsilon(raw[0], 1e-6) ? raw.slice(0, -1) : raw;
}

/** What carries the road at a centreline sample. */
export type Support = "ground" | "bridge" | "tunnel";

/** Per-sample support; a span covers samples from·SAMPLES_PER_SEGMENT … to·SAMPLES_PER_SEGMENT inclusive. */
export function sampleSupport(count: number, bridges: readonly Span[], tunnels: readonly Span[]): Support[] {
  const support: Support[] = new Array(count).fill("ground");
  for (const [kind, spans] of [
    ["bridge", bridges],
    ["tunnel", tunnels],
  ] as const) {
    for (const { from, to } of spans) {
      for (let i = from * SAMPLES_PER_SEGMENT; i <= to * SAMPLES_PER_SEGMENT && i < count; i++) support[i] = kind;
    }
  }
  return support;
}
