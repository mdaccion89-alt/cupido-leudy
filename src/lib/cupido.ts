export const BRAND = "Cupido Leudy ❤️";
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
Las notas de voz son gratis. Las Llamadas en Vivo (Hot / Café) consumen créditos: Café 50, Hot 100. No grabes ni compartas conversaciones privadas sin permiso.

5. Créditos, regalos y retiros
Los paquetes empiezan en 5,000 créditos. Los regalos virtuales convierten su valor en saldo retirable. El saldo mínimo de retiro es US$20 y se paga al método disponible en tu país. Los pagos se procesan con PayPal (saldo o tarjeta). Los retiros son revisados por el Admin Supremo.

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

export const GIFTS = [
  { id: "rosa", emoji: "🌹", name: "Rosa", credits: 500, cash: 0.5 },
  { id: "corazon", emoji: "❤️", name: "Corazón", credits: 1000, cash: 1 },
  { id: "beso", emoji: "💋", name: "Beso", credits: 2000, cash: 2 },
  { id: "ramo", emoji: "💐", name: "Ramo", credits: 3500, cash: 3.5 },
  { id: "corona", emoji: "👑", name: "Corona", credits: 8000, cash: 8 },
  { id: "anillo", emoji: "💍", name: "Anillo", credits: 15000, cash: 15 },
  { id: "auto", emoji: "🏎️", name: "Auto", credits: 30000, cash: 30 },
  { id: "castillo", emoji: "🏰", name: "Castillo", credits: 80000, cash: 80 },
] as const;

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
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
export function countryName(code: string | null | undefined): string {
  return COUNTRIES.find(([c]) => c === code?.toUpperCase())?.[1] ?? "Sin país";
}
