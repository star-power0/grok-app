import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Creates a debounced function that delays invoking `fn` until after `delay`
 * milliseconds have elapsed since the last time the debounced function was invoked.
 * 
 * @example
 * const debouncedSearch = debounce((query: string) => {
 *   console.log("Searching for:", query);
 * }, 300);
 * 
 * debouncedSearch("hello"); // Will only execute after 300ms of no calls
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Creates a throttled function that only invokes `fn` at most once per every
 * `limit` milliseconds.
 * 
 * @example
 * const throttledResize = throttle(() => {
 *   console.log("Window resized");
 * }, 200);
 * 
 * window.addEventListener("resize", throttledResize);
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
