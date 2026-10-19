import { CITY } from "./city";
import { COAST } from "./coast";
import { DESERT } from "./desert";
import { FOREST } from "./forest";
import { ICE } from "./ice";
import { MEADOW } from "./meadow";
import { NIGHT } from "./night";
import { SHOWCASE } from "./showcase";
import type { Scenery } from "./types";

/** Championship order (race 1 first) and host dropdown order; [0] is the default circuit (intro, single races, unknown ids). */
export const SCENERIES: readonly Scenery[] = [MEADOW, COAST, DESERT, CITY, FOREST, SHOWCASE, ICE, NIGHT];

export const DEFAULT_SCENERY: Scenery = SCENERIES[0];

/** Dev `?preview=<id>` circuits: every scenery (add dev-only references here). */
export const PREVIEW_SCENERIES: readonly Scenery[] = SCENERIES;

/** Untrusted id (relay settings, sessionStorage) → scenery; unknown or missing → DEFAULT_SCENERY. */
export function sceneryById(id: unknown): Scenery {
  return SCENERIES.find((s) => s.id === id) ?? DEFAULT_SCENERY;
}
