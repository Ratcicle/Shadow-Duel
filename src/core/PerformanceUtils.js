/**
 * Performance Utilities for Shadow Duel
 *
 * Provides benchmarking and monitoring tools for tracking performance improvements.
 * Use these utilities during development and testing to identify bottlenecks.
 *
 * Usage:
 *   import { PerformanceMonitor, benchmark } from './PerformanceUtils.js';
 *
 *   // Option 1: Quick benchmark
 *   const result = benchmark('cloneGameState', () => cloneGameState(game));
 *
 *   // Option 2: Detailed monitoring
 *   const monitor = new PerformanceMonitor('BeamSearch');
 *   monitor.start('clone');
 *   // ... do cloning
 *   monitor.end('clone');
 *   monitor.report();
 */

/**
 * Simple benchmark function for measuring execution time.
 * @param {string} label - Description of what's being benchmarked
 * @param {Function} fn - Function to benchmark
 * @param {number} iterations - Number of times to run (default: 1)
 * @returns {*} Result of the function call
 */
export function benchmark(label, fn, iterations = 1) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    times.push(end - start);

    // Return result on last iteration
    if (i === iterations - 1) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);

      console.log(`[Benchmark] ${label}:`);
      console.log(`  Iterations: ${iterations}`);
      console.log(`  Avg: ${avg.toFixed(2)}ms | Min: ${min.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);

      return result;
    }
  }
}

/**
 * Async version of benchmark.
 * @param {string} label - Description of what's being benchmarked
 * @param {Function} fn - Async function to benchmark
 * @param {number} iterations - Number of times to run (default: 1)
 * @returns {Promise<*>} Result of the function call
 */
export async function benchmarkAsync(label, fn, iterations = 1) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    times.push(end - start);

    if (i === iterations - 1) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);

      console.log(`[Benchmark] ${label}:`);
      console.log(`  Iterations: ${iterations}`);
      console.log(`  Avg: ${avg.toFixed(2)}ms | Min: ${min.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);

      return result;
    }
  }
}

/**
 * Performance monitor for tracking multiple operations.
 */
export class PerformanceMonitor {
  constructor(name) {
    this.name = name;
    this.timers = new Map();
    this.completed = new Map();
    this.counts = new Map();
    this.enabled =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("shadow_duel_perf_monitor") === "true";
  }

  /**
   * Start timing an operation.
   * @param {string} operation - Name of the operation
   */
  start(operation) {
    if (!this.enabled) return;
    this.timers.set(operation, performance.now());
  }

  /**
   * End timing an operation.
   * @param {string} operation - Name of the operation
   */
  end(operation) {
    if (!this.enabled) return;

    const startTime = this.timers.get(operation);
    if (startTime === undefined) return;

    const elapsed = performance.now() - startTime;
    const existing = this.completed.get(operation) || [];
    existing.push(elapsed);
    this.completed.set(operation, existing);
    this.counts.set(operation, (this.counts.get(operation) || 0) + 1);
    this.timers.delete(operation);
  }

  /**
   * Increment a counter for tracking call frequency.
   * @param {string} counter - Name of the counter
   */
  count(counter) {
    if (!this.enabled) return;
    this.counts.set(counter, (this.counts.get(counter) || 0) + 1);
  }

