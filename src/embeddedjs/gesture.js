/*
 * Classifies a finished touch by how far it travelled vertically. Pure so the
 * thresholds can be checked off-device (see tools/check.mjs).
 *
 * Returns { tap } for a press that stayed put, or { lines } to scroll by —
 * negative when the finger moved down, since dragging the content down means
 * moving the viewport up.
 */
export default function gesture(dy, lineHeight, slop) {
  if (Math.abs(dy) < slop) {
    return { tap: true, lines: 0 };
  }
  return { tap: false, lines: -Math.round(dy / lineHeight) };
}
