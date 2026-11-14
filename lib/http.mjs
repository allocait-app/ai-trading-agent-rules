// Options every request that carries a key sets: no redirect (the key must not follow one to another host) and a timeout.
export const guarded = (ms = 15_000) => ({ redirect: 'error', signal: AbortSignal.timeout(ms) })
