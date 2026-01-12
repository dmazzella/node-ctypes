/**
 * Buffer Pool Optimization for node-ctypes
 * 
 * This module provides a buffer pool to reduce GC pressure
 * when performing many small allocations.
 * 
 * Usage:
 *   import { BufferPool } from './buffer_pool.js';
 *   const pool = new BufferPool();
 *   const buf = pool.alloc(64);  // Get buffer from pool
 *   // ... use buffer ...
 *   pool.release(buf);           // Return to pool
 */

const DEFAULT_POOL_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const DEFAULT_MAX_POOL_SIZE = 100;

export class BufferPool {
  constructor(options = {}) {
    this.sizes = options.sizes || DEFAULT_POOL_SIZES;
    this.maxPoolSize = options.maxPoolSize || DEFAULT_MAX_POOL_SIZE;
    this.pools = new Map();
    
    // Initialize pools for each size
    for (const size of this.sizes) {
      this.pools.set(size, []);
    }
    
    // Stats
    this.stats = {
      hits: 0,
      misses: 0,
      allocations: 0,
      releases: 0,
    };
  }

  /**
   * Find the smallest pool size that fits the requested size
   */
  _findPoolSize(size) {
    for (const poolSize of this.sizes) {
      if (poolSize >= size) return poolSize;
    }
    return null; // Size too large for pool
  }

  /**
   * Allocate a buffer (from pool if available)
   */
  alloc(size) {
    const poolSize = this._findPoolSize(size);
    
    if (poolSize === null) {
      // Too large for pool, allocate directly
      this.stats.allocations++;
      return Buffer.alloc(size);
    }

    const pool = this.pools.get(poolSize);
    
    if (pool.length > 0) {
      // Pool hit - reuse buffer
      this.stats.hits++;
      const buf = pool.pop();
      buf.fill(0); // Clear before reuse
      return buf;
    }

    // Pool miss - allocate new buffer
    this.stats.misses++;
    this.stats.allocations++;
    return Buffer.alloc(poolSize);
  }

  /**
   * Release a buffer back to the pool
   */
  release(buffer) {
    if (!Buffer.isBuffer(buffer)) return;
    
    const size = buffer.length;
    const poolSize = this._findPoolSize(size);
    
    if (poolSize === null || size !== poolSize) {
      // Not a pooled size, let GC handle it
      return;
    }

    const pool = this.pools.get(poolSize);
    
    if (pool.length < this.maxPoolSize) {
      this.stats.releases++;
      pool.push(buffer);
    }
    // If pool is full, let GC handle the buffer
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const poolStats = {};
    for (const [size, pool] of this.pools) {
      poolStats[size] = pool.length;
    }
    
    return {
      ...this.stats,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      pools: poolStats,
    };
  }

  /**
   * Clear all pools
   */
  clear() {
    for (const pool of this.pools.values()) {
      pool.length = 0;
    }
  }
}

// Singleton global pool
let globalPool = null;

export function getGlobalPool() {
  if (!globalPool) {
    globalPool = new BufferPool();
  }
  return globalPool;
}

/**
 * Benchmark to compare pooled vs unpooled allocation
 */
export async function benchmarkPool() {
  const iterations = 100000;
  const pool = new BufferPool();
  
  console.log(`\n=== Buffer Pool Benchmark (${iterations.toLocaleString()} iterations) ===\n`);
  
  // Test 1: Unpooled allocation
  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const buf = Buffer.alloc(64);
    // Simulate some work
    buf[0] = i & 0xFF;
  }
  const unpooledTime = performance.now() - start;
  
  // Test 2: Pooled allocation
  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const buf = pool.alloc(64);
    // Simulate some work
    buf[0] = i & 0xFF;
    pool.release(buf);
  }
  const pooledTime = performance.now() - start;
  
  console.log(`Unpooled: ${unpooledTime.toFixed(2)}ms`);
  console.log(`Pooled:   ${pooledTime.toFixed(2)}ms`);
  console.log(`Speedup:  ${(unpooledTime / pooledTime).toFixed(2)}x`);
  console.log(`\nPool stats:`, pool.getStats());
  
  return { unpooledTime, pooledTime };
}

// If run directly, execute benchmark
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  benchmarkPool();
}
