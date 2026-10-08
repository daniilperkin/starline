#!/usr/bin/env node
// Launches the Android emulator DOCKED for hands-on testing: the phone window is
// bottom-anchored at the right edge of the primary screen, resized to ~85% of the
// working-area height with its aspect preserved (never taller than the screen, never
// clipped at the top). Use this instead of a bare `emulator -avd ...` so the window
// always lands somewhere usable. Idempotent: if the emulator is already running it
// just re-docks the window.
//
// The docked rect is also written back to the AVD's emulator-user.ini, so even a
// manual launch (Android Studio) starts near the same spot.
//
// Usage: node scripts/launch-emulator.mjs [avd] [--app]
//   --app  install artifacts/starline-debug.apk and open StarLine when boot finishes
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const withApp = argv.includes("--app");
const avd = argv.find((arg) => !arg.startsWith("--")) ?? "medium_phone";

const sdk =
  process.env.LOCALAPPDATA !== undefined
    ? join(process.env.LOCALAPPDATA, "Android", "Sdk")
    : join(homedir(), "AppData", "Local", "Android", "Sdk");
const emulator = join(sdk, "emulator", "emulator.exe");
const adb = join(sdk, "platform-tools", "adb.exe");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function powershell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

// Dock: bottom-right anchor, 85% working-area height, phone aspect, small margin.
const DOCK_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public class Win {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
$proc = Get-Process qemu-system-x86_64,emulator -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { exit 2 }
$h = $proc.MainWindowHandle
$r = New-Object RECT
[void][Win]::GetWindowRect($h, [ref]$r)
$curW = $r.Right - $r.Left
$curH = $r.Bottom - $r.Top
if ($curW -le 0 -or $curH -le 0) { exit 2 }
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
# The window is only trustworthy once it has settled into a portrait phone shape;
# before that (splash) fall back to the standard phone aspect.
$ratio = 0.45
if ($curH -ge $curW * 1.5) { $ratio = $curW / [double]$curH }
$targetH = [int]($wa.Height * 0.85)
$targetW = [int]($targetH * $ratio)
$maxW = [int]($wa.Width * 0.4)
if ($targetW -gt $maxW) {
  $targetW = $maxW
  $targetH = [int]($targetW / $ratio)
}
$margin = 12
$x = $wa.Right - $targetW - $margin
$y = $wa.Bottom - $targetH - $margin
[void][Win]::MoveWindow($h, $x, $y, $targetW, $targetH, $true)
"$x,$y,$targetW,$targetH"
`;

function emulatorRunning() {
  try {
    return execFileSync(adb, ["devices"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .includes("emulator-");
  } catch {
    return false;
  }
}

let launched = false;
if (emulatorRunning()) {
  console.log("emulator already running — re-docking its window");
} else {
  console.log(`launching ${avd}…`);
  spawn(
    emulator,
    [avd ? "-avd" : "-avd", avd, "-no-snapshot-save", "-gpu", "swiftshader_indirect", "-no-boot-anim", "-no-audio"],
    { detached: true, stdio: "ignore" },
  ).unref();
  launched = true;
}

// Dock once the Qt window exists (retry while it is being created).
let docked = null;
for (let attempt = 0; attempt < 60 && docked === null; attempt++) {
  try {
    docked = powershell(DOCK_SCRIPT);
  } catch {
    await sleep(2000);
  }
}
if (docked === null) throw new Error("emulator window never appeared");
console.log(`window docked (x,y,w,h): ${docked}`);

// Remember the docked position for manual launches too (best effort).
try {
  const iniPath = join(homedir(), ".android", "avd", `${avd}.avd`, "emulator-user.ini");
  const [x, y] = docked.split(",").map((value) => Number.parseInt(value, 10));
  if (existsSync(iniPath) && Number.isFinite(x) && Number.isFinite(y)) {
    const lines = readFileSync(iniPath, "utf8").split(/\r?\n/);
    const set = (key, value) => {
      const index = lines.findIndex((line) => line.startsWith(`${key} =`));
      if (index >= 0) lines[index] = `${key} = ${value}`;
      else lines.push(`${key} = ${value}`);
    };
    set("window.x", x);
    set("window.y", y);
    writeFileSync(iniPath, lines.join("\r\n"));
    console.log(`remembered window position in ${iniPath}`);
  }
} catch {
  // best effort only — the dock above is what matters
}

if (launched) {
  execFileSync(adb, ["wait-for-device"], { stdio: "ignore" });
  let booted = false;
  for (let attempt = 0; attempt < 90 && !booted; attempt++) {
    const boot = execFileSync(adb, ["shell", "getprop", "sys.boot_completed"])
      .toString()
      .trim();
    booted = boot === "1";
    if (!booted) await sleep(2000);
  }
  if (!booted) throw new Error("emulator never finished booting");
  console.log("boot completed");
}

// Second pass: the emulator can re-size its window once the device UI is fully up —
// dock again so the final rect is the docked one.
try {
  const redocked = powershell(DOCK_SCRIPT);
  console.log(`window re-docked after boot (x,y,w,h): ${redocked}`);
} catch {
  // keep the first dock if the window vanished (user closed it)
}

if (withApp) {
  const apk = join(repoRoot, "artifacts", "starline-debug.apk");
  if (!existsSync(apk)) {
    throw new Error(`APK not found: ${apk} — build it first (see references/phone-pwa.md)`);
  }
  execFileSync(adb, ["install", "-r", apk], { stdio: "inherit" });
  execFileSync(adb, ["shell", "am", "start", "-n", "app.starline/.MainActivity"]);
  console.log("StarLine installed and opened — the phone is ready to tap.");
}
