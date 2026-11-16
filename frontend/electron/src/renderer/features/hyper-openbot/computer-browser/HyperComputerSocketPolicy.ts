/** Exact computer stream endpoints. Encoded separators and traversal never name a computer. */
export function hyperComputerSocketPathAllowed(path: string): boolean {
  return /^\/api\/computers\/[A-Za-z0-9_-]{1,200}\/(stream|terminal)$/.test(path);
}
