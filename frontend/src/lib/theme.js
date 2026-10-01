// Appearance: follow the system by default, or force light / dark. Remembered per browser.
const KEY = "retailmind_theme";

export const readTheme = () => {
  try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; }
};

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  const color = theme === "dark" ? "#000000" : theme === "light" ? "#f2f2f7" : null;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { if (!m.media) m.setAttribute("content", color ?? "#f2f2f7"); });
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* not persisted in private windows */ }
  applyTheme(theme);
}
