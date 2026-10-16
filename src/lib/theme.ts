/**
 * Light/dark theme resolution.
 *
 * The user's preference is "system", "light" or "dark". "system" follows the
 * operating system via the `prefers-color-scheme` media query, live: if the OS
 * switches at sunset, so does the app. The resolved theme is written to
 * `<html data-theme="…">`, and all colours in styles.css are CSS variables
 * keyed off that attribute.
 */
import type { ThemePreference } from "./storage";

export type ResolvedTheme = "light" | "dark";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/** Reads the OS preference; false where matchMedia is unavailable. */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY).matches
    : false;
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  // Lets native widgets (scrollbars, form controls) match the theme.
  document.documentElement.style.colorScheme = theme;
}
