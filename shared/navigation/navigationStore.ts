export type NavigationHost = {
  location: { href: string; origin: string; pathname: string; search: string; hash: string };
  history: {
    state: unknown;
    pushState(data: unknown, unused: string, url: string): void;
    replaceState(data: unknown, unused: string, url: string): void;
  };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export function resolveModuleHref(href: string, base: string) {
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin) throw new Error("Link externo ao sistema.");
  return `${url.pathname}${url.search}${url.hash}`;
}

// All module consumers share the same synchronous location snapshot. Changing
// a client-only module does not require fetching another server component tree.
export function createModuleNavigation(initialHref: string, host?: NavigationHost) {
  let current = initialHref;
  const listeners = new Set<() => void>();
  const update = (href: string) => {
    if (href === current) return;
    current = href;
    listeners.forEach(listener => listener());
  };
  const sync = () => {
    if (host) update(host.location.pathname + host.location.search + host.location.hash);
  };
  return {
    getSnapshot: () => current,
    getServerSnapshot: () => initialHref,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    connect() {
      if (!host) return () => {};
      sync();
      host.addEventListener("popstate", sync);
      return () => host.removeEventListener("popstate", sync);
    },
    navigate(href: string, options?: { replace?: boolean }) {
      if (!host) return;
      const next = resolveModuleHref(href, host.location.href);
      if (next !== current) {
        const method = options?.replace ? "replaceState" : "pushState";
        host.history[method](host.history.state, "", next);
      }
      update(next);
    },
  };
}
