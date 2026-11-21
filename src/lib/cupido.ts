export const BRAND = "Cupido Leudy ❤️";
export const SLOGAN = "Personas reales, conexiones reales";
export const TERMS_VERSION = "2026-01";
export const FOOTER_COPYRIGHT = "© 2026 Cupido Leudy ❤️. Todos los derechos reservados.";

export const TERMS_TITLE = "Manual de Uso y Normas";
export const TERMS_TEXT = `MANUAL DE USO Y NORMAS — ${BRAND}

1. Quién puede usar Cupido Leudy
Debes tener al menos 18 años y crear un perfil real. Se prohíben menores de edad, suplantaciones y perfiles falsos. El Escudo Cupido revisa fotos y comportamientos; el Admin Supremo puede suspender cualquier cuenta.

2. Tu perfil
Usa una foto real de rostro. No se permiten desnudos, contenido sexual explícito, armas, drogas ni imágenes de otras personas sin consentimiento. La selfie de verificación es opcional y solo el Admin Supremo puede aprobar la insignia azul; nunca se comparte públicamente.

3. Convivencia
Trata a los demás con respeto. Están prohibidos el acoso, la discriminación, el spam, la solicitud de dinero ajeno a la plataforma y cualquier contenido ilegal. Puedes bloquear, denunciar o dejar de seguir a quien quieras.

4. Chat, notas de voz y llamadas
Las notas de voz son gratis. Las Llamadas en Vivo (Hot / Café) consumen monedas brillantes: Café 50, Hot 100. Los Lives solo pueden ser transmitidos por perfiles con Insignia Azul. No grabes ni compartas conversaciones privadas sin permiso.

5. Créditos, regalos y retiros
Los paquetes empiezan en 5,000 monedas brillantes. Hay 99 regalos virtuales y cada uno convierte su valor en saldo retirable para quien lo recibe, también durante un Live. El saldo mínimo de retiro es US$20 y se paga al método disponible en tu país. Los pagos se procesan con PayPal (saldo o tarjeta). Los retiros son revisados por el Admin Supremo.

6. Seguridad
Nunca compartas contraseñas, códigos ni datos bancarios en el chat. Cupido Leudy jamás te pedirá dinero por fuera de PayPal. Reporta cualquier sospecha al Escudo Cupido.

7. Cambios
Estas normas pueden actualizarse. Al continuar usando la app aceptas la versión vigente. El Admin Supremo acepta este manual automáticamente al iniciar sesión.`;

export const LOOKING_FOR = [
  { value: "amistad", label: "Amistad", emoji: "🤝" },
  { value: "citas", label: "Citas", emoji: "💕" },
  { value: "amor", label: "Amor verdadero", emoji: "💘" },
  { value: "serio", label: "Algo serio", emoji: "💍" },
  { value: "diversion", label: "Diversión", emoji: "🎉" },
] as const;

export const CALL_COSTS = { hot: 100, cafe: 50 } as const;
export type CallMode = keyof typeof CALL_COSTS;

export const FREE_WELCOME_CREDITS = 500;
export const FREE_GIFT_MAX_CREDITS = 100;

type SpendingAccount = {
  balance: number;
  hasPurchased: boolean;
  isAdmin: boolean;
  isSupremeAdmin?: boolean;
};

export function canSendGift(gift: { credits: number }, account: SpendingAccount): boolean {
  if (account.isAdmin) return true;
  if (gift.credits > FREE_GIFT_MAX_CREDITS && !account.hasPurchased) return false;
  return account.balance >= gift.credits;
}

export function canStartCall(mode: CallMode, account: SpendingAccount): boolean {
  if (account.isSupremeAdmin) return true;
  if (!account.hasPurchased) return false;
  return account.balance >= CALL_COSTS[mode];
}

export function giftErrorMessage(message: string, fallback: string): string {
  if (message.includes("PURCHASE_REQUIRED"))
    return `Los regalos de más de ${FREE_GIFT_MAX_CREDITS} monedas requieren compra o recarga.`;
  if (message.includes("INSUFFICIENT")) return "No tienes monedas brillantes suficientes.";
  return message || fallback;
}

export function callErrorMessage(message: string, fallback: string): string {
  if (message.includes("PURCHASE_REQUIRED")) return "Las llamadas requieren compra o recarga de monedas brillantes.";
  if (message.includes("INSUFFICIENT")) return "No tienes monedas brillantes suficientes.";
  return message || fallback;
}

