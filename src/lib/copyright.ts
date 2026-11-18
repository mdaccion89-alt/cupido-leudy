export type BlockedTermKind = "artist" | "brand" | "studio" | "work";

export type BlockedMatch = {
  kind: BlockedTermKind;
  value: string;
};

type BlockedEntry = {
  kind: BlockedTermKind;
  value: string;
  aliases?: string[];
};

const BLOCKED_ARTISTS = [
  "Bad Bunny",
  "Shakira",
  "Romeo Santos",
  "Daddy Yankee",
  "J Balvin",
  "Karol G",
  "Ozuna",
  "Anuel",
  "Maluma",
  "Rauw Alejandro",
  "Feid",
  "Peso Pluma",
  "Natanael Cano",
  "Marc Anthony",
  "Juan Luis Guerra",
  "Aventura",
  "Prince Royce",
  "El Alfa",
  "Rochy RD",
  "Tokischa",
  "Don Omar",
  "Wisin",
  "Yandel",
  "Nicky Jam",
  "Farruko",
  "Arcángel",
  "Myke Towers",
  "Becky G",
  "Rosalía",
  "Rosalia",
  "Enrique Iglesias",
  "Ricky Martin",
  "Selena",
  "Celia Cruz",
  "Héctor Lavoe",
  "Hector Lavoe",
  "Taylor Swift",
  "Beyoncé",
  "Beyonce",
  "Rihanna",
  "Drake",
  "Eminem",
  "Ed Sheeran",
  "Adele",
  "Billie Eilish",
  "Ariana Grande",
  "Justin Bieber",
  "The Weeknd",
  "Dua Lipa",
  "Bruno Mars",
  "Michael Jackson",
  "Madonna",
  "Lady Gaga",
  "Kanye West",
  "Travis Scott",
  "Post Malone",
  "Coldplay",
  "Metallica",
  "Bizarrap",
  "Quevedo",
  "Grupo Frontera",
  "Fuerza Regida",
] as const;

const PROTECTED_ENTRIES: BlockedEntry[] = [
  { kind: "studio", value: "Disney", aliases: ["walt disney", "disney studios"] },
  { kind: "studio", value: "Netflix" },
  { kind: "studio", value: "Pixar" },
  { kind: "studio", value: "Marvel", aliases: ["marvel studios", "marvel comics"] },
  { kind: "studio", value: "DC Comics", aliases: ["dc", "detective comics"] },
  { kind: "studio", value: "Warner", aliases: ["warner bros", "warner brothers", "wb"] },
  { kind: "studio", value: "Universal", aliases: ["universal studios", "universal pictures"] },
  { kind: "studio", value: "DreamWorks", aliases: ["dream works", "dreamworks animation"] },
  { kind: "brand", value: "Nintendo" },
  { kind: "studio", value: "HBO", aliases: ["home box office"] },
  { kind: "studio", value: "Sony", aliases: ["sony pictures", "sony entertainment"] },
  { kind: "studio", value: "Paramount", aliases: ["paramount pictures"] },
  { kind: "work", value: "Mickey", aliases: ["mickey mouse"] },
  { kind: "work", value: "Spiderman", aliases: ["spider man", "spider-man"] },
  { kind: "work", value: "Barbie" },
  ...BLOCKED_ARTISTS.map((value): BlockedEntry => ({ kind: "artist", value })),
];

function normalizeText(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

const COMPILED_ENTRIES = PROTECTED_ENTRIES.map((entry) => {
  const terms = [entry.value, ...(entry.aliases ?? [])]
    .map((term) => normalizeText(term).trim())
    .filter(Boolean);
  return { kind: entry.kind, value: entry.value, terms };
});

export const BLOCKED_TERMS: ReadonlyArray<{
  kind: BlockedTermKind;
  value: string;
  aliases: string[];
}> = PROTECTED_ENTRIES.map((entry) => ({
  kind: entry.kind,
  value: entry.value,
  aliases: entry.aliases ?? [],
}));

export function findBlockedTerm(text: string): BlockedMatch | null {
  const haystack = normalizeText(text);
  for (const entry of COMPILED_ENTRIES) {
    if (entry.terms.some((term) => haystack.includes(` ${term} `))) {
      return { kind: entry.kind, value: entry.value };
    }
  }
  return null;
}

function kindLabel(kind: BlockedTermKind): string {
  if (kind === "artist") return "el artista protegido";
  if (kind === "brand") return "la marca protegida";
  if (kind === "studio") return "el estudio protegido";
  return "la obra o personaje protegido";
}

export function blockedErrorMessage(match: BlockedMatch): string {
  return `Solicitud bloqueada por seguridad de derechos de autor: se detectó ${kindLabel(match.kind)} "${match.value}". No se realizó ningún cargo de créditos y no se llamó a ningún proveedor. Por favor, crea una idea original sin imitar artistas, marcas, estudios u obras protegidas.`;
}
