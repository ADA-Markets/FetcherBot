/**
 * Generate a random 64-bit nonce (16 hex characters)
 * CRITICAL: Must be exactly 16 hex chars (64 bits)
 * @param workerId - Optional worker ID (0-15) to ensure different nonce spaces per worker
 */
export function generateNonce(workerId: number = 0): string {
  const bytes = new Uint8Array(8);

  // Use workerId as the first byte to partition nonce space across workers
  // This ensures workers 0-15 explore completely different nonce ranges
  bytes[0] = workerId & 0xFF;

  // Fill remaining 7 bytes with random data
  for (let i = 1; i < 8; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }

  const nonce = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Guard: Verify output is exactly 16 hex characters
  if (nonce.length !== 16) {
    throw new Error(`Generated nonce has invalid length: ${nonce.length}, expected 16`);
  }

  return nonce;
}
