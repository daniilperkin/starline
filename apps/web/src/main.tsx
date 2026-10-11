import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initLocale } from "./locale";
import { applyTheme, getThemePreference } from "./theme";
import "./styles.css";

applyTheme(getThemePreference());
initLocale();

// Cloud backup is opt-in and remembered per device: only a device that turned it on loads the
// cloud module at boot (a dynamic import, so a default build never pulls it in).
if (localStorage.getItem("starline.cloud.enabled") === "on") {
  void import("./cloud/session").then((module) => module.registerCloudSnapshotHook());
}

const container = document.getElementById("root");
if (!container) throw new Error("#root missing in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
