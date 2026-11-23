/**
 * The one shared occupancy lattice resolution, in metres.
 *
 * It lives in its own leaf module because it is needed by code that must not
 * import the whole build pipeline: the reference provider snaps the head
 * frame to this grid, and any region shape that is placed by a lattice anchor
 * has to use exactly the same cell size as `anchorCells` does.
 */
export const CELL = 0.006;