const GIFT_CATALOG = [
  { id: "rosa-001", emoji: "🌹", name: "Rosa", credits: 10, cash: 0.01 },
  { id: "cafe-002", emoji: "☕", name: "Café", credits: 25, cash: 0.03 },
  { id: "beso-003", emoji: "💋", name: "Beso", credits: 50, cash: 0.05 },
  { id: "corazon-004", emoji: "❤️", name: "Corazón", credits: 75, cash: 0.07 },
  { id: "chispita-005", emoji: "✨", name: "Chispita", credits: 100, cash: 0.1 },
  { id: "globito-006", emoji: "🎈", name: "Globito", credits: 150, cash: 0.15 },
  { id: "caramelo-007", emoji: "🍬", name: "Caramelo", credits: 200, cash: 0.2 },
  { id: "flor-008", emoji: "🌸", name: "Flor", credits: 250, cash: 0.25 },
  { id: "velita-009", emoji: "🕯️", name: "Velita", credits: 300, cash: 0.3 },
  { id: "dulce-010", emoji: "🍭", name: "Dulce", credits: 400, cash: 0.4 },
  { id: "mariposa-011", emoji: "🦋", name: "Mariposa", credits: 500, cash: 0.5 },
  { id: "estrella-012", emoji: "⭐", name: "Estrella", credits: 600, cash: 0.6 },
  { id: "muffin-013", emoji: "🧁", name: "Muffin", credits: 700, cash: 0.7 },
  { id: "taza-014", emoji: "☕", name: "Taza", credits: 800, cash: 0.8 },
  { id: "ojito-015", emoji: "👀", name: "Ojito", credits: 900, cash: 0.9 },
  { id: "sonrisa-016", emoji: "😊", name: "Sonrisa", credits: 1000, cash: 1 },
  { id: "coqueteo-017", emoji: "😉", name: "Coqueteo", credits: 1200, cash: 1.2 },
  { id: "brillo-018", emoji: "💫", name: "Brillo", credits: 1400, cash: 1.4 },
  { id: "petalo-019", emoji: "🌷", name: "Pétalo", credits: 1600, cash: 1.6 },
  { id: "miel-020", emoji: "🍯", name: "Miel", credits: 1800, cash: 1.8 },
  { id: "limon-021", emoji: "🍋", name: "Limón", credits: 2000, cash: 2 },
  { id: "fresa-022", emoji: "🍓", name: "Fresa", credits: 2200, cash: 2.2 },
  { id: "uva-023", emoji: "🍇", name: "Uva", credits: 2400, cash: 2.4 },
  { id: "cielo-024", emoji: "☁️", name: "Cielo", credits: 2600, cash: 2.6 },
  { id: "luna-025", emoji: "🌙", name: "Luna", credits: 2800, cash: 2.8 },
  { id: "sol-026", emoji: "☀️", name: "Sol", credits: 3000, cash: 3 },
  { id: "arcoiris-027", emoji: "🌈", name: "Arcoíris", credits: 3500, cash: 3.5 },
  { id: "confite-028", emoji: "🍬", name: "Confite", credits: 4000, cash: 4 },
  { id: "cinta-029", emoji: "🎀", name: "Cinta", credits: 4500, cash: 4.5 },
  { id: "cadenita-030", emoji: "🔗", name: "Cadenita", credits: 5000, cash: 5 },
  { id: "ramo-031", emoji: "💐", name: "Ramo", credits: 6000, cash: 6 },
  { id: "chocolate-032", emoji: "🍫", name: "Chocolate", credits: 6500, cash: 6.5 },
  { id: "perfume-033", emoji: "🌺", name: "Perfume", credits: 7000, cash: 7 },
  { id: "champan-034", emoji: "🍾", name: "Champán", credits: 7500, cash: 7.5 },
  { id: "oso-gigante-035", emoji: "🧸", name: "Oso gigante", credits: 8000, cash: 8 },
  { id: "anillo-036", emoji: "💍", name: "Anillo", credits: 8500, cash: 8.5 },
  { id: "pulsera-037", emoji: "📿", name: "Pulsera", credits: 9000, cash: 9 },
  { id: "collar-038", emoji: "🧿", name: "Collar", credits: 9500, cash: 9.5 },
  { id: "reloj-039", emoji: "⌚", name: "Reloj", credits: 10000, cash: 10 },
  { id: "gafas-040", emoji: "🕶️", name: "Gafas", credits: 10500, cash: 10.5 },
  { id: "sombrero-041", emoji: "🎩", name: "Sombrero", credits: 11000, cash: 11 },
  { id: "bufanda-042", emoji: "🧣", name: "Bufanda", credits: 11500, cash: 11.5 },
  { id: "guantes-043", emoji: "🧤", name: "Guantes", credits: 12000, cash: 12 },
  { id: "bolso-044", emoji: "👜", name: "Bolso", credits: 12500, cash: 12.5 },
  { id: "zapatos-045", emoji: "👠", name: "Zapatos", credits: 13000, cash: 13 },
  { id: "corbata-046", emoji: "👔", name: "Corbata", credits: 13500, cash: 13.5 },
  { id: "ramo-de-oro-047", emoji: "💐", name: "Ramo de oro", credits: 14000, cash: 14 },
  { id: "tarta-048", emoji: "🎂", name: "Tarta", credits: 14500, cash: 14.5 },
  { id: "pastel-049", emoji: "🍰", name: "Pastel", credits: 15000, cash: 15 },
  { id: "helado-050", emoji: "🍦", name: "Helado", credits: 15500, cash: 15.5 },
  { id: "pizza-051", emoji: "🍕", name: "Pizza", credits: 16000, cash: 16 },
  { id: "hamburguesa-052", emoji: "🍔", name: "Hamburguesa", credits: 16500, cash: 16.5 },
  { id: "sushi-053", emoji: "🍣", name: "Sushi", credits: 17000, cash: 17 },
  { id: "tacos-054", emoji: "🌮", name: "Tacos", credits: 17500, cash: 17.5 },
  { id: "cafe-con-leche-055", emoji: "🥛", name: "Café con leche", credits: 18000, cash: 18 },
  { id: "te-056", emoji: "🍵", name: "Té", credits: 18500, cash: 18.5 },
  { id: "copa-057", emoji: "🍷", name: "Copa", credits: 19000, cash: 19 },
  { id: "cerveza-058", emoji: "🍺", name: "Cerveza", credits: 19500, cash: 19.5 },
  { id: "disco-059", emoji: "💿", name: "Disco", credits: 20000, cash: 20 },
  { id: "boleto-060", emoji: "🎟️", name: "Boleto", credits: 20500, cash: 20.5 },
  { id: "auto-061", emoji: "🏎️", name: "Auto", credits: 21000, cash: 21 },
  { id: "moto-062", emoji: "🏍️", name: "Moto", credits: 22500, cash: 22.5 },
  { id: "bicicleta-063", emoji: "🚲", name: "Bicicleta", credits: 24000, cash: 24 },
  { id: "barco-064", emoji: "⛵", name: "Barco", credits: 25500, cash: 25.5 },
  { id: "avioneta-065", emoji: "🛩️", name: "Avioneta", credits: 27000, cash: 27 },
  { id: "globo-aerostatico-066", emoji: "🎈", name: "Globo aerostático", credits: 28500, cash: 28.5 },
  { id: "castillo-067", emoji: "🏰", name: "Castillo", credits: 30000, cash: 30 },
  { id: "casa-068", emoji: "🏠", name: "Casa", credits: 31500, cash: 31.5 },
  { id: "villa-069", emoji: "🏖️", name: "Villa", credits: 33000, cash: 33 },
  { id: "lancha-070", emoji: "🚤", name: "Lancha", credits: 34500, cash: 34.5 },
  { id: "concierto-071", emoji: "🎤", name: "Concierto", credits: 36000, cash: 36 },
  { id: "viaje-072", emoji: "✈️", name: "Viaje", credits: 37500, cash: 37.5 },
  { id: "hotel-073", emoji: "🏨", name: "Hotel", credits: 39000, cash: 39 },
  { id: "spa-074", emoji: "💆", name: "Spa", credits: 40500, cash: 40.5 },
  { id: "gimnasio-075", emoji: "🏋️", name: "Gimnasio", credits: 42000, cash: 42 },
  { id: "biblioteca-076", emoji: "📚", name: "Biblioteca", credits: 43500, cash: 43.5 },
  { id: "estadio-077", emoji: "🏟️", name: "Estadio", credits: 45000, cash: 45 },
  { id: "cine-078", emoji: "🎬", name: "Cine", credits: 46500, cash: 46.5 },
  { id: "crucero-079", emoji: "🚢", name: "Crucero", credits: 48000, cash: 48 },
  { id: "isla-080", emoji: "🏝️", name: "Isla", credits: 49500, cash: 49.5 },
  { id: "yate-081", emoji: "🛥️", name: "Yate", credits: 50000, cash: 50 },
  { id: "mansion-082", emoji: "🏰", name: "Mansión", credits: 55000, cash: 55 },
  { id: "jet-privado-083", emoji: "🛩️", name: "Jet privado", credits: 60000, cash: 60 },
  { id: "corona-suprema-084", emoji: "👑", name: "Corona suprema", credits: 65000, cash: 65 },
  { id: "diamante-085", emoji: "💎", name: "Diamante", credits: 70000, cash: 70 },
  { id: "rubi-086", emoji: "🔴", name: "Rubí", credits: 75000, cash: 75 },
  { id: "esmeralda-087", emoji: "🟢", name: "Esmeralda", credits: 80000, cash: 80 },
  { id: "perla-088", emoji: "🦪", name: "Perla", credits: 85000, cash: 85 },
  { id: "oro-089", emoji: "🪙", name: "Oro", credits: 90000, cash: 90 },
  { id: "trono-090", emoji: "🪑", name: "Trono", credits: 95000, cash: 95 },
  { id: "limusina-091", emoji: "🚘", name: "Limusina", credits: 100000, cash: 100 },
  { id: "helicoptero-092", emoji: "🚁", name: "Helicóptero", credits: 110000, cash: 110 },
  { id: "avion-privado-093", emoji: "✈️", name: "Avión privado", credits: 120000, cash: 120 },
  { id: "isla-privada-094", emoji: "🏝️", name: "Isla privada", credits: 130000, cash: 130 },
  { id: "castillo-real-095", emoji: "🏰", name: "Castillo real", credits: 140000, cash: 140 },
  { id: "tesoro-096", emoji: "💰", name: "Tesoro", credits: 150000, cash: 150 },
  { id: "cofre-097", emoji: "🗝️", name: "Cofre", credits: 175000, cash: 175 },
  { id: "galaxia-098", emoji: "🌌", name: "Galaxia", credits: 200000, cash: 200 },
  { id: "corona-eterna-099", emoji: "👑", name: "Corona eterna", credits: 250000, cash: 250 },
] as const;

