export const PHONE_COUNTRY_PREFIXES: Readonly<Record<string, string>> = {
  AD: "376", AE: "971", AF: "93", AG: "1268", AI: "1264", AL: "355", AM: "374", AO: "244", AQ: "672",
  DO: "1", US: "1", CA: "1", PR: "1", JM: "1", TT: "1", BO: "591", MX: "52",
  AR: "54", BR: "55", CL: "56", CO: "57", VE: "58", PE: "51", EC: "593",
  ES: "34", GB: "44", FR: "33", DE: "49", IT: "39", PT: "351", AU: "61",
  IN: "91", JP: "81", CN: "86", NG: "234", ZA: "27", PH: "63", PA: "507",
  CR: "506", GT: "502", HN: "504", SV: "503", NI: "505", PY: "595", UY: "598",
  AT: "43", AW: "297", AX: "358", AZ: "994", BA: "387", BB: "1246", BD: "880", BE: "32",
  BF: "226", BG: "359", BH: "973", BI: "257", BJ: "229", BL: "590", BM: "1441", BN: "673",
  BQ: "599", BS: "1242", BT: "975", BV: "47", BW: "267", BY: "375", BZ: "501",
  CC: "61", CD: "243", CF: "236", CG: "242", CH: "41", CI: "225", CK: "682", CM: "237",
  CU: "53", CV: "238", CW: "599", CX: "61", CY: "357", CZ: "420", DJ: "253", DK: "45",
  DM: "1767", DZ: "213", EE: "372", EG: "20", EH: "212", ER: "291", ET: "251", FI: "358",
  FJ: "679", FK: "500", FM: "691", FO: "298", GA: "241", GD: "1473", GE: "995", GF: "594",
  GG: "44", GH: "233", GI: "350", GL: "299", GM: "220", GN: "224", GP: "590", GQ: "240",
  GR: "30", GS: "500", GU: "1671", GW: "245", GY: "592", HK: "852", HM: "672", HR: "385",
  HT: "509", HU: "36", ID: "62", IE: "353", IL: "972", IM: "44", IO: "246", IQ: "964",
  IR: "98", IS: "354", JE: "44", JO: "962", KE: "254", KG: "996", KH: "855", KI: "686",
  KM: "269", KN: "1869", KP: "850", KR: "82", KW: "965", KY: "1345", KZ: "7", LA: "856",
  LB: "961", LC: "1758", LI: "423", LK: "94", LR: "231", LS: "266", LT: "370", LU: "352",
  LV: "371", LY: "218", MA: "212", MC: "377", MD: "373", ME: "382", MF: "590", MG: "261",
  MH: "692", MK: "389", ML: "223", MM: "95", MN: "976", MO: "853", MP: "1670", MQ: "596",
  MR: "222", MS: "1664", MT: "356", MU: "230", MV: "960", MW: "265", MY: "60", MZ: "258",
  NA: "264", NC: "687", NE: "227", NF: "672", NL: "31", NO: "47", NP: "977", NR: "674",
  NU: "683", NZ: "64", OM: "968", PF: "689", PG: "675", PK: "92", PL: "48", PM: "508",
  PN: "64", PS: "970", PW: "680", QA: "974", RE: "262", RO: "40", RS: "381", RU: "7",
  RW: "250", SA: "966", SB: "677", SC: "248", SD: "249", SE: "46", SG: "65", SH: "290",
  SI: "386", SJ: "47", SK: "421", SL: "232", SM: "378", SN: "221", SO: "252", SR: "597",
  SS: "211", ST: "239", SX: "1721", SY: "963", SZ: "268", TC: "1649", TD: "235", TF: "262",
  TG: "228", TH: "66", TJ: "992", TK: "690", TL: "670", TM: "993", TN: "216", TO: "676",
  TR: "90", TV: "688", TW: "886", TZ: "255", UA: "380", UG: "256", UM: "1", UZ: "998",
  VA: "39", VC: "1784", VG: "1284", VI: "1340", VN: "84", VU: "678", WF: "681", WS: "685",
  YE: "967", YT: "262", ZM: "260", ZW: "263",
};
const VALID_CALLING_CODES = new Set((
  "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 " +
  "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 " +
  "350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 " +
  "670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998"
).split(/\s+/));

/** Normalize an international phone and reject placeholder or malformed E.164 numbers. */
export function normalizeLoginPhone(value: string, countryCode?: string): string {
  const trimmed = value.trim();
  if (!/^\+\d(?:[\d\s().-]*\d)?$/.test(trimmed)) throw new Error("PHONE_INVALID");
  const digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+") || !/^[1-9]\d{6,14}$/.test(digits)) throw new Error("PHONE_INVALID");

  const expectedPrefix = countryCode ? PHONE_COUNTRY_PREFIXES[countryCode.toUpperCase()] : undefined;
  if (expectedPrefix && !digits.startsWith(expectedPrefix)) throw new Error("PHONE_COUNTRY_MISMATCH");
  const prefix = expectedPrefix ?? [...VALID_CALLING_CODES].sort((left, right) => right.length - left.length).find((code) => digits.startsWith(code));
  if (!prefix) throw new Error("PHONE_INVALID");
  const national = digits.slice(prefix.length);
  if (national.length < 4 || /^0+$/.test(national) || /^(\d)\1+$/.test(national)) {
    throw new Error("PHONE_INVALID");
  }
  if (prefix === "1") {
    const nanp = digits.slice(1);
    if (nanp.length !== 10 || /^[01]/.test(nanp) || /^[01]/.test(nanp.slice(3))) throw new Error("PHONE_INVALID");
  }
  return `+${digits}`;
}

export function phonePrefixForCountry(countryCode: string): string | undefined {
  return PHONE_COUNTRY_PREFIXES[countryCode.toUpperCase()];
}

export function phoneLoginEmail(phone: string): string {
  const digits = normalizeLoginPhone(phone).replace(/\D/g, "");
  return `phone-${digits}@users.cupido.invalid`;
}
