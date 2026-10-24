import { useState, useEffect, useCallback } from "react";
import { internalFromLocation, toAppHref } from "../../shared/public-site";

const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export type Route =
  | { name: "dashboard" }
  | { name: "properties" }
  | { name: "property"; id: string }
  | { name: "tenants" }
  | { name: "tenant"; id: string }
  | { name: "leases" }
  | { name: "rent" }
  | { name: "maintenance" }
  | { name: "messages" }
  | { name: "vendors" }
  | { name: "settings" }
  | { name: "not-found" };

function parse(path: string): Route {
  if (path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/properties") return { name: "properties" };
  let m = path.match(new RegExp(`^/properties/(${UUID_SEGMENT})$`, "i"));
  if (m) return { name: "property", id: m[1] };
  if (path === "/tenants") return { name: "tenants" };
  m = path.match(new RegExp(`^/tenants/(${UUID_SEGMENT})$`, "i"));
  if (m) return { name: "tenant", id: m[1] };
  if (path === "/leases") return { name: "leases" };
  if (path === "/rent") return { name: "rent" };
  if (path === "/maintenance") return { name: "maintenance" };
  if (path === "/messages") return { name: "messages" };
  if (path === "/vendors") return { name: "vendors" };
  if (path === "/settings") return { name: "settings" };
  return { name: "not-found" };
}

export function useRouter() {
  const [path, setPath] = useState<string>(() => window.location.pathname);

  const navigate = useCallback((to: string) => {
    const href = toAppHref(to);
    if (href === window.location.pathname) return;
    window.history.pushState(null, "", href);
    setPath(href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return { path, route: parse(internalFromLocation(path)), navigate };
}