const BASIC_GIFT_PRICES = [5, 10, 20, 50, 75, 100];
const LUXURY_GIFT_PRICES = [120, 160, 220, 300, 400, 550, 700, 900, 1200, 1600, 2000, 2500];

export const GIFTS = GIFT_CATALOG.map((gift, index) => {
  const credits = index < 55
    ? BASIC_GIFT_PRICES[index % BASIC_GIFT_PRICES.length]!
    : LUXURY_GIFT_PRICES[(index - 55) % LUXURY_GIFT_PRICES.length]!;
  return { ...gift, credits, cash: Number((credits / 1000).toFixed(3)), imageIndex: index };
});

export type Gift = (typeof GIFTS)[number];

export const MIN_WITHDRAWAL = 20;

export const WITHDRAWAL_METHODS: Record<string, readonly string[]> = {
  DO: ["PayPal", "Zelle", "Transferencia bancaria"],
  US: ["PayPal", "Zelle", "Cash App"],
  MX: ["PayPal", "SPEI", "OXXO"],
  CO: ["PayPal", "Nequi", "PSE"],
  ES: ["PayPal", "Bizum", "Transferencia bancaria"],
  AR: ["PayPal", "MercadoPago"],
  CL: ["PayPal", "Transferencia bancaria"],
  PE: ["PayPal", "Yape"],
  VE: ["PayPal", "Zelle"],
  BR: ["PayPal", "PIX"],
  FR: ["PayPal", "Transferencia bancaria"],
  IT: ["PayPal", "Transferencia bancaria"],
  GB: ["PayPal", "Transferencia bancaria"],
};
export function withdrawalMethods(countryCode: string): readonly string[] {
  return WITHDRAWAL_METHODS[countryCode.toUpperCase()] ?? ["PayPal", "Transferencia bancaria"];
}

