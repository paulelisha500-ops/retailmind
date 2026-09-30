// Workspace-level routes that only exist in the browser edition.
export function register(r) {
  r.get("/health", async (ctx) => ({ status: "ok", environment: "browser", revision: ctx.db.meta.revision }));

  r.get("/workspace", async (ctx) => ({
    edition: "browser",
    seeded_at: new Date(ctx.db.meta.seededAt).toISOString(),
    revision: ctx.db.meta.revision,
  }));

  // Start over from the original data. Every session is invalidated (the signing secret is regenerated).
  r.post("/workspace/reset", async (ctx) => {
    await ctx.requireAdmin();
    await ctx.rt.reset();
    return { status: "ok" };
  });
}
