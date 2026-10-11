import { useEffect, useRef } from "react";
import { STARFIELD_EVENT, starfieldAnimated } from "./effects";

const SEED = 0x53544152; // "STAR"
const FRAME_MS = 40; // ~25 fps cap keeps the twinkle gentle on battery

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  twinkle: number;
  phase: number;
  gold: boolean;
}

/**
 * The signature backdrop (docs/DESIGN.md, owner decision 11 / "more cosmic"): a seeded
 * starfield with constellation clusters and brighter nebulas, gently twinkling and drifting.
 * Battery-aware — ~25 fps cap, paused while the tab is hidden, and fully static for
 * prefers-reduced-motion users. The seed keeps the same sky on every launch.
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let clusters: Array<Array<[number, number]>> = [];
    let raf = 0;
    let lastPaint = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const setup = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const rand = mulberry32(SEED);
      const starCount = Math.floor((width * height) / 3600);
      stars = [];
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: rand() * width,
          y: rand() * height,
          radius: 0.4 + rand() * 1.3,
          baseAlpha: 0.22 + rand() * 0.6,
          twinkle: rand() < 0.3 ? 0.1 + rand() * 0.25 : 0,
          phase: rand() * Math.PI * 2,
          gold: rand() < 0.14,
        });
      }

      clusters = [];
      for (let cluster = 0; cluster < 3; cluster++) {
        const cx = (0.15 + rand() * 0.7) * width;
        const cy = (0.12 + rand() * 0.6) * height;
        const nodes: Array<[number, number]> = [];
        const nodeCount = 4 + Math.floor(rand() * 3);
        for (let k = 0; k < nodeCount; k++) {
          nodes.push([cx + (rand() - 0.5) * 220, cy + (rand() - 0.5) * 180]);
        }
        clusters.push(nodes);
      }
    };

    const paint = (t: number) => {
      const styles = getComputedStyle(document.documentElement);
      const dark = document.documentElement.dataset.theme !== "light";
      const starColor = styles.getPropertyValue("--sl-star").trim() || "#cdd5ff";
      const accent = styles.getPropertyValue("--sl-accent").trim() || "#f6c760";
      const drift = (t * 0.002) % width; // one very slow sky rotation
      const shift = (x: number) => (x + drift) % width;

      ctx.clearRect(0, 0, width, height);

      // Brighter nebulas (owner decision 11): violet, blue, and a faint gold haze.
      const washes: Array<[number, number, number, string]> = [
        [0.18, 0.12, 0.75, dark ? "rgba(139,124,246,0.16)" : "rgba(91,70,214,0.05)"],
        [0.85, 0.9, 0.6, dark ? "rgba(64,140,255,0.12)" : "rgba(64,140,255,0.04)"],
        [0.6, 0.35, 0.5, dark ? "rgba(246,199,96,0.05)" : "rgba(246,199,96,0.03)"],
      ];
      for (const [fx, fy, falloff, color] of washes) {
        const gradient = ctx.createRadialGradient(
          width * fx,
          height * fy,
          0,
          width * fx,
          height * fy,
          Math.max(width, height) * falloff,
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      // Stars, gently twinkling.
      for (const star of stars) {
        const alpha =
          (star.baseAlpha + star.twinkle * Math.sin(star.phase + t * 0.0004)) * (dark ? 1 : 0.5);
        ctx.globalAlpha = Math.max(0.05, Math.min(1, alpha));
        ctx.fillStyle = star.gold ? accent : starColor;
        ctx.beginPath();
        ctx.arc(shift(star.x), star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Three constellation clusters, joined by faint lines.
      ctx.strokeStyle = dark ? "rgba(139,124,246,0.22)" : "rgba(91,70,214,0.14)";
      ctx.lineWidth = 0.7;
      for (const nodes of clusters) {
        ctx.beginPath();
        nodes.forEach(([x, y], index) => {
          const nx = shift(x);
          if (index === 0) ctx.moveTo(nx, y);
          else ctx.lineTo(nx, y);
        });
        ctx.stroke();
        for (const [x, y] of nodes) {
          ctx.globalAlpha = dark ? 0.9 : 0.55;
          ctx.fillStyle = starColor;
          ctx.beginPath();
          ctx.arc(shift(x), y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };

    const step = (t: number) => {
      if (t - lastPaint >= FRAME_MS || lastPaint === 0) {
        lastPaint = t;
        paint(t);
      }
      raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (raf !== 0) return;
      if (reducedMotion.matches || !starfieldAnimated()) {
        paint(100000); // one stable, deterministic frame when motion is off (OS or Settings)
        return;
      }
      raf = requestAnimationFrame(step);
    };

    const stop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    const onResizeOrTheme = () => {
      setup();
      if (raf === 0) paint(100000);
    };
    const onReducedMotion = () => {
      stop();
      start();
    };
    const onPrefChange = () => {
      stop();
      setup();
      start();
    };

    setup();
    start();
    window.addEventListener("resize", onResizeOrTheme);
    window.addEventListener("starline:theme", onResizeOrTheme);
    document.addEventListener("visibilitychange", onVisibility);
    reducedMotion.addEventListener("change", onReducedMotion);
    window.addEventListener(STARFIELD_EVENT, onPrefChange);
    return () => {
      stop();
      window.removeEventListener("resize", onResizeOrTheme);
      window.removeEventListener("starline:theme", onResizeOrTheme);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotion.removeEventListener("change", onReducedMotion);
      window.removeEventListener(STARFIELD_EVENT, onPrefChange);
    };
  }, []);

  // Decorative backdrop (docs/DESIGN.md): nothing in it is focusable or readable.
  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative starfield; no focusable content inside.
  return <canvas ref={canvasRef} className="sl-starfield" aria-hidden="true" />;
}
