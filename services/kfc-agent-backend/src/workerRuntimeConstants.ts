// Timers scheduled after a Worker response may be clamped to one second.
// D1/SSE delivery already yields between durable event writes, so adding an
// artificial delay here can exhaust waitUntil before the run is terminal.
export const WORKER_CUSTOMER_RUN_PACE_MS = 0;
export const WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS = 3;
