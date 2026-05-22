/**
 * FNV-1a 32-bit hash. Non-cryptographic; the goal is "did this input
 * change since last time," not collision resistance. Used by
 * `hashPhasePolyline` for trip-mutation drift detection.
 *
 * Output is an 8-character lowercase hex string.
 */
export function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // Math.imul keeps multiplication 32-bit; plain * would overflow into doubles.
    h = Math.imul(h, 0x01000193);
  }
  // Unsigned shift to coerce back to a non-negative 32-bit int.
  return (h >>> 0).toString(16).padStart(8, "0");
}
