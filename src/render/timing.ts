/**
 * Every animation constant, in milliseconds, in one place for tuning.
 *
 * A move's total budget is 250-350 ms including the cascade. The longest
 * possible cascade is six squares (place on a1, flip b1..g1 against h1):
 *   FLIP_DELAY + 6 * FLIP_CASCADE_STEP + FLIP_MS = 40 + 108 + 160 = 308 ms.
 * The common case of one to three flips lands around 254 ms.
 */
export const TIMING = {
  /** The placed disc pops in over this long. */
  PLACE_MS: 120,
  /** Squash to nothing and back out again, per flipped disc. */
  FLIP_MS: 160,
  /** The first flip waits this long, so the placement reads first. */
  FLIP_DELAY: 40,
  /** Added per square of Chebyshev distance from the placed disc. */
  FLIP_CASCADE_STEP: 18,
} as const;

/** Total wall time of a move animation with `maxDistance` in its cascade. */
export function moveDuration(maxDistance: number): number {
  if (maxDistance <= 0) return TIMING.PLACE_MS;
  return Math.max(
    TIMING.PLACE_MS,
    TIMING.FLIP_DELAY + maxDistance * TIMING.FLIP_CASCADE_STEP + TIMING.FLIP_MS,
  );
}
