// js/schedule.js
//
// Current period / next period logic.
//
// Given a resolved template (from resolveDay) and the current time, returns
// what's happening right now and what's coming next.
//
// See claude.md → "Core Modules → js/schedule.js" for the contract.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert HH:MM → minutes since midnight.
 */
function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
    return h * 60 + m;
  }
  
  /**
   * Current time as minutes since local midnight.
   */
  function nowMinutes(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }
  
  /**
   * Seconds from `now` to a given HH:MM time today.
   */
  function secondsUntil(hhmm, now) {
    const targetMinutes = timeToMinutes(hhmm);
    const current = nowMinutes(now);
    return Math.round((targetMinutes - current) * 60);
  }
  
  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------
  
  /**
   * Determine current status given a template and the current time.
   *
   * The template is an object: { template_id, blocks: [...] } as returned by
   * resolveDay(). Blocks are already sorted by (block_order, track).
   *
   * @returns {Object} one of:
   *
   *   Simple (non-branching) mode:
   *     { status, currentBlock, currentTracks: null, nextBlock, secondsToNextTransition }
   *
   *   Branching mode (lunch window with both Upper and Lower active):
   *     { status: 'period', currentBlock: null,
   *       currentTracks: { upper: Block, lower: Block },
   *       nextBlock, secondsToNextTransition }
   *
   *   status values: 'before' | 'period' | 'passing' | 'after'
   */
  export function getCurrentStatus(template, now = new Date()) {
    // Defensive: no template → treat as "after" (nothing to show)
    if (!template || !Array.isArray(template.blocks) || template.blocks.length === 0) {
      return {
        status: 'after',
        currentBlock: null,
        currentTracks: null,
        nextBlock: null,
        secondsToNextTransition: null,
      };
    }
  
    const blocks = template.blocks;
    const current = nowMinutes(now);
  
    const firstStart = Math.min(...blocks.map(b => timeToMinutes(b.start_time)));
    const lastEnd = Math.max(...blocks.map(b => timeToMinutes(b.end_time)));
  
    // --- Before school ---
    if (current < firstStart) {
      const firstBlock = blocks.find(b => timeToMinutes(b.start_time) === firstStart);
      return {
        status: 'before',
        currentBlock: null,
        currentTracks: null,
        nextBlock: firstBlock,
        secondsToNextTransition: secondsUntil(firstBlock.start_time, now),
      };
    }
  
    // --- After school ---
    if (current >= lastEnd) {
      return {
        status: 'after',
        currentBlock: null,
        currentTracks: null,
        nextBlock: null,
        secondsToNextTransition: null,
      };
    }
  
    // --- In school hours — find blocks currently active ---
    const active = blocks.filter(b => {
      const s = timeToMinutes(b.start_time);
      const e = timeToMinutes(b.end_time);
      return current >= s && current < e;
    });
  
    if (active.length === 0) {
      // Passing period — find the next block to start
      const upcomingStart = blocks
        .map(b => timeToMinutes(b.start_time))
        .filter(s => s > current)
        .sort((a, b) => a - b)[0];
      const nextBlock = blocks.find(b => timeToMinutes(b.start_time) === upcomingStart);
      return {
        status: 'passing',
        currentBlock: null,
        currentTracks: null,
        nextBlock,
        secondsToNextTransition: nextBlock ? secondsUntil(nextBlock.start_time, now) : null,
      };
    }
  
    // --- One active block — simple case ---
    if (active.length === 1) {
      const currentBlock = active[0];
      const nextStart = blocks
        .map(b => timeToMinutes(b.start_time))
        .filter(s => s > timeToMinutes(currentBlock.start_time))
        .sort((a, b) => a - b)[0];
      const nextBlock = nextStart !== undefined
        ? blocks.find(b => timeToMinutes(b.start_time) === nextStart)
        : null;
  
      return {
        status: 'period',
        currentBlock,
        currentTracks: null,
        nextBlock,
        secondsToNextTransition: secondsUntil(currentBlock.end_time, now),
      };
    }
  
    // --- Multiple active blocks — lunch window branching ---
    // Expected: exactly one upper and one lower track row active simultaneously.
    const upper = active.find(b => b.track === 'upper');
    const lower = active.find(b => b.track === 'lower');
  
    if (upper && lower) {
      // Transition fires whichever track ends first
      const upperEnd = timeToMinutes(upper.end_time);
      const lowerEnd = timeToMinutes(lower.end_time);
      const nearerEnd = Math.min(upperEnd, lowerEnd);
      const secondsToTransition = Math.round((nearerEnd - current) * 60);
  
      // Next block after both tracks finish — find next block starting after
      // the earlier of the two ends
      const futureStart = blocks
        .map(b => timeToMinutes(b.start_time))
        .filter(s => s > nearerEnd)
        .sort((a, b) => a - b)[0];
      const nextBlock = futureStart !== undefined
        ? blocks.find(b => timeToMinutes(b.start_time) === futureStart)
        : null;
  
      return {
        status: 'period',
        currentBlock: null,
        currentTracks: { upper, lower },
        nextBlock,
        secondsToNextTransition: secondsToTransition,
      };
    }
  
    // --- Fallback: multiple active blocks that aren't a clean upper/lower pair ---
    // Shouldn't happen with validated data, but degrade gracefully by returning
    // the first one as the current block.
    console.warn('[schedule] unexpected multiple active blocks without upper/lower split:', active);
    return {
      status: 'period',
      currentBlock: active[0],
      currentTracks: null,
      nextBlock: null,
      secondsToNextTransition: secondsUntil(active[0].end_time, now),
    };
  }