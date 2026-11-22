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
export const FREE_GIFT_MAX_CREDITS = 500;

type SpendingAccount = {
  balance: number;
  hasPurchased: boolean;
  isAdmin: boolean;
  isInfiniteCreditsAdmin?: boolean;
  isGranLiga?: boolean;
  isSupremeAdmin?: boolean;
};

export function canSendGift(gift: { credits: number; id?: string }, account: SpendingAccount): boolean {
  if (account.isInfiniteCreditsAdmin === true) return true;
  if (gift.id === "gran-liga-diamond" && !account.isGranLiga) return false;
  if (!account.hasPurchased) return false;
  return account.balance >= gift.credits;
}

export function canStartCall(mode: CallMode, account: SpendingAccount): boolean {
  if (account.isInfiniteCreditsAdmin === true) return true;
  if (!account.hasPurchased) return false;
  return account.balance >= CALL_COSTS[mode];
}

export function giftErrorMessage(message: string, fallback: string): string {
  if (message.includes("GRAN_LIGA_REQUIRED")) return "El Diamante Gran Liga solo puede enviarse desde una cuenta Gran Liga activa.";
  if (message.includes("PURCHASE_REQUIRED")) return "Confirma una recarga real para desbloquear tus monedas y enviar regalos.";
  if (message.includes("INSUFFICIENT")) return "No tienes monedas brillantes suficientes.";
  if (message.includes("GIFT_NOT_FOUND")) return "Este regalo ya no está disponible. Actualiza la página e intenta de nuevo.";
  if (message.includes("INVALID_RECEIVER")) return "No se pudo encontrar a la persona que recibirá el regalo.";
  if (message.includes("LIVE_NOT_ACTIVE")) return "Este Live ya terminó; el regalo no se envió.";
  if (message.includes("NOT_AUTHENTICATED")) return "Inicia sesión para enviar un regalo.";
  if (message.includes("GIFT_NOT_CONFIRMED")) return "El servidor no confirmó el envío. Actualiza la página e inténtalo otra vez.";
  if (message.includes("PGRST202") || message.includes("42P01")) return "El servicio de regalos se está actualizando. Intenta de nuevo en un momento.";
  return message || fallback;
}

export function callErrorMessage(message: string, fallback: string): string {
  if (message.includes("PURCHASE_REQUIRED")) return "Las llamadas requieren una recarga real confirmada."
  if (message.includes("INSUFFICIENT")) return "No tienes monedas brillantes suficientes.";
  return message || fallback;
}

