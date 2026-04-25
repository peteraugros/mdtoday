// js/format.js
//
// Shared schedule formatting — single source of truth for how schedule
// labels, block numbers, and spirit dress render across all surfaces
// (Now view, TRANSITION card, Upcoming detail).
//
// Rules:
//   - Day label on its own line: "Red Day", "Homeroom Day — Red Day", etc.
//   - Block numbers on their own line, no parentheses: "Blocks 1, 3, 5, 7"
//   - Spirit dress in its own pill below
//   - No day-of-week prefix (date is already in screen header)
//   - "Homeroom Day —" prefix only on Mondays (handled by resolve.js)
//   - Em-dash reserved for meaningful modifiers (Special, Late Start, etc.)

/**
 * Extract block numbers from a raw iCal SUMMARY string.
 * "RED: B. 1, 3, 5, 7" → "Blocks 1, 3, 5, 7"
 * Returns empty string if no block list found.
 */
export function formatBlockLine(summary) {
  if (!summary) return '';
  const match = summary.match(/B\.\s*([\d,\s]+)$/);
  if (!match) return '';
  return `Blocks ${match[1].trim()}`;
}

/**
 * Extract active block numbers as an array.
 * "RED: B. 1, 3, 5, 7" → ['1','3','5','7']
 * Returns null if no block list found.
 */
export function extractActiveBlocks(summary) {
  if (!summary) return null;
  const match = summary.match(/B\.\s*([\d,\s]+)$/);
  if (!match) return null;
  return match[1].split(',').map(s => s.trim());
}
