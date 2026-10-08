import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, getThemePreference } from "./theme";
import "./styles.css";

applyTheme(getThemePreference());

const container = document.getElementById("root");
if (!container) throw new Error("#root missing in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
