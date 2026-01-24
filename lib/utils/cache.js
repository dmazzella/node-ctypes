/**
 * @file cache.js
 * @module utils/cache
 * @description Simple LRU (Least Recently Used) cache implementation for function caching.
 * Prevents unbounded memory growth in long-running applications.
 *
 * @example
 * import { LRUCache } from './utils/cache.js';
 *
 * const cache = new LRUCache(1000); // Max 1000 entries
 * cache.set('key1', 'value1');
 * const value = cache.get('key1'); // 'value1'
 */

/**
 * LRU Cache implementation using Map for O(1) operations.
 * When the cache reaches maxSize, the least recently used item is evicted.
 *
 * @class LRUCache
 * @example
 * const cache = new LRUCache(100);
 * cache.set('user:1', { name: 'John' });
 * cache.get('user:1'); // { name: 'John' }
 * cache.has('user:1'); // true
 * cache.size; // 1
 */
export class LRUCache {
  /**
   * Creates a new LRU cache instance
   * @param {number} [maxSize=1000] - Maximum number of entries before eviction
   */
  constructor(maxSize = 1000) {
    /**
     * Maximum cache size before LRU eviction
     * @type {number}
     * @private
     */
    this.maxSize = maxSize;

    /**
     * Internal Map storage for cache entries
     * Map maintains insertion order, which we use for LRU tracking
     * @type {Map<string, any>}
     * @private
     */
    this.cache = new Map();
  }

  /**
   * Retrieves a value from the cache and marks it as recently used.
   * Moves the entry to the end of the Map (most recently used position).
   *
   * @param {string} key - Cache key to retrieve
   * @returns {any|undefined} The cached value, or undefined if not found
   *
   * @example
   * cache.set('key', 'value');
   * cache.get('key'); // 'value'
   * cache.get('missing'); // undefined
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end (most recently used) by deleting and re-inserting
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Adds or updates a value in the cache.
   * If the key exists, it's moved to the most recently used position.
   * If the cache is full, the least recently used entry is evicted.
   *
   * @param {string} key - Cache key
   * @param {any} value - Value to store
   *
   * @example
   * cache.set('user:1', { name: 'John' });
   * cache.set('user:1', { name: 'Jane' }); // Updates existing entry
   */
  set(key, value) {
    // If key exists, remove it first (will re-add at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // If at capacity, evict oldest entry (first in Map)
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    // Add to end (most recently used position)
    this.cache.set(key, value);
  }

  /**
   * Checks if a key exists in the cache.
   * Does NOT update the LRU position.
   *
   * @param {string} key - Cache key to check
   * @returns {boolean} True if the key exists
   *
   * @example
   * cache.set('key', 'value');
   * cache.has('key'); // true
   * cache.has('missing'); // false
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Removes all entries from the cache.
   *
   * @example
   * cache.set('key1', 'value1');
   * cache.set('key2', 'value2');
   * cache.clear();
   * cache.size; // 0
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Returns the current number of entries in the cache.
   *
   * @returns {number} Number of cached entries
   *
   * @example
   * cache.set('key1', 'value1');
   * cache.set('key2', 'value2');
   * cache.size; // 2
   */
  get size() {
    return this.cache.size;
  }
}
