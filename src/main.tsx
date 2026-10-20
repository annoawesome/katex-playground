/**
 * Entry point. Applies the theme before React's first render (to avoid a
 * flash of the wrong colours), then mounts the app.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import { App } from "./App";
import { applyTheme, resolveTheme, systemPrefersDark } from "./lib/theme";
import { browserStorage, loadPreferences } from "./lib/storage";

applyTheme(resolveTheme(loadPreferences(browserStorage()).theme, systemPrefersDark()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
