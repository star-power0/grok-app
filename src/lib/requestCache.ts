/**
 * Request cache for Tauri IPC calls to avoid duplicate requests.
 * Caches promises to prevent multiple components from making the same request simultaneously.
 * 
 * @example
 * import { requestCache } from "@/lib/requestCache";
 * import { invoke } from "@tauri-apps/api/core";
 * 
 * // Multiple components can call this, but only one actual IPC call will be made
 * const mcpStatus = await requestCache.get(
 *   "session_mcp_runtime",
 *   () => invoke("session_mcp_runtime")
 * );
 */
class RequestCache {
  private cache = new Map<string, { promise: Promise<any>; timestamp: number }>();
  
  /**
   * Get cached result or execute fetcher if not cached.
   * 
   * @param key - Unique cache key for this request
   * @param fetcher - Function that returns a promise (e.g., invoke call)
   * @param ttl - Time to live in milliseconds (default: 5000ms)
   * @returns Promise that resolves to the cached or fetched value
   */
  async get<T>(key: string, fetcher: () => Promise<T>, ttl = 5000): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);
    
    // Return cached if still valid
    if (cached && now - cached.timestamp < ttl) {
      return cached.promise as Promise<T>;
    }
    
    // Execute fetcher and cache the promise
    const promise = fetcher();
    this.cache.set(key, { promise, timestamp: now });
    
    // Clear cache after TTL
    promise.finally(() => {
      setTimeout(() => {
        const entry = this.cache.get(key);
        if (entry && entry.promise === promise) {
          this.cache.delete(key);
        }
      }, ttl);
    });
    
    return promise;
  }
  
  /**
   * Invalidate a specific cache key or all keys matching a prefix.
   * 
   * @param keyOrPrefix - Exact key or prefix to invalidate
   */
  invalidate(keyOrPrefix: string): void {
    if (this.cache.has(keyOrPrefix)) {
      this.cache.delete(keyOrPrefix);
    } else {
      // Invalidate all keys starting with prefix
      for (const key of this.cache.keys()) {
        if (key.startsWith(keyOrPrefix)) {
          this.cache.delete(key);
        }
      }
    }
  }
  
  /**
   * Clear all cached requests.
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get current cache size (for debugging).
   */
  size(): number {
    return this.cache.size;
  }
}

export const requestCache = new RequestCache();
