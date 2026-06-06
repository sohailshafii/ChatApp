import type { FastifyBaseLogger } from 'fastify';

// A process-wide handle on the Fastify logger, so module-level code outside a
// request scope (the WS frame handlers, the bot orchestrator, the push
// dispatcher) can log without threading a logger through every call. Set once in
// buildApp(); falls back to console if used before that (e.g. an odd unit test).
let logger: FastifyBaseLogger | undefined;

export function setAppLogger(l: FastifyBaseLogger): void {
  logger = l;
}

export function appLog(): FastifyBaseLogger {
  return logger ?? (console as unknown as FastifyBaseLogger);
}