  /**
   * Print a report of all tracked operations.
   */
  report() {
    if (!this.enabled) {
      console.log(`[${this.name}] Performance monitoring disabled. Enable with: localStorage.setItem('shadow_duel_perf_monitor', 'true')`);
      return;
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log(`📊 Performance Report: ${this.name}`);
    console.log(`${"═".repeat(60)}`);

    for (const [operation, times] of this.completed.entries()) {
      if (times.length === 0) continue;

      const total = times.reduce((a, b) => a + b, 0);
      const avg = total / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      const count = times.length;

      console.log(`\n${operation}:`);
      console.log(`  Calls: ${count}`);
      console.log(`  Total: ${total.toFixed(2)}ms`);
      console.log(`  Avg: ${avg.toFixed(2)}ms | Min: ${min.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);
    }

    // Print standalone counters
    const counterOnlyKeys = [...this.counts.keys()].filter(
      (k) => !this.completed.has(k)
    );
    if (counterOnlyKeys.length > 0) {
      console.log(`\nCounters:`);
      for (const key of counterOnlyKeys) {
        console.log(`  ${key}: ${this.counts.get(key)}`);
      }
    }

    console.log(`\n${"═".repeat(60)}\n`);
  }

  /**
   * Reset all timers and completed data.
   */
  reset() {
    this.timers.clear();
    this.completed.clear();
    this.counts.clear();
  }
}

/**
 * Memory usage tracker (works in Node.js and browsers with memory API).
 */
export function getMemoryUsage() {
  // Node.js
  if (typeof process !== "undefined" && process.memoryUsage) {
    const mem = process.memoryUsage();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      formatted: `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB / ${(mem.heapTotal / 1024 / 1024).toFixed(2)}MB`,
    };
  }

  // Browser with memory API (Chrome only)
  if (
    typeof performance !== "undefined" &&
    performance.memory
  ) {
    const mem = performance.memory;
    return {
      heapUsed: mem.usedJSHeapSize,
      heapTotal: mem.jsHeapSizeLimit,
      formatted: `Heap: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB / ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`,
    };
  }

  return { heapUsed: 0, heapTotal: 0, formatted: "Memory API not available" };
}

/**
 * Simple profiling decorator for class methods.
 *
 * NOTE: This uses the legacy decorator syntax (Stage 2).
 * For TypeScript projects, enable "experimentalDecorators" in tsconfig.
 * For vanilla JS, use the wrapper function alternative below.
 *
 * @param {string} className - Name of the class for logging
 * @returns {Function} Decorator function
 *
 * Usage with decorators (requires transpiler):
 *   class MyClass {
 *     @profile('MyClass')
 *     myMethod() { ... }
 *   }
 *
 * Alternative without decorators:
 *   const profiledMethod = profileWrap('MyClass', 'myMethod', myMethod);
 */
export function profile(className) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args) {
      const start = performance.now();
      const result = originalMethod.apply(this, args);
      const elapsed = performance.now() - start;

      if (elapsed > 10) {
        // Only log if > 10ms
        console.log(`[Profile] ${className}.${propertyKey}: ${elapsed.toFixed(2)}ms`);
      }

      return result;
    };

    return descriptor;
  };
}

/**
 * Wrapper function alternative to the decorator (works without transpiler).
 * @param {string} className - Name of the class for logging
 * @param {string} methodName - Name of the method for logging
 * @param {Function} fn - Function to wrap
 * @returns {Function} Wrapped function with profiling
 *
 * Usage:
 *   const originalMethod = myInstance.myMethod.bind(myInstance);
 *   myInstance.myMethod = profileWrap('MyClass', 'myMethod', originalMethod);
 */
export function profileWrap(className, methodName, fn) {
  return function (...args) {
    const start = performance.now();
    const result = fn.apply(this, args);
    const elapsed = performance.now() - start;

    if (elapsed > 10) {
      console.log(`[Profile] ${className}.${methodName}: ${elapsed.toFixed(2)}ms`);
    }

    return result;
  };
}

/**
 * Measure memory delta of an operation.
 * @param {string} label - Description
 * @param {Function} fn - Function to measure
 * @returns {*} Result of the function
 */
export function measureMemory(label, fn) {
  const before = getMemoryUsage();
  const result = fn();
  const after = getMemoryUsage();

  const delta = after.heapUsed - before.heapUsed;
  const deltaKB = delta / 1024;

  console.log(`[Memory] ${label}: ${deltaKB >= 0 ? "+" : ""}${deltaKB.toFixed(2)}KB`);

  return result;
}

export default {
  benchmark,
  benchmarkAsync,
  PerformanceMonitor,
  getMemoryUsage,
  measureMemory,
  profile,
  profileWrap,
};
