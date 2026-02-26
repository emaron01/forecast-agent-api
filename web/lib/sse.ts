/**
 * Server-side SSE helper. Writes strictly framed SSE events so chunk boundaries
 * never produce concatenated payloads (e.g. "...}data: {..."). Request-scoped:
 * no module-level mutable state; encoder is per call.
 */

export type SSESendOptions = {
  event?: string;
  id?: string;
};

/**
 * Enqueue one SSE event. Always emits:
 *   [optional] event: <name>\n
 *   [optional] id: <id>\n
 *   data: <JSON payload>\n\n
 * so the stream never contains "}data:" without an intervening \n\n.
 */
export function sendSSE(
  controller: WritableStreamDefaultController<Uint8Array>,
  payload: object,
  opts?: SSESendOptions
): void {
  const encoder = new TextEncoder();
  let out = "";
  if (opts?.event) out += `event: ${String(opts.event).replace(/\n/g, "")}\n`;
  if (opts?.id != null) out += `id: ${String(opts.id).replace(/\n/g, "")}\n`;
  out += `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(encoder.encode(out));
}
