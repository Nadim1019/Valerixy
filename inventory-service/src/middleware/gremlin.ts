/**
 * Gremlin Middleware - Chaos Engineering
 * Simulates random network latency for testing resilience
 */

// Runtime state (mutable via API)
let gremlinEnabled = process.env.GREMLIN_MODE === 'true';
let gremlinMinDelayMs = parseInt(process.env.GREMLIN_MIN_DELAY_MS || '2000', 10);
let gremlinMaxDelayMs = parseInt(process.env.GREMLIN_MAX_DELAY_MS || '5000', 10);
let schrödingerEnabled = process.env.SCHRODINGER_MODE === 'true';
let schrödingerProbability = parseFloat(process.env.SCHRODINGER_CRASH_PROBABILITY || '0.3');

export interface GremlinConfig {
  enabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
}

export function getGremlinConfig(): GremlinConfig {
  return {
    enabled: gremlinEnabled,
    minDelayMs: gremlinMinDelayMs,
    maxDelayMs: gremlinMaxDelayMs,
  };
}

/**
 * Set Gremlin latency configuration at runtime
 */
export function setGremlinLatency(enabled: boolean, minMs?: number, maxMs?: number): void {
  gremlinEnabled = enabled;
  if (minMs !== undefined) gremlinMinDelayMs = minMs;
  if (maxMs !== undefined) gremlinMaxDelayMs = maxMs;
}

/**
 * Set Schrödinger crash configuration at runtime
 */
export function setSchrödingerCrash(enabled: boolean, probability?: number): void {
  schrödingerEnabled = enabled;
  if (probability !== undefined) schrödingerProbability = probability;
}

/**
 * Get current chaos engineering status
 */
export function getGremlinStatus(): {
  gremlinEnabled: boolean;
  gremlinMinDelayMs: number;
  gremlinMaxDelayMs: number;
  schrödingerEnabled: boolean;
  schrödingerProbability: number;
} {
  return {
    gremlinEnabled,
    gremlinMinDelayMs,
    gremlinMaxDelayMs,
    schrödingerEnabled,
    schrödingerProbability,
  };
}

/**
 * Apply gremlin latency if enabled
 * Returns the delay applied (in ms), or 0 if not enabled
 */
export async function applyGremlinLatency(): Promise<number> {
  if (!gremlinEnabled) {
    return 0;
  }
  
  // Random delay between min and max
  const delay = Math.floor(
    Math.random() * (gremlinMaxDelayMs - gremlinMinDelayMs + 1) + gremlinMinDelayMs
  );
  
  console.log(`[Gremlin] 👹 Applying latency: ${delay}ms`);
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  return delay;
}

/**
 * Schrödinger's Warehouse - Crash simulation
 * Simulates crashes that occur after DB commit but before response
 */
export interface SchrodingerConfig {
  enabled: boolean;
  crashProbability: number;
}

export function getSchrodingerConfig(): SchrodingerConfig {
  return {
    enabled: schrödingerEnabled,
    crashProbability: schrödingerProbability,
  };
}

/**
 * Check if we should simulate a crash
 * Call this AFTER committing to DB but BEFORE sending response
 */
export function shouldSimulateCrash(): boolean {
  if (!schrödingerEnabled) {
    return false;
  }

  const shouldCrash = Math.random() < schrödingerProbability;

  if (shouldCrash) {
    console.log(`[Schrödinger] 🐱📦 Simulating crash after commit!`);
  }

  return shouldCrash;
}

/**
 * Simulate a crash by throwing an error
 * This simulates the scenario where the service crashes after DB commit
 */
export function simulateCrash(): never {
  throw new Error('SCHRODINGER_CRASH: Service crashed after DB commit');
}
