/**
 * The northern sky the backdrop draws (owner request, 2026-10-14).
 *
 * Twelve iconic northern-hemisphere constellations, each with its real star positions
 * (J2000, orthographic projection centred on the constellation, so the shapes and
 * proportions are true) and real relative magnitudes. `x`/`y` are degrees in a
 * screen-oriented frame (east left, north up); `lines` are asterism joins by index.
 * `span` is the constellation's real angular width/height in degrees, used to keep
 * bigger patterns (the Big Dipper) bigger than small ones (Lyra). Decorative only.
 */

export interface ConstellationStar {
  x: number;
  y: number;
  mag: number;
}

export interface Constellation {
  id: string;
  stars: ConstellationStar[];
  lines: Array<[number, number]>;
  span: number;
}

export const CONSTELLATIONS: Constellation[] = [
  {
    id: "uma",
    stars: [
      { x: 10.4, y: -5.87, mag: 1.79 },
      { x: 12.22, y: -0.82, mag: 2.37 },
      { x: 5.55, y: 3.29, mag: 2.44 },
      { x: 2.26, y: 0.17, mag: 3.31 },
      { x: -3.1, y: 1.04, mag: 1.77 },
      { x: -7.42, y: 1.37, mag: 2.23 },
      { x: -12.22, y: 5.87, mag: 1.86 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
    span: 24.4,
  },
  {
    id: "umi",
    stars: [
      { x: -1.07, y: -9.33, mag: 1.97 },
      { x: -2.36, y: -5.63, mag: 4.36 },
      { x: -2.89, y: -1.01, mag: 4.21 },
      { x: -0.74, y: 3.5, mag: 4.29 },
      { x: -2.78, y: 5.41, mag: 4.95 },
      { x: 1.12, y: 9.33, mag: 3.05 },
      { x: 2.89, y: 6.69, mag: 2.08 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
    span: 18.7,
  },
  {
    id: "cas",
    stars: [
      { x: 6.21, y: 0.71, mag: 2.28 },
      { x: 2.43, y: 3.83, mag: 2.24 },
      { x: 0.16, y: -0.25, mag: 2.47 },
      { x: -3.44, y: 0.07, mag: 2.68 },
      { x: -6.21, y: -3.83, mag: 3.35 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    span: 12.4,
  },
  {
    id: "ori",
    stars: [
      { x: -5.02, y: -7.26, mag: 0.45 },
      { x: 2.42, y: -6.2, mag: 1.64 },
      { x: 5.02, y: 8.3, mag: 0.18 },
      { x: 0.72, y: 0.43, mag: 2.25 },
      { x: -0.33, y: 1.34, mag: 1.69 },
      { x: -1.47, y: 2.08, mag: 1.74 },
      { x: -3.17, y: 9.75, mag: 2.07 },
      { x: -0.06, y: -9.75, mag: 3.39 },
    ],
    lines: [
      [0, 1],
      [1, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      [3, 2],
      [5, 6],
      [7, 0],
      [7, 1],
    ],
    span: 19.5,
  },
  {
    id: "cyg",
    stars: [
      { x: -6.18, y: -8.46, mag: 1.25 },
      { x: -2.96, y: -3.28, mag: 2.23 },
      { x: 8.07, y: 8.46, mag: 3.05 },
      { x: 3.74, y: -8.29, mag: 2.86 },
      { x: -8.07, y: 2.71, mag: 2.48 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [3, 1],
      [1, 4],
    ],
    span: 16.9,
  },
  {
    id: "lyr",
    stars: [
      { x: 2.22, y: -3.05, mag: 0.03 },
      { x: 0.71, y: -1.84, mag: 4.36 },
      { x: -0.35, y: 2.4, mag: 3.52 },
      { x: -2.22, y: 3.05, mag: 3.25 },
      { x: -1.23, y: -1.14, mag: 4.3 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ],
    span: 6.1,
  },
  {
    id: "aql",
    stars: [
      { x: -3.99, y: -6.07, mag: 2.72 },
      { x: -5.12, y: -4.34, mag: 0.77 },
      { x: -6.27, y: -1.89, mag: 3.71 },
      { x: 5.95, y: -9.33, mag: 2.99 },
      { x: 1.14, y: 1.42, mag: 3.36 },
      { x: -1.44, y: 3.55, mag: 3.23 },
      { x: 6.27, y: 9.33, mag: 3.44 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [3, 0],
      [3, 4],
      [4, 1],
      [6, 4],
      [4, 5],
    ],
    span: 18.7,
  },
  {
    id: "tau",
    stars: [
      { x: 6.92, y: 3.06, mag: 3.53 },
      { x: 9.11, y: 6.55, mag: 3.65 },
      { x: 8.31, y: 4.66, mag: 3.76 },
      { x: 6.98, y: 6.37, mag: 3.4 },
      { x: 5.23, y: 5.76, mag: 0.87 },
      { x: -9.11, y: 0.68, mag: 3.0 },
      { x: -5.96, y: -6.55, mag: 1.65 },
    ],
    lines: [
      [0, 2],
      [2, 1],
      [1, 3],
      [3, 4],
      [4, 5],
      [0, 6],
    ],
    span: 18.2,
  },
  {
    id: "gem",
    stars: [
      { x: -7.48, y: -9.57, mag: 1.58 },
      { x: -10.12, y: -5.93, mag: 1.14 },
      { x: 5.05, y: 6.06, mag: 1.9 },
      { x: 3.4, y: -2.62, mag: 2.98 },
      { x: -1.23, y: 1.95, mag: 3.79 },
      { x: -4.91, y: 0.44, mag: 3.53 },
      { x: 10.12, y: -0.29, mag: 3.28 },
      { x: 8.28, y: -0.19, mag: 2.87 },
      { x: 3.28, y: 9.57, mag: 3.35 },
    ],
    lines: [
      [0, 3],
      [3, 4],
      [4, 7],
      [7, 8],
      [4, 5],
      [5, 2],
      [1, 5],
      [6, 7],
    ],
    span: 20.2,
  },
  {
    id: "leo",
    stars: [
      { x: 9.68, y: 7.08, mag: 1.35 },
      { x: 9.8, y: 2.29, mag: 3.48 },
      { x: 6.74, y: -0.7, mag: 2.08 },
      { x: 7.42, y: -4.29, mag: 3.44 },
      { x: 12.67, y: -7.08, mag: 3.88 },
      { x: 14.39, y: -4.96, mag: 2.98 },
      { x: -5.9, y: -1.65, mag: 2.56 },
      { x: -6.21, y: 3.43, mag: 3.33 },
      { x: -14.39, y: 3.58, mag: 2.14 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [2, 6],
      [6, 7],
      [7, 0],
      [6, 8],
      [7, 8],
    ],
    span: 28.8,
  },
  {
    id: "boo",
    stars: [
      { x: 4.02, y: 10.34, mag: -0.05 },
      { x: -2.77, y: 2.58, mag: 2.35 },
      { x: -8.97, y: -4.0, mag: 3.47 },
      { x: -5.68, y: -10.79, mag: 3.49 },
      { x: 0.02, y: -8.6, mag: 3.03 },
      { x: 0.15, y: -0.69, mag: 3.58 },
      { x: 8.97, y: 10.79, mag: 2.68 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      [0, 6],
    ],
    span: 21.6,
  },
  {
    id: "crb",
    stars: [
      { x: 2.5, y: -2.65, mag: 4.14 },
      { x: 3.67, y: -0.43, mag: 3.68 },
      { x: 2.22, y: 2.0, mag: 2.23 },
      { x: 0.42, y: 2.43, mag: 3.84 },
      { x: -1.12, y: 2.65, mag: 4.59 },
      { x: -2.9, y: 1.81, mag: 4.14 },
      { x: -3.67, y: -1.19, mag: 4.98 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
    span: 7.3,
  },
];
