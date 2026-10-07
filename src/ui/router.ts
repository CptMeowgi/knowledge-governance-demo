/**
 * Hash routing in a few lines. Hash URLs work on GitHub Pages without any
 * server-side redirect setup, which is why there's no router dependency.
 */
import { useEffect, useState } from "react";

export interface Route {
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  return {
    segments: path.split("/").filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(search),
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** An href for an in-app path, e.g. link("/gaps"). */
export const link = (path: string) => `#${path}`;

export const go = (path: string) => {
  window.location.hash = path;
};
