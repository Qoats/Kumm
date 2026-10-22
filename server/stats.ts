/** Compteurs pour /health (aucune donnée personnelle : ni adresse, ni requête). */
export const stats = { started: Date.now(), requests: 0, limited: 0, errors5xx: 0, upstreamErrors: 0, slow: 0, ctsCalls: 0, budgetRefused: 0, unknownRefs: 0, unknownRefused: 0 };

export function recordRequest(status: number, ms: number): void {
  stats.requests++;
  if (status === 429) stats.limited++;
  if (status >= 500) stats.errors5xx++;
  if (ms > 3000) stats.slow++;
}