export const COUNTRIES: ReadonlyArray<readonly [string, string]> = [
  ["AD", "Andorra"], ["AE", "Emiratos Árabes Unidos"], ["AF", "Afganistán"], ["AG", "Antigua y Barbuda"],
  ["AI", "Anguila"], ["AL", "Albania"], ["AM", "Armenia"], ["AO", "Angola"], ["AQ", "Antártida"],
  ["AR", "Argentina"], ["AS", "Samoa Americana"], ["AT", "Austria"], ["AU", "Australia"], ["AW", "Aruba"],
  ["AX", "Åland"], ["AZ", "Azerbaiyán"], ["BA", "Bosnia y Herzegovina"], ["BB", "Barbados"],
  ["BD", "Bangladés"], ["BE", "Bélgica"], ["BF", "Burkina Faso"], ["BG", "Bulgaria"], ["BH", "Baréin"],
  ["BI", "Burundi"], ["BJ", "Benín"], ["BL", "San Bartolomé"], ["BM", "Bermudas"], ["BN", "Brunéi"],
  ["BO", "Bolivia"], ["BQ", "Bonaire"], ["BR", "Brasil"], ["BS", "Bahamas"], ["BT", "Bután"],
  ["BV", "Bouvet"], ["BW", "Botsuana"], ["BY", "Bielorrusia"], ["BZ", "Belice"], ["CA", "Canadá"],
  ["CC", "Islas Cocos"], ["CD", "Congo (RDC)"], ["CF", "Centroafricana"], ["CG", "Congo"],
  ["CH", "Suiza"], ["CI", "Costa de Marfil"], ["CK", "Islas Cook"], ["CL", "Chile"], ["CM", "Camerún"],
  ["CN", "China"], ["CO", "Colombia"], ["CR", "Costa Rica"], ["CU", "Cuba"], ["CV", "Cabo Verde"],
  ["CW", "Curazao"], ["CX", "Isla de Navidad"], ["CY", "Chipre"], ["CZ", "Chequia"], ["DE", "Alemania"],
  ["DJ", "Yibuti"], ["DK", "Dinamarca"], ["DM", "Dominica"], ["DO", "República Dominicana"],
  ["DZ", "Argelia"], ["EC", "Ecuador"], ["EE", "Estonia"], ["EG", "Egipto"], ["EH", "Sahara Occidental"],
  ["ER", "Eritrea"], ["ES", "España"], ["ET", "Etiopía"], ["FI", "Finlandia"], ["FJ", "Fiyi"],
  ["FK", "Islas Malvinas"], ["FM", "Micronesia"], ["FO", "Islas Feroe"], ["FR", "Francia"],
  ["GA", "Gabón"], ["GB", "Reino Unido"], ["GD", "Granada"], ["GE", "Georgia"],
  ["GF", "Guayana Francesa"], ["GG", "Guernesey"], ["GH", "Ghana"], ["GI", "Gibraltar"],
  ["GL", "Groenlandia"], ["GM", "Gambia"], ["GN", "Guinea"], ["GP", "Guadalupe"],
  ["GQ", "Guinea Ecuatorial"], ["GR", "Grecia"], ["GS", "Georgia del Sur"], ["GT", "Guatemala"],
  ["GU", "Guam"], ["GW", "Guinea-Bisáu"], ["GY", "Guyana"], ["HK", "Hong Kong"], ["HM", "Heard y McDonald"],
  ["HN", "Honduras"], ["HR", "Croacia"], ["HT", "Haití"], ["HU", "Hungría"], ["ID", "Indonesia"],
  ["IE", "Irlanda"], ["IL", "Israel"], ["IM", "Isla de Man"], ["IN", "India"],
  ["IO", "Territorio Británico del Océano Índico"], ["IQ", "Irak"], ["IR", "Irán"], ["IS", "Islandia"],
  ["IT", "Italia"], ["JE", "Jersey"], ["JM", "Jamaica"], ["JO", "Jordania"], ["JP", "Japón"],
  ["KE", "Kenia"], ["KG", "Kirguistán"], ["KH", "Camboya"], ["KI", "Kiribati"], ["KM", "Comoras"],
  ["KN", "San Cristóbal y Nieves"], ["KP", "Corea del Norte"], ["KR", "Corea del Sur"], ["KW", "Kuwait"],
  ["KY", "Islas Caimán"], ["KZ", "Kazajistán"], ["LA", "Laos"], ["LB", "Líbano"],
  ["LC", "Santa Lucía"], ["LI", "Liechtenstein"], ["LK", "Sri Lanka"], ["LR", "Liberia"],
  ["LS", "Lesoto"], ["LT", "Lituania"], ["LU", "Luxemburgo"], ["LV", "Letonia"], ["LY", "Libia"],
  ["MA", "Marruecos"], ["MC", "Mónaco"], ["MD", "Moldavia"], ["ME", "Montenegro"], ["MF", "San Martín"],
  ["MG", "Madagascar"], ["MH", "Islas Marshall"], ["MK", "Macedonia del Norte"], ["ML", "Malí"],
  ["MM", "Myanmar"], ["MN", "Mongolia"], ["MO", "Macao"], ["MP", "Marianas del Norte"],
  ["MQ", "Martinica"], ["MR", "Mauritania"], ["MS", "Montserrat"], ["MT", "Malta"], ["MU", "Mauricio"],
  ["MV", "Maldivas"], ["MW", "Malaui"], ["MX", "México"], ["MY", "Malasia"], ["MZ", "Mozambique"],
  ["NA", "Namibia"], ["NC", "Nueva Caledonia"], ["NE", "Níger"], ["NF", "Isla Norfolk"],
  ["NG", "Nigeria"], ["NI", "Nicaragua"], ["NL", "Países Bajos"], ["NO", "Noruega"], ["NP", "Nepal"],
  ["NR", "Nauru"], ["NU", "Niue"], ["NZ", "Nueva Zelanda"], ["OM", "Omán"], ["PA", "Panamá"],
  ["PE", "Perú"], ["PF", "Polinesia Francesa"], ["PG", "Papúa Nueva Guinea"], ["PH", "Filipinas"],
  ["PK", "Pakistán"], ["PL", "Polonia"], ["PM", "San Pedro y Miquelón"], ["PN", "Pitcairn"],
  ["PR", "Puerto Rico"], ["PS", "Palestina"], ["PT", "Portugal"], ["PW", "Palaos"], ["PY", "Paraguay"],
  ["QA", "Catar"], ["RE", "Reunión"], ["RO", "Rumania"], ["RS", "Serbia"], ["RU", "Rusia"],
  ["RW", "Ruanda"], ["SA", "Arabia Saudita"], ["SB", "Islas Salomón"], ["SC", "Seychelles"],
  ["SD", "Sudán"], ["SE", "Suecia"], ["SG", "Singapur"], ["SH", "Santa Elena"], ["SI", "Eslovenia"],
  ["SJ", "Svalbard y Jan Mayen"], ["SK", "Eslovaquia"], ["SL", "Sierra Leona"], ["SM", "San Marino"],
  ["SN", "Senegal"], ["SO", "Somalia"], ["SR", "Surinam"], ["SS", "Sudán del Sur"],
  ["ST", "Santo Tomé y Príncipe"], ["SV", "El Salvador"], ["SX", "Sint Maarten"], ["SY", "Siria"],
  ["SZ", "Esuatini"], ["TC", "Islas Turcas y Caicos"], ["TD", "Chad"], ["TF", "Territorios Franceses del Sur"],
  ["TG", "Togo"], ["TH", "Tailandia"], ["TJ", "Tayikistán"], ["TK", "Tokelau"], ["TL", "Timor-Leste"],
  ["TM", "Turkmenistán"], ["TN", "Túnez"], ["TO", "Tonga"], ["TR", "Turquía"],
  ["TT", "Trinidad y Tobago"], ["TV", "Tuvalu"], ["TW", "Taiwán"], ["TZ", "Tanzania"], ["UA", "Ucrania"],
  ["UG", "Uganda"], ["UM", "Islas Menores de EE. UU."], ["US", "Estados Unidos"], ["UY", "Uruguay"],
  ["UZ", "Uzbekistán"], ["VA", "Ciudad del Vaticano"], ["VC", "San Vicente y las Granadinas"],
  ["VE", "Venezuela"], ["VG", "Islas Vírgenes Británicas"], ["VI", "Islas Vírgenes de EE. UU."],
  ["VN", "Vietnam"], ["VU", "Vanuatu"], ["WF", "Wallis y Futuna"], ["WS", "Samoa"], ["YE", "Yemen"],
  ["YT", "Mayotte"], ["ZA", "Sudáfrica"], ["ZM", "Zambia"], ["ZW", "Zimbabue"],
];

export function countryFlag(code: string | null | undefined): string {
  if (typeof code !== "string" || !/^[a-z]{2}$/i.test(code)) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
export function countryName(code: string | null | undefined): string {
  return COUNTRIES.find(([c]) => c === code?.toUpperCase())?.[1] ?? "Sin país";
}
