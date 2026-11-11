export const REQUEST_TIMEOUT_MS = 30_000;

/** Bounds the whole request, including session acquisition before fetch starts. */
export function withRequestTimeout<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  {signal, timeoutMs = REQUEST_TIMEOUT_MS}: {signal?: AbortSignal; timeoutMs?: number} = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
      controller.abort(reason);
    };
    const cancel = () => fail(new DOMException('Consulta cancelada', 'AbortError'));
    const timer = setTimeout(() => fail(new DOMException(
      'A comunicação demorou mais que o esperado. Confira os dados antes de tentar novamente.',
      'TimeoutError',
    )), timeoutMs);
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, {once: true});
    try {
      Promise.resolve(request(controller.signal)).then(result => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      }, fail);
    } catch (reason) { fail(reason); }
  });
}
