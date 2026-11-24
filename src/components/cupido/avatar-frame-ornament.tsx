import { useId } from "react";
import type { ReactNode } from "react";
import type { EquippedAvatarFrame } from "@/lib/avatar-frames";

type Motif = string;

type FrameTheme = { name: string; motif: Motif };

const FRAME_THEMES: readonly FrameTheme[] = [
  { name: "Novato Rosa", motif: "rose" }, { name: "Destello Inicial", motif: "crown" }, { name: "Corazón Brillante", motif: "hearts" },
  { name: "Aro de Rubí", motif: "diamond" }, { name: "Perla de Luna", motif: "pearl" }, { name: "Oro Rosado", motif: "laurel" },
  { name: "Loto Celeste", motif: "flowers" }, { name: "Chispa Violeta", motif: "lightning" }, { name: "Aurora Tropical", motif: "beach" },
  { name: "Jardín de Cristal", motif: "butterfly" }, { name: "Corona de Fuego", motif: "flame" }, { name: "Olas Turquesa", motif: "moon" },
  { name: "Alas de Amor", motif: "wings" }, { name: "Diamante Rosa", motif: "diamond" }, { name: "Nébula Real", motif: "galaxy" },
  { name: "Reina del Caribe", motif: "crown" }, { name: "Rey del Caribe", motif: "crown" }, { name: "Lluvia de Estrellas", motif: "winged-star" },
  { name: "Doble Corazón", motif: "hearts" }, { name: "Prisma Dorado", motif: "diamond" }, { name: "Fénix Carmesí", motif: "phoenix" },
  { name: "Sirena Azul", motif: "beach" }, { name: "Cometa de Plata", motif: "galaxy" }, { name: "Joya Esmeralda", motif: "clover" },
  { name: "Mariposa Celeste", motif: "butterfly" }, { name: "Galaxia de Amor", motif: "galaxy" }, { name: "Corona Imperial", motif: "crown" },
  { name: "Dragón de Rubí", motif: "dragon" }, { name: "Oro Líquido", motif: "laurel" }, { name: "Flor de Medianoche", motif: "rose" },
  { name: "Alas Celestiales", motif: "wings" }, { name: "Fuego Sagrado", motif: "flame" }, { name: "Aqua Reina", motif: "beach" },
  { name: "Diamante Azul", motif: "diamond" }, { name: "Sol de Gran Liga", motif: "sun" }, { name: "Luna de Gran Liga", motif: "moon" },
  { name: "Emperatriz Dorada", motif: "crown" }, { name: "Emperador de Cristal", motif: "laurel" }, { name: "Fénix Legendario", motif: "phoenix" },
  { name: "Dragón Imperial", motif: "dragon" }, { name: "Tormenta Neón", motif: "lightning" }, { name: "Océano Místico", motif: "beach" },
  { name: "Aurora Boreal", motif: "galaxy" }, { name: "Corona de Zafiro", motif: "crown" }, { name: "Galaxia Suprema", motif: "galaxy" },
  { name: "Alas del Paraíso", motif: "wings" }, { name: "Llama Infinita", motif: "flame" }, { name: "Reina de Diamantes", motif: "diamond" },
  { name: "Rey de Diamantes", motif: "diamond" }, { name: "Diosa del Amor", motif: "hearts" }, { name: "Titán Dorado", motif: "trophy" },
  { name: "Dragón Celestial", motif: "dragon" }, { name: "Prisma Infinito", motif: "diamond" }, { name: "Fénix de Platino", motif: "phoenix" },
  { name: "Soberano Cósmico", motif: "galaxy" }, { name: "Corazón Eterno", motif: "hearts" }, { name: "Leyenda de Cristal", motif: "snowflake" },
  { name: "Diosa Suprema", motif: "wings" }, { name: "Leyenda Suprema Pro", motif: "crown" },
];

const CARDS = ["♠", "♥", "♦", "♣"] as const;

