/**
 * LÉLU — the ONE autonomy threshold for changing the real project.
 *
 * Applying a reviewed change to the live source tree is a production
 * change, which AUTONOMY_LEVELS defines as L5 ("Production — requires
 * explicit authorization and safety checks"). The server enforces it
 * (plugins/serverAutonomy.ts imports this constant) and reports it as
 * `applyLevel`; the page uses the server's value and falls back to this
 * same constant, so the two can no longer disagree.
 */
export const REAL_PROJECT_APPLY_LEVEL = 5;
