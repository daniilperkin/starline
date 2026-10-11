import { describe, expect, it } from "vitest";
import { CLOUD_ENV_KEYS, cloudAvailable, parseCloudConfig } from "./config";

const full: Record<string, string> = {
  VITE_CLOUD_ENABLED: "1",
  [CLOUD_ENV_KEYS.apiKey]: "AIzaSyTESTKEY",
  [CLOUD_ENV_KEYS.appId]: "1:64300754229:android:1497e48cf5ec0857cb587c",
  [CLOUD_ENV_KEYS.projectId]: "starline-backup",
  [CLOUD_ENV_KEYS.webClientId]: "64300754229-test.apps.googleusercontent.com",
};

describe("parseCloudConfig", () => {
  it("returns the four values when the flavor is on and everything is present", () => {
    const config = parseCloudConfig(full);
    expect(config).toEqual({
      apiKey: "AIzaSyTESTKEY",
      appId: "1:64300754229:android:1497e48cf5ec0857cb587c",
      projectId: "starline-backup",
      webClientId: "64300754229-test.apps.googleusercontent.com",
    });
  });

  it("stays null when the flavor flag is off, even with every value present", () => {
    expect(parseCloudConfig({ ...full, VITE_CLOUD_ENABLED: "0" })).toBeNull();
    expect(parseCloudConfig({ ...full, VITE_CLOUD_ENABLED: undefined })).toBeNull();
  });

  it("stays null when any single value is missing", () => {
    for (const key of Object.values(CLOUD_ENV_KEYS)) {
      const partial = { ...full, [key]: "" };
      expect(parseCloudConfig(partial), `missing ${key}`).toBeNull();
    }
  });

  it("treats whitespace-only values as missing", () => {
    expect(parseCloudConfig({ ...full, [CLOUD_ENV_KEYS.projectId]: "   " })).toBeNull();
  });

  it("trims values that arrive with padding", () => {
    const config = parseCloudConfig({ ...full, [CLOUD_ENV_KEYS.projectId]: "  starline-backup  " });
    expect(config?.projectId).toBe("starline-backup");
  });

  it("an empty environment is simply no cloud", () => {
    expect(parseCloudConfig({})).toBeNull();
    expect(cloudAvailable({})).toBe(false);
    expect(cloudAvailable(full)).toBe(true);
  });
});
