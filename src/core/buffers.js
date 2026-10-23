// Partial uploads. When a buffer changes, three.js sends all of it to the graphics chip unless
// told which part changed, and the instanced buffers are sized for the most there could ever be.

/** Mark the first `n` items of a buffer attribute (instances, particles) for upload this frame. */
export function sendFirst(attr, n) {
  attr.clearUpdateRanges();
  if (n <= 0) return;
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}