const PREMIUM_MOTIFS = [
  "red-roses", "winged-star", "rose-heart", "diamond", "pearl", "gold-laurel", "flowers", "lightning", "beach", "butterfly",
  "flame", "moon", "heart-wings", "phoenix-diamond", "crystal-galaxy", "flag-crown", "lion-laurel", "winged-star", "hearts", "diamond",
  "royal-phoenix", "sea-flower", "galaxy", "clover", "butterfly", "galaxy-wings", "laurel-crown", "dragon-gem", "laurel", "red-roses",
  "treasure-star", "fire-wings", "bamboo-flower", "diamond", "sun-laurel", "wolf-moon", "supreme-crown", "crystal-laurel", "phoenix", "imperial-dragon",
  "lightning", "ocean-wings", "galaxy", "ice-crown", "curtain", "wings", "flame", "phoenix-diamond", "royal-cards", "heart-wings",
  "trophy", "imperial-dragon", "diamond", "phoenix-diamond", "cosmic-star", "rose-heart", "angel-snow", "supreme-crown", "poker-royal",
];

function Flower({ x, y, color, scale = 1 }: { x: number; y: number; color: string; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    {Array.from({ length: 6 }, (_, i) => <ellipse key={i} cx="0" cy="-3.4" rx="1.6" ry="3" transform={`rotate(${i * 60})`} fill={color} stroke="#fff8" strokeWidth=".45" />)}
    <circle r="1.65" fill="#fff0a8" stroke="#fff" strokeWidth=".4" />
  </g>;
}

function Gem({ x, y, color, scale = 1 }: { x: number; y: number; color: string; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 -5 L4 -2.3 L3.1 2.8 L0 5 L-3.1 2.8 L-4 -2.3Z" fill={color} stroke="#fff" strokeWidth=".85" />
    <path d="M-3.8 -2.1H3.8M-2.8 -2L0 4.3L2.8 -2" fill="none" stroke="#fff9" strokeWidth=".55" />
    <path d="M-1.5 -3.8L-.4 -4.4" stroke="#fff" strokeWidth=".8" strokeLinecap="round" />
  </g>;
}

function MotifArt({ motif, a, b, level }: { motif: Motif; a: string; b: string; level: number }) {
  const rotation = (level * 17) % 360;
  const crown = <g className="af-crown" transform="translate(50 8)">
    <path d="M-14 5L-18 -4L-8 1L-4 -8L1 0L8 -7L10 1L18 -3L14 6Z" fill={a} stroke="#fff2bb" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M-14 7H14L12 10H-12Z" fill="#8d5524" stroke="#ffe5a2" strokeWidth=".8" />
    <circle cx="0" cy="2" r="2.1" fill={b} stroke="#fff" strokeWidth=".7" />
    <circle cx="-9" cy="3" r="1.15" fill="#fff2bb" /><circle cx="9" cy="3" r="1.15" fill="#fff2bb" />
  </g>;
  const wings = <g className="af-flutter" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M44 50C34 42 25 34 13 34C16 42 23 48 32 51C23 51 16 54 10 61C24 65 36 60 44 53Z" fill={a} fillOpacity=".68" stroke="#fff2cf" strokeWidth="1.3" />
    <path d="M56 50C66 42 75 34 87 34C84 42 77 48 68 51C77 51 84 54 90 61C76 65 64 60 56 53Z" fill={b} fillOpacity=".68" stroke="#fff2cf" strokeWidth="1.3" />
    {[0, 1, 2].map((i) => <g key={i} stroke="#fff9" strokeWidth=".8"><path d={`M${42 - i * 3} ${49 + i * 2}Q${30 - i * 4} ${42 + i * 5} ${19 - i * 2} ${39 + i * 6}`} /><path d={`M${58 + i * 3} ${49 + i * 2}Q${70 + i * 4} ${42 + i * 5} ${81 + i * 2} ${39 + i * 6}`} /></g>)}
    <circle cx="50" cy="51" r="2.2" fill="#fff1b8" stroke={a} strokeWidth=".8" />
  </g>;
  const laurel = <g fill={a} stroke="#fff2bb" strokeWidth=".6" className="af-laurel">
    <path d="M18 77C8 62 8 43 19 29M82 77C92 62 92 43 81 29" fill="none" stroke={b} strokeWidth="1.5" />
    {Array.from({ length: 6 }, (_, i) => <g key={i} transform={`rotate(${i * 19 - 45} ${18 + i * .7} ${69 - i * 7})`}><ellipse cx={18 + i * .7} cy={69 - i * 7} rx="2" ry="4" /></g>)}
    {Array.from({ length: 6 }, (_, i) => <g key={i} transform={`rotate(${180 - i * 19 + 45} ${82 - i * .7} ${69 - i * 7})`}><ellipse cx={82 - i * .7} cy={69 - i * 7} rx="2" ry="4" /></g>)}
  </g>;
  const fire = <g className="af-energy">
    {[0, 90, 180, 270].map((angle) => <g key={angle} transform={`rotate(${angle} 50 50)`}>
      <path d="M50 5C45 11 48 13 45 17C51 16 52 13 50 5Z" transform="translate(0 0)" fill={a} stroke="#fff5c7" strokeWidth=".7" />
      <path d="M50 8C48 12 50 13 49 15" fill="none" stroke="#fff" strokeWidth=".8" />
    </g>)}
  </g>;
  const lightning = <g className="af-spark">
    <path d="M23 13L19 21L24 20L21 28L29 18L24 19L27 13Z" fill={a} stroke="#fff" strokeWidth=".8" />
    <path d="M77 72L73 80L78 79L75 87L83 77L78 78L81 72Z" fill={b} stroke="#fff" strokeWidth=".8" />
    <path d="M72 15L70 19L73 19L71 23L76 18L73 18L75 15Z" fill="#fff4aa" />
  </g>;
  const clover = <g className="af-shimmer" fill={a} stroke="#efffc0" strokeWidth=".8">
    <g transform="translate(50 8)"><circle cx="-3" cy="0" r="3"/><circle cx="3" cy="0" r="3"/><circle cy="-3" r="3"/><path d="M0 1L-1 7" /></g>
    <g transform="translate(15 74) scale(.72)"><circle cx="-3" cy="0" r="3"/><circle cx="3" cy="0" r="3"/><circle cy="-3" r="3"/><path d="M0 1L-1 7" /></g>
  </g>;
  const hearts = <g className="af-shimmer" fill={a} stroke="#fff" strokeWidth=".85">
    <path d="M50 3C47 -1 41 2 44 6L50 12L56 6C59 2 53 -1 50 3Z" />
    <path d="M50 88C47 84 41 87 44 91L50 97L56 91C59 87 53 84 50 88Z" fill={b} />
    <path d="M10 49C7 45 1 48 4 52L10 58L16 52C19 48 13 45 10 49Z" fill={b} />
    <path d="M90 39C87 35 81 38 84 42L90 48L96 42C99 38 93 35 90 39Z" />
  </g>;
  const trophy = <g transform="translate(50 90)" className="af-shimmer">
    <path d="M-7 -7H7V-2Q7 3 0 5Q-7 3 -7 -2Z" fill={a} stroke="#fff2bd" strokeWidth="1" />
    <path d="M-7 -4H-12Q-12 2 -5 2M7 -4H12Q12 2 5 2M0 5V9M-5 10H5" fill="none" stroke={b} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M0 -6L1 -2L4 -2L2 0L3 3L0 1L-3 3L-2 0L-4 -2L-1 -2Z" fill="#fff3b4" />
  </g>;
  const cards = <g className="af-spark" stroke="#fff" strokeWidth=".8" fontSize="5" fontWeight="bold" textAnchor="middle">
    {CARDS.map((symbol, i) => <g key={symbol} transform={`translate(${20 + i * 20} ${i % 2 ? 89 : 10}) rotate(${i % 2 ? 12 : -12})`}>
      <rect x="-4.5" y="-6" width="9" height="12" rx="1.5" fill="#fff6e8" stroke={i % 2 ? "#d93a56" : "#22508f"} />
      <text y="1.8" fill={i % 2 ? "#d93a56" : "#22508f"} stroke="none">{symbol}</text>
    </g>)}
  </g>;
  const dice = <g className="af-spark" fill="#fff9e8" stroke={a} strokeWidth="1">
    <g transform="translate(14 50) rotate(-12)"><rect x="-6" y="-6" width="12" height="12" rx="2"/><circle cx="-3" cy="-3" r=".8" fill={b}/><circle cx="3" cy="3" r=".8" fill={b}/><circle r=".8" fill={b}/></g>
    <g transform="translate(86 50) rotate(14)"><rect x="-6" y="-6" width="12" height="12" rx="2"/><circle cx="-3" cy="-3" r=".8" fill={b}/><circle cx="3" cy="-3" r=".8" fill={b}/><circle cx="-3" cy="3" r=".8" fill={b}/><circle cx="3" cy="3" r=".8" fill={b}/></g>
  </g>;
  const snowflake = <g className="af-orbit" stroke="#e6fcff" strokeWidth="1" strokeLinecap="round">
    {[0, 45, 90, 135].map((angle) => <g key={angle} transform={`rotate(${angle} 50 8)`}><path d="M50 2V14M47 5L50 8L53 5M47 11L50 8L53 11" /></g>)}
    <circle cx="50" cy="8" r="7" fill="none" stroke={a} strokeWidth=".7" />
  </g>;
  const flowers = <g className="af-shimmer">{([[50, 7], [91, 50], [50, 93], [9, 50], [21, 20], [79, 80]] as const).map(([x, y], i) => <Flower key={i} x={x} y={y} color={i % 2 ? a : b} scale={i < 4 ? .8 : .55} />)}</g>;
  const bamboo = <g className="af-sway" fill="none" strokeLinecap="round">
    {[15, 85].map((x, i) => <g key={x} transform={`rotate(${i ? 5 : -5} ${x} 50)`}><path d={`M${x} 17V83M${x - 3} 30H${x + 3}M${x - 3} 48H${x + 3}M${x - 3} 66H${x + 3}`} stroke={a} strokeWidth="2" />{[25, 43, 61].map((y) => <path key={y} d={`M${x} ${y}q-8 -8 -10 -6M${x} ${y + 2}q8 -9 10 -7`} stroke={b} strokeWidth="1.5" />)}</g>)}
  </g>;
  const beach = <g className="af-sway" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="50" cy="7" r="4" fill="#ffe29b" stroke="#fff4ca" strokeWidth=".8" />
    <path d="M50 12Q49 18 47 22M47 22L43 21M47 22L50 19M47 22L52 22" stroke={a} strokeWidth="1.3" />
    <path d="M20 82q8 -3 16 0t16 0t16 0t16 0M17 87q8 -3 16 0t16 0t16 0t16 0" stroke={b} strokeWidth="1.2" />
    <path d="M79 23V16M79 17Q72 12 72 17Q76 20 79 17Q84 11 87 16Q84 20 79 17Z" fill={a} stroke="#fff" strokeWidth=".7" />
  </g>;
  const phoenix = <g className="af-flutter" fill="none" stroke="#fff4c3" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M50 5L54 12L50 10L46 15L47 8Z" fill={a} />
    <path d="M48 11Q34 4 27 14Q38 12 44 18Q35 17 32 24Q43 22 50 17Q57 22 68 24Q65 17 56 18Q62 12 73 14Q66 4 52 11Z" fill={b} fillOpacity=".72" />
    <path d="M50 16Q43 24 48 29L50 25L53 30Q58 23 52 16" fill={a} />
    <path d="M49 28Q42 33 46 37M51 29Q58 33 54 38" stroke={a} />
  </g>;
  const wolf = <g className="af-glow" transform="translate(50 8)" stroke="#fff" strokeWidth=".8">
    <path d="M-10 3L-12 -5L-5 -2L0 -7L5 -2L12 -5L10 3L7 9L0 12L-7 9Z" fill={a} />
    <path d="M-6 3L-3 4M6 3L3 4M-3 8L0 6L3 8" fill="none" stroke={b} strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="-4" cy="3" r=".7" fill="#fff"/><circle cx="4" cy="3" r=".7" fill="#fff"/>
  </g>;
  const lion = <g className="af-glow" transform="translate(50 8)" stroke="#fff2c6" strokeWidth=".8">
    <path d="M0 -10L3 -7L8 -8L9 -3L12 0L9 4L8 9L3 8L0 11L-3 8L-8 9L-9 4L-12 0L-9 -3L-8 -8L-3 -7Z" fill={a} />
    <path d="M-5 -1Q0 -5 5 -1L4 5L0 8L-4 5Z" fill={b} /><path d="M-3 1L-2 2M3 1L2 2M-2 5L0 4L2 5" fill="none" stroke="#fff" strokeLinecap="round" />
  </g>;
  const galaxy = <g className="af-orbit" fill="none" strokeLinecap="round">
    <ellipse cx="50" cy="8" rx="13" ry="5" transform={`rotate(${rotation} 50 8)`} stroke={a} strokeWidth="1.1" />
    <ellipse cx="50" cy="8" rx="9" ry="3.5" transform={`rotate(${-rotation} 50 8)`} stroke="#fff9" strokeWidth=".7" />
    <circle cx="50" cy="8" r="2.5" fill={b} stroke="#fff" strokeWidth=".8" />
    <circle cx="39" cy="8" r="1.3" fill="#fff" /><circle cx="61" cy="8" r="1.1" fill={a} />
  </g>;
  const dragon = <g className="af-sway" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 72Q19 63 14 55Q11 48 20 43Q27 39 22 33Q18 29 22 24L28 27L31 21L34 29Q31 37 26 39Q19 43 22 48Q27 54 22 60Q18 67 11 72Z" fill={a} fillOpacity=".72" stroke="#fff1c1" strokeWidth=".9" />
    <path d="M23 35L17 31L25 30L29 35M21 44L14 42L20 39" fill={b} stroke="#fff" strokeWidth=".65" />
    <circle cx="25" cy="33" r=".8" fill="#fff" />
  </g>;
  const flag = <g transform="translate(83 19) rotate(35)" className="af-flutter" stroke="#fff" strokeWidth=".65">
    <path d="M-8 -6H8V6H-8Z" fill="#fff" />
    <path d="M-8 -6H-1V-1H-8ZM1 -6H8V-1H1ZM-8 1H-1V6H-8ZM1 1H8V6H1Z" fill="#17479e" />
    <path d="M-1 -6H1V6H-1ZM-8 -1H8V1H-8Z" fill="#ce1126" />
    <rect x="-8" y="-6" width="16" height="12" fill="none" />
  </g>;
  const treasure = <g transform="translate(50 91)" className="af-glow" stroke="#fff0b4" strokeWidth=".8">
    <path d="M-12 -2Q-11 -9 0 -9Q11 -9 12 -2V2H-12Z" fill={b} />
    <path d="M-13 -2H13V7H-13Z" fill={a} /><path d="M-2 -8H2V7H-2Z" fill="#ffe6a0" />
    <path d="M-5 1L0 -3L5 1V5H-5Z" fill={b} /><circle cy="2" r="1" fill="#fff" />
  </g>;
  const wingedStar = <g className="af-flutter" stroke="#fff4c7" strokeWidth=".8" strokeLinejoin="round">
    <path d="M50 1L53 6L59 6L55 10L57 16L50 13L43 16L45 10L41 6L47 6Z" fill={a} />
    <path d="M44 9Q35 3 31 8L42 13M56 9Q65 3 69 8L58 13" fill={b} />
    <circle cx="50" cy="9" r="1.2" fill="#fff" />
  </g>;
  const moon = <g className="af-shimmer" transform="translate(50 8)">
    <path d="M4 -9A9 9 0 1 0 8 6A7 7 0 1 1 4 -9Z" fill={a} stroke="#fff6d7" strokeWidth=".8" />
    <path d="M-8 0L-7 -2L-6 0L-4 1L-6 2L-7 4L-8 2L-10 1Z" fill={b} />
  </g>;
  const butterfly = <g className="af-flutter" transform="translate(50 9)" stroke="#fff" strokeWidth=".7">
    <path d="M0 0Q-12 -12 -12 -3Q-12 4 -2 4Q-10 10 -5 12Q0 10 0 4Q0 10 5 12Q10 10 2 4Q12 4 12 -3Q12 -12 0 0Z" fill={a} />
    <path d="M0 0V9M0 1Q-4 -4 -6 -3M0 1Q4 -4 6 -3" fill="none" stroke={b} strokeLinecap="round" />
  </g>;
  const pearl = <g className="af-glow" transform="translate(50 8)">
    <circle r="7" fill={a} stroke="#fff" strokeWidth="1" /><circle cx="-2" cy="-2" r="2" fill="#fff" opacity=".9" />
    <path d="M-10 9Q0 15 10 9" fill="none" stroke={b} strokeWidth="1.2" /><circle cx="-8" cy="8" r="1" fill={b} /><circle cx="8" cy="8" r="1" fill={b} />
  </g>;
  const sun = <g className="af-energy" transform="translate(50 8)" stroke="#fff4c7" strokeWidth=".8">
    <circle r="5" fill={a} /><circle r="2.5" fill="#fff5c2" />
    {Array.from({ length: 8 }, (_, i) => <path key={i} d="M0 -7V-10" transform={`rotate(${i * 45})`} stroke={b} strokeWidth="1.5" strokeLinecap="round" />)}
  </g>;
  const curtain = <g className="af-sway" stroke="#ffe2b0" strokeWidth=".8">
    <path d="M8 3Q25 9 34 4L31 16Q24 13 20 18Q17 13 12 15Z" fill={a} />
    <path d="M92 3Q75 9 66 4L69 16Q76 13 80 18Q83 13 88 15Z" fill={b} />
    <path d="M12 8Q20 11 30 8M88 8Q80 11 70 8" fill="none" />
    <circle cx="12" cy="17" r="1.4" fill="#fff1bd" /><circle cx="88" cy="17" r="1.4" fill="#fff1bd" />
  </g>;
  const roses = <g className="af-shimmer">{[[21, 20], [79, 20], [12, 50], [88, 50], [21, 80], [79, 80]].map(([x, y], i) => <g key={i} transform={`translate(${x} ${y})`}>
    <path d="M0 4Q-4 -1 -1 -4Q2 -6 4 -2Q6 2 0 4Z" fill={i % 2 ? a : b} stroke="#ffe8c2" strokeWidth=".7" />
    <path d="M0 4L-1 7M-1 6L-3 5" stroke="#a9d98e" strokeWidth=".7" />
  </g>)}</g>;
  const poker = <g className="af-spark" stroke="#fff" strokeWidth=".7" textAnchor="middle" fontSize="5" fontWeight="bold">
    {[0, 1].map((i) => <g key={i} transform={`translate(${i ? 82 : 18} ${i ? 78 : 22}) rotate(${i ? 14 : -14})`}>
      <rect x="-5" y="-8" width="10" height="16" rx="1.5" fill="#fff5e9" stroke={i ? "#ca2947" : "#1b4d87"} />
      <text y="2" fill={i ? "#ca2947" : "#1b4d87"} stroke="none">{CARDS[(level + i) % CARDS.length]}</text>
    </g>)}
  </g>;
  const phoenixRays = <g className="af-flutter" fill="none" stroke={b} strokeWidth="1" strokeLinecap="round">
    <path d="M12 27Q24 20 33 24M88 27Q76 20 67 24M15 72Q27 79 36 74M85 72Q73 79 64 74" />
    <path d="M18 30L14 25M22 27L20 21M82 30L86 25M78 27L80 21M21 70L16 75M79 70L84 75" stroke={a} />
  </g>;
  const dragonScales = <g className="af-orbit" fill={a} stroke="#fff7d8" strokeWidth=".55">
    {Array.from({ length: 12 }, (_, i) => { const angle = i * 30; const rad = angle * Math.PI / 180; return <path key={i} d="M0 -2.8L2.4 0L0 2.8L-2.4 0Z" transform={`translate(${50 + Math.cos(rad) * 43} ${50 + Math.sin(rad) * 43}) rotate(${angle})`} />; })}
  </g>;
  const diceAndSuits = <g className="af-glow"><Gem x={16} y={50} color={a} scale={.7} /><Gem x={84} y={50} color={b} scale={.7} />{CARDS.map((symbol, i) => <text key={symbol} x={34 + i * 11} y={i % 2 ? 94 : 7} fill={i % 2 ? a : b} fontSize="4.4" textAnchor="middle">{symbol}</text>)}</g>;
  const leaf = <g className="af-sway" fill="none" stroke={a} strokeWidth="1.3" strokeLinecap="round">
    <path d="M14 69Q12 50 17 33Q19 25 25 20M86 69Q88 50 83 33Q81 25 75 20" />
    <path d="M16 45Q7 39 9 34Q16 34 18 42M17 56Q25 49 25 44Q19 44 17 52M84 45Q93 39 91 34Q84 34 82 42M83 56Q75 49 75 44Q81 44 83 52" fill={b} />
  </g>;

  const diamond = <g className="af-shimmer"><Gem x={50} y={7} color={a} scale={1.25} /><Gem x={50} y={93} color={b} scale={1.05} /><Gem x={8} y={50} color={b} scale={.75} /><Gem x={92} y={50} color={a} scale={.75} /></g>;
  const art: Record<string, ReactNode> = {
    rose: roses, crown, wings, laurel, curtain, flame: fire, lightning, clover, hearts, trophy, cards, dice,
    snowflake, flowers, bamboo, beach, diamond,
    phoenix: <>{phoenix}{phoenixRays}</>, wolf, lion, galaxy, dragon: <>{dragon}{dragonScales}</>, flag,
    treasure, "winged-star": wingedStar, moon, butterfly, pearl, sun, "red-roses": roses, "gold-laurel": laurel,
    "ice-crown": <>{crown}{snowflake}</>, "royal-cards": <>{cards}{diceAndSuits}</>, "sea-flower": <>{beach}{flowers}</>,
    "fire-wings": <>{wings}{fire}</>, "heart-wings": <>{wings}{hearts}</>, "crystal-galaxy": <>{galaxy}{diceAndSuits}</>,
    "bamboo-flower": <>{bamboo}{flowers}</>, "laurel-crown": <>{laurel}{crown}</>, "star-crown": <>{crown}{wingedStar}</>,
    "royal-phoenix": <>{phoenix}{crown}</>, "dragon-gem": <>{dragon}{diamond}</>, "sun-laurel": <>{sun}{laurel}</>,
    "snow-rose": <>{snowflake}{roses}</>, "ocean-wings": <>{beach}{wings}</>, "treasure-star": <>{treasure}{wingedStar}</>,
    "flag-crown": <>{flag}{crown}</>, "lion-laurel": <>{lion}{laurel}</>, "wolf-moon": <>{wolf}{moon}</>,
    "poker-royal": <>{poker}{crown}</>, "phoenix-diamond": <>{phoenix}{diamond}</>, "galaxy-wings": <>{galaxy}{wings}</>,
    "rose-heart": <>{roses}{hearts}</>, "imperial-dragon": <>{dragon}{crown}</>, "cosmic-star": <>{galaxy}{wingedStar}</>,
    "crystal-laurel": <>{laurel}{diamond}</>, "angel-snow": <>{wings}{snowflake}</>, "supreme-crown": <>{crown}{laurel}{wingedStar}</>,
  };

  return <>{art[motif] ?? art["crown"]}</>;
}

export function AvatarFrameOrnament({ frame }: { frame: EquippedAvatarFrame }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const level = Number(frame.frame_id.match(/\d+$/)?.[0] ?? 1);
  const baseTheme = FRAME_THEMES[Math.max(0, Math.min(FRAME_THEMES.length - 1, level - 1))] ?? FRAME_THEMES[0]!;
  const theme = { ...baseTheme, motif: PREMIUM_MOTIFS[level - 1] ?? baseTheme.motif };
  const maskId = `af-hole-${reactId}`;
  return (
    <span aria-hidden="true" className="cupido-avatar-ornament pointer-events-none absolute -inset-[22%] z-10 select-none">
      <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" role="presentation">
        <defs>
          <linearGradient id={`af-metal-${reactId}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={frame.color_a} /><stop offset=".38" stopColor="#fff7d4" /><stop offset=".66" stopColor={frame.color_b} /><stop offset="1" stopColor={frame.color_a} /></linearGradient>
          <radialGradient id={`af-gem-${reactId}`}><stop stopColor="#fff" /><stop offset=".28" stopColor={frame.color_a} /><stop offset="1" stopColor={frame.color_b} /></radialGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="white" /><circle cx="50" cy="50" r="36.5" fill="black" /></mask>
          <filter id={`af-glow-${reactId}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.25" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g mask={`url(#${maskId})`}>
          <circle cx="50" cy="50" r="43.2" fill="none" stroke={`url(#af-metal-${reactId})`} strokeWidth="2.3" className="af-halo" />
          <circle cx="50" cy="50" r="39.1" fill="none" stroke={frame.color_b} strokeWidth=".8" strokeDasharray="1.2 3.2" className="af-counter-halo" />
          <circle cx="50" cy="50" r="46.4" fill="none" stroke={`url(#af-metal-${reactId})`} strokeWidth=".7" strokeDasharray=".7 5.2" className="af-orbit" />
          <g filter={`url(#af-glow-${reactId})`}><MotifArt motif={theme.motif} a={frame.color_a} b={frame.color_b} level={level} /></g>
          <g className="af-sparkles" fill="#fff8d4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((point) => {
              const angle = (point * 45 + level * 7) * Math.PI / 180;
              const x = 50 + Math.cos(angle) * (point % 2 ? 45.2 : 40.6);
              const y = 50 + Math.sin(angle) * (point % 2 ? 45.2 : 40.6);
              return <path key={point} d={`M${x} ${y - 2.1}L${x + .65} ${y - .65}L${x + 2.1} ${y}L${x + .65} ${y + .65}L${x} ${y + 2.1}L${x - .65} ${y + .65}L${x - 2.1} ${y}L${x - .65} ${y - .65}Z`} />;
            })}
          </g>
          <g className="af-floating-gems"><Gem x={50} y={4.5} color={`url(#af-gem-${reactId})`} scale={.7} /><Gem x={50} y={95.5} color={`url(#af-gem-${reactId})`} scale={.65} /></g>
        </g>
      </svg>
      <span className="sr-only">Marco animado nivel {level}: {theme.name}</span>
    </span>
  );
}
