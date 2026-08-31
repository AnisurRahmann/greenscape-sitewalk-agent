// Vitest alias target for the 'server-only' package. Its real entry throws
// outside a React Server environment; server code under test (agent-runs ->
// db/client) must import cleanly in unit tests, where the guard is inert.
export {};
