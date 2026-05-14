export const presets = [
  { slug: "miami-1986", title: "Miami 1986", hue: 320, size: 240, grid: 70, scan: 35, stars: 60, tag: "tropical", blurb: "Pastel chrome, palm shadows, the highway never ends." },
  { slug: "tokyo-rain", title: "Tokyo Rain", hue: 200, size: 160, grid: 85, scan: 65, stars: 120, tag: "cyberpunk", blurb: "Wet neon on glass. The vending machine hums in C minor." },
  { slug: "outrun-101", title: "Outrun 101", hue: 0, size: 280, grid: 60, scan: 45, stars: 30, tag: "classic", blurb: "The sun is bigger than the road. As it should be." },
  { slug: "violet-haze", title: "Violet Haze", hue: 280, size: 200, grid: 40, scan: 25, stars: 90, tag: "ambient", blurb: "Slow synth pads. A drink with ice. Twenty years from now." },
  { slug: "acid-wave", title: "Acid Wave", hue: 110, size: 180, grid: 90, scan: 70, stars: 150, tag: "rave", blurb: "303 squelch. The grid eats the floor. You are not tired." },
  { slug: "ghost-arcade", title: "Ghost Arcade", hue: 240, size: 140, grid: 50, scan: 80, stars: 180, tag: "lofi", blurb: "Abandoned mall. CRTs still glowing. No high score to beat." },
];

export function findPreset(slug) {
  return presets.find((p) => p.slug === slug);
}
