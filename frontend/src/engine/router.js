// Tiny path router: "/procurement/orders/:id/approve" → handler, with :params extracted.
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const names = [];
    const source = pattern
      .split("/")
      .map((seg) => {
        if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(seg.slice(1));
        return "([^/]+)";
      })
      .join("/");
    this.routes.push({ method, names, regex: new RegExp(`^${source}$`), handler });
    return this;
  }

  get = (pattern, handler) => this.add("GET", pattern, handler);
  post = (pattern, handler) => this.add("POST", pattern, handler);
  patch = (pattern, handler) => this.add("PATCH", pattern, handler);
  delete = (pattern, handler) => this.add("DELETE", pattern, handler);

  /** { route, params } for a match, { methodNotAllowed: true } when only the verb is wrong, else null. */
  match(method, path) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
