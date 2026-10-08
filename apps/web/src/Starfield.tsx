import { useEffect, useRef } from "react";

const SEED = 0x53544152; // "STAR"

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

/**
 * The signature backdrop (docs/DESIGN.md): a seeded, static starfield with three
 * constellation clusters and two nebula washes. Drawn once per size or theme change —
 * no animation, no battery cost, stable across launches because the seed is fixed.
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const styles = getComputedStyle(document.documentElement);
      const dark = document.documentElement.dataset.theme !== "light";
      const starColor = styles.getPropertyValue("--sl-star").trim() || "#cdd5ff";
      const accent = styles.getPropertyValue("--sl-accent").trim() || "#f6c760";

      // Two soft nebula washes give the sky depth.
      const wash = ctx.createRadialGradient(
        width * 0.18,
        height * 0.12,
        0,
        width * 0.18,
        height * 0.12,
        Math.max(width, height) * 0.75,
      );
      wash.addColorStop(0, dark ? "rgba(139,124,246,0.10)" : "rgba(91,70,214,0.05)");
      wash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      const wash2 = ctx.createRadialGradient(
        width * 0.85,
        height * 0.9,
        0,
        width * 0.85,
        height * 0.9,
        Math.max(width, height) * 0.6,
      );
      wash2.addColorStop(0, dark ? "rgba(64,140,255,0.07)" : "rgba(64,140,255,0.04)");
      wash2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash2;
      ctx.fillRect(0, 0, width, height);

      const rand = mulberry32(SEED);
      const starCount = Math.floor((width * height) / 3600);
      for (let i = 0; i < starCount; i++) {
        const x = rand() * width;
        const y = rand() * height;
        const radius = 0.4 + rand() * 1.3;
        const gold = rand() < 0.14;
        ctx.globalAlpha = (0.22 + rand() * 0.6) * (dark ? 1 : 0.5);
        ctx.fillStyle = gold ? accent : starColor;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Three constellation clusters: a handful of nodes joined by faint lines.
      ctx.strokeStyle = dark ? "rgba(139,124,246,0.22)" : "rgba(91,70,214,0.14)";
      ctx.lineWidth = 0.7;
      for (let cluster = 0; cluster < 3; cluster++) {
        const cx = (0.15 + rand() * 0.7) * width;
        const cy = (0.12 + rand() * 0.6) * height;
        const nodes: Array<[number, number]> = [];
        const nodeCount = 4 + Math.floor(rand() * 3);
        for (let k = 0; k < nodeCount; k++) {
          nodes.push([cx + (rand() - 0.5) * 220, cy + (rand() - 0.5) * 180]);
        }
        ctx.beginPath();
        nodes.forEach(([x, y], index) => {
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        for (const [x, y] of nodes) {
          ctx.globalAlpha = dark ? 0.9 : 0.55;
          ctx.fillStyle = starColor;
          ctx.beginPath();
          ctx.arc(x, y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };

    draw();
    const onResize = () => draw();
    const onTheme = () => draw();
    window.addEventListener("resize", onResize);
    window.addEventListener("starline:theme", onTheme);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("starline:theme", onTheme);
    };
  }, []);

  return <canvas ref={canvasRef} className="sl-starfield" role="presentation" />;
}
