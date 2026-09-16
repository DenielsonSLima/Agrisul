"use client";

import {
  createContext, forwardRef, useContext, useEffect, useMemo, useState,
  useSyncExternalStore, type ComponentProps, type ReactNode,
} from "react";
import { createModuleNavigation, type NavigationHost } from "./navigationStore";

type Store = ReturnType<typeof createModuleNavigation>;
const NavigationContext = createContext<Store | null>(null);

export function ModuleNavigationProvider({ initialHref, children }: {
  initialHref: string; children: ReactNode;
}) {
  const [store] = useState(() => createModuleNavigation(
    initialHref,
    typeof window === "undefined" ? undefined : window as unknown as NavigationHost,
  ));
  useEffect(() => store.connect(), [store]);
  return <NavigationContext.Provider value={store}>{children}</NavigationContext.Provider>;
}

export function useModuleNavigation() {
  const store = useContext(NavigationContext);
  if (!store) throw new Error("ModuleNavigationProvider necessário");
  const href = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const url = useMemo(() => new URL(href, "https://module.local"), [href]);
  return { pathname: url.pathname.replace(/\/$/, "") || "/", searchParams: url.searchParams, navigate: store.navigate };
}

export const useModuleSearchParams = () => useModuleNavigation().searchParams;

export const ModuleLink = forwardRef<HTMLAnchorElement, ComponentProps<"a">>(
  function ModuleLink({ href = "/", onClick, target, children, ...props }, ref) {
    const { navigate } = useModuleNavigation();
    return <a {...props} ref={ref} href={href} target={target} onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || (target && target !== "_self") || props.download) return;
      const destination = new URL(href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      navigate(href);
      window.scrollTo({ top: 0, behavior: "instant" });
    }}>{children}</a>;
  },
);
