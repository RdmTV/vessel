/** crypto.randomUUID недоступен вне secure context (например, http по IP в локальной сети). */
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && globalThis.isSecureContext) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