const GIFT_CATALOG = [
  ["Rosa", "🌹", 10],
  ["Corazón", "❤️", 15],
  ["Corona", "👑", 20],
  ["Estrella", "⭐", 25],
  ["Corona Real", "👑", 30],
  ["Cohete", "🚀", 40],
  ["Panda", "🐼", 50],
  ["Osito", "🧸", 60],
  ["Unicornio", "🦄", 75],
  ["Gato", "😎", 100],
  ["Conejo", "🐰", 155],
  ["Dinosaurio", "🦖", 210],
  ["Robot", "🤖", 265],
  ["Pollito", "🐥", 320],
  ["Pingüino", "🐧", 375],
  ["Tiburón", "🦈", 430],
  ["Pulpo", "🐙", 485],
  ["Pato", "🐤", 540],
  ["Regalo", "🎁", 595],
  ["Ramo de Rosas", "💐", 650],
  ["Champán", "🍾", 705],
  ["Bubble Tea", "🧋", 760],
  ["Palomitas", "🍿", 815],
  ["Papas Fritas", "🍟", 870],
  ["Pastel de Cumpleaños", "🎂", 925],
  ["Helado de Cono", "🍦", 980],
  ["Globo Aerostático", "🎈", 1035],
  ["Auto Deportivo", "🏎️", 1090],
  ["Motocicleta", "🏍️", 1145],
  ["Avión", "✈️", 1200],
  ["Yate", "🛥️", 1255],
  ["Castillo", "🏰", 1310],
  ["Rueda de la Fortuna", "🎡", 1365],
  ["Auriculares", "🎧", 1420],
  ["Cámara", "📷", 1475],
  ["Control de Videojuegos", "🎮", 1530],
  ["Teléfono", "📱", 1585],
  ["Laptop", "💻", 1640],
  ["Reloj Inteligente", "⌚", 1695],
  ["Cofre del Tesoro", "🧰", 1750],
  ["Saco de Dinero", "💰", 1805],
  ["Pila de Monedas", "🪙", 1860],
  ["Diamante Azul", "💎", 1915],
  ["Corona de Diamantes", "👑", 1970],
  ["Poción Mágica", "🧪", 2025],
  ["Bola de Cristal", "🔮", 2080],
  ["Varita Mágica", "🪄", 2135],
  ["Globo de Nieve", "🔮", 2190],
  ["Muñeco de Nieve", "⛄", 2245],
  ["Árbol de Navidad", "🎄", 2300],
  ["Calabaza", "🎃", 2355],
  ["Fantasma", "👻", 2410],
  ["Sombrero de Bruja", "🧙", 2465],
  ["Gato Negro", "🐈‍⬛", 2520],
  ["Calavera Real", "💀", 2580],
  ["Diablito", "👹", 2635],
  ["Ángel Bebé", "👼", 2690],
  ["Cupido", "💘", 2745],
  ["Corazón Alado", "💝", 2800],
  ["Linterna", "🏮", 2855],
  ["Lazo Rosa", "🎀", 2910],
  ["Rosa en Cúpula", "🌹", 2965],
  ["Alas de Ángel", "🪽", 3020],
  ["Arcoíris", "🌈", 3075],
  ["Nube", "☁️", 3130],
  ["Sol", "🌞", 3185],
  ["Luna", "🌙", 3240],
  ["Nube Estrellada", "🌟", 3295],
  ["Estrella Fugaz", "🌠", 3350],
  ["Mariposa", "🦋", 3405],
  ["Macaron", "🍬", 3460],
  ["Rebanada de Pastel", "🍰", 3515],
  ["Bubble Tea", "🧋", 3570],
  ["Café Corazón", "☕", 3625],
  ["Taza Corazón", "💗", 3680],
  ["Cupcake", "🧁", 3735],
  ["Dona", "🍩", 3790],
  ["Helado de Chocolate", "🍨", 3845],
  ["Regalo", "🎁", 3900],
  ["Paleta", "🍭", 3955],
  ["Cerezas", "🍒", 4010],
  ["Rosa en Cúpula", "🌹", 4065],
  ["Panda", "🐼", 4120],
  ["Zorro", "🦊", 4175],
  ["Gato Gris", "🐈", 4230],
  ["Tortuga", "🐢", 4285],
  ["Rana con Corona", "🐸", 4340],
  ["Pingüino", "🐧", 4395],
  ["Erizo", "🦔", 4450],
  ["Ardilla", "🐿️", 4505],
  ["Gato en una Nube", "😽", 4560],
  ["Delfín", "🐬", 4615],
  ["Medusa", "🪼", 4670],
  ["Ballena", "🐳", 4725],
  ["Panda en una Nube", "🐼", 4780],
  ["Zorro Bebé", "🦊", 4835],
  ["Oveja", "🐑", 4890],
  ["Reno", "🦌", 4945],
  ["Cerdito Dorado", "🐷", 5000],
  ["Diamante Gran Liga", "💎", 1_000_000],
] as const;

export const GIFTS = GIFT_CATALOG.map(([name, emoji, credits], imageIndex) => ({
  id: imageIndex === 99 ? "gran-liga-diamond" : `gift-${String(imageIndex + 1).padStart(3, "0")}`,
  name,
  emoji,
  credits,
  cash: imageIndex === 99 ? 60 : Math.round(credits / 10) / 100,
  imageIndex,
}));

export type Gift = (typeof GIFTS)[number];

export const MIN_WITHDRAWAL = 50;
export const GRAN_LIGA_MIN_WITHDRAWAL = 20;

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
