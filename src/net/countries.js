// Country data for the scoreboard: ISO 3166-1 alpha-2 list, a best-effort
// guess of the player's country, and flags (real SVG flags from flag-icons via
// flagUrl() / loadFlagImage(); emoji and monogram badges as fallbacks).
// No network except loadFlagImage() fetching same-origin flag assets.

/** All 249 ISO 3166-1 alpha-2 codes with short English names, sorted by name. */
export const COUNTRIES = Object.freeze([
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AX', name: 'Åland Islands' },
  { code: 'AL', name: 'Albania' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'AD', name: 'Andorra' },
  { code: 'AO', name: 'Angola' },
  { code: 'AI', name: 'Anguilla' },
  { code: 'AQ', name: 'Antarctica' },
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AW', name: 'Aruba' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BB', name: 'Barbados' },
  { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Benin' },
  { code: 'BM', name: 'Bermuda' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'BW', name: 'Botswana' },
  { code: 'BV', name: 'Bouvet Island' },
  { code: 'BR', name: 'Brazil' },
  { code: 'IO', name: 'British Indian Ocean Territory' },
  { code: 'VG', name: 'British Virgin Islands' },
  { code: 'BN', name: 'Brunei' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CA', name: 'Canada' },
  { code: 'CV', name: 'Cape Verde' },
  { code: 'BQ', name: 'Caribbean Netherlands' },
  { code: 'KY', name: 'Cayman Islands' },
  { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CX', name: 'Christmas Island' },
  { code: 'CC', name: 'Cocos (Keeling) Islands' },
  { code: 'CO', name: 'Colombia' },
  { code: 'KM', name: 'Comoros' },
  { code: 'CG', name: 'Congo' },
  { code: 'CD', name: 'Congo (DRC)' },
  { code: 'CK', name: 'Cook Islands' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CI', name: 'Côte d\'Ivoire' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CU', name: 'Cuba' },
  { code: 'CW', name: 'Curaçao' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' },
  { code: 'EE', name: 'Estonia' },
  { code: 'SZ', name: 'Eswatini' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'FK', name: 'Falkland Islands' },
  { code: 'FO', name: 'Faroe Islands' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GF', name: 'French Guiana' },
  { code: 'PF', name: 'French Polynesia' },
  { code: 'TF', name: 'French Southern Territories' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia' },
  { code: 'DE', name: 'Germany' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GI', name: 'Gibraltar' },
  { code: 'GR', name: 'Greece' },
  { code: 'GL', name: 'Greenland' },
  { code: 'GD', name: 'Grenada' },
  { code: 'GP', name: 'Guadeloupe' },
  { code: 'GU', name: 'Guam' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'GG', name: 'Guernsey' },
  { code: 'GN', name: 'Guinea' },
  { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti' },
  { code: 'HM', name: 'Heard and McDonald Islands' },
  { code: 'HN', name: 'Honduras' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IM', name: 'Isle of Man' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'JP', name: 'Japan' },
  { code: 'JE', name: 'Jersey' },
  { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'LA', name: 'Laos' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MO', name: 'Macao' },
  { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta' },
  { code: 'MH', name: 'Marshall Islands' },
  { code: 'MQ', name: 'Martinique' },
  { code: 'MR', name: 'Mauritania' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'YT', name: 'Mayotte' },
  { code: 'MX', name: 'Mexico' },
  { code: 'FM', name: 'Micronesia' },
  { code: 'MD', name: 'Moldova' },
  { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'ME', name: 'Montenegro' },
  { code: 'MS', name: 'Montserrat' },
  { code: 'MA', name: 'Morocco' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'NA', name: 'Namibia' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NP', name: 'Nepal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NC', name: 'New Caledonia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NU', name: 'Niue' },
  { code: 'NF', name: 'Norfolk Island' },
  { code: 'KP', name: 'North Korea' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PW', name: 'Palau' },
  { code: 'PS', name: 'Palestine' },
  { code: 'PA', name: 'Panama' },
  { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PN', name: 'Pitcairn Islands' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RE', name: 'Réunion' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'BL', name: 'Saint Barthélemy' },
  { code: 'SH', name: 'Saint Helena' },
  { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'MF', name: 'Saint Martin' },
  { code: 'PM', name: 'Saint Pierre and Miquelon' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'WS', name: 'Samoa' },
  { code: 'SM', name: 'San Marino' },
  { code: 'ST', name: 'São Tomé and Príncipe' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SN', name: 'Senegal' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SX', name: 'Sint Maarten' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SB', name: 'Solomon Islands' },
  { code: 'SO', name: 'Somalia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'GS', name: 'South Georgia and South Sandwich Islands' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SS', name: 'South Sudan' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SD', name: 'Sudan' },
  { code: 'SR', name: 'Suriname' },
  { code: 'SJ', name: 'Svalbard and Jan Mayen' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SY', name: 'Syria' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' },
  { code: 'TG', name: 'Togo' },
  { code: 'TK', name: 'Tokelau' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'TC', name: 'Turks and Caicos Islands' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UM', name: 'U.S. Outlying Islands' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
  { code: 'UG', name: 'Uganda' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'VA', name: 'Vatican City' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'WF', name: 'Wallis and Futuna' },
  { code: 'EH', name: 'Western Sahara' },
  { code: 'YE', name: 'Yemen' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
]);

const CODE_SET = new Set(COUNTRIES.map(c => c.code));
const NAME_BY_CODE = new Map(COUNTRIES.map(c => [c.code, c.name]));

/** Normalises 'fr' / ' FR ' to 'FR'; returns null unless it is an ISO 3166-1 code. */
export function normalizeCountry(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  return CODE_SET.has(c) ? c : null;
}

/** English name for a code, or '' if unknown. */
export function countryName(code) {
  return NAME_BY_CODE.get(normalizeCountry(code)) || '';
}

// IANA time zone -> country, for the most common zones (plus legacy aliases
// that browsers still report). Zones shared by several countries are omitted.
export const TIMEZONE_COUNTRY = Object.freeze({
  // Europe
  'Europe/London': 'GB', 'Europe/Belfast': 'GB', 'Europe/Dublin': 'IE', 'Europe/Lisbon': 'PT',
  'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES',
  'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Amsterdam': 'NL', 'Europe/Luxembourg': 'LU',
  'Europe/Monaco': 'MC', 'Europe/Zurich': 'CH', 'Europe/Berlin': 'DE', 'Europe/Vienna': 'AT',
  'Europe/Rome': 'IT', 'Europe/Malta': 'MT', 'Europe/Prague': 'CZ', 'Europe/Bratislava': 'SK',
  'Europe/Budapest': 'HU', 'Europe/Warsaw': 'PL', 'Europe/Copenhagen': 'DK', 'Europe/Oslo': 'NO',
  'Europe/Stockholm': 'SE', 'Europe/Helsinki': 'FI', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT', 'Europe/Athens': 'GR', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG',
  'Europe/Belgrade': 'RS', 'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI', 'Europe/Sarajevo': 'BA',
  'Europe/Skopje': 'MK', 'Europe/Tirane': 'AL', 'Europe/Podgorica': 'ME', 'Europe/Chisinau': 'MD',
  'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Minsk': 'BY', 'Europe/Moscow': 'RU',
  'Europe/Kaliningrad': 'RU', 'Europe/Samara': 'RU', 'Europe/Volgograd': 'RU', 'Europe/Istanbul': 'TR',
  'Asia/Istanbul': 'TR', 'Atlantic/Reykjavik': 'IS', 'Europe/Gibraltar': 'GI', 'Europe/Andorra': 'AD',
  'Asia/Nicosia': 'CY', 'Europe/Nicosia': 'CY',
  // Americas
  'America/New_York': 'US', 'America/Detroit': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Phoenix': 'US', 'America/Los_Angeles': 'US', 'America/Anchorage': 'US', 'America/Boise': 'US',
  'America/Indiana/Indianapolis': 'US', 'America/Indianapolis': 'US', 'America/Kentucky/Louisville': 'US',
  'Pacific/Honolulu': 'US', 'US/Eastern': 'US', 'US/Central': 'US', 'US/Mountain': 'US', 'US/Pacific': 'US',
  'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA', 'America/Regina': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX', 'America/Cancun': 'MX',
  'America/Guatemala': 'GT', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN',
  'America/Managua': 'NI', 'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Havana': 'CU',
  'America/Jamaica': 'JM', 'America/Santo_Domingo': 'DO', 'America/Puerto_Rico': 'PR',
  'America/Port-au-Prince': 'HT', 'America/Port_of_Spain': 'TT', 'America/Barbados': 'BB',
  'America/Bogota': 'CO', 'America/Caracas': 'VE', 'America/Lima': 'PE', 'America/Guayaquil': 'EC',
  'America/La_Paz': 'BO', 'America/Santiago': 'CL', 'America/Argentina/Buenos_Aires': 'AR',
  'America/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR', 'America/Montevideo': 'UY',
  'America/Asuncion': 'PY', 'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
  'America/Recife': 'BR', 'America/Belem': 'BR', 'America/Manaus': 'BR',
  // Asia
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Pyongyang': 'KP', 'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN', 'Asia/Urumqi': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO',
  'Asia/Taipei': 'TW', 'Asia/Manila': 'PH', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA',
  'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM', 'Asia/Brunei': 'BN', 'Asia/Dhaka': 'BD',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Kathmandu': 'NP', 'Asia/Thimphu': 'BT',
  'Asia/Colombo': 'LK', 'Indian/Maldives': 'MV', 'Asia/Karachi': 'PK', 'Asia/Kabul': 'AF',
  'Asia/Tashkent': 'UZ', 'Asia/Almaty': 'KZ', 'Asia/Bishkek': 'KG', 'Asia/Dushanbe': 'TJ',
  'Asia/Ashgabat': 'TM', 'Asia/Ulaanbaatar': 'MN', 'Asia/Tehran': 'IR', 'Asia/Baghdad': 'IQ',
  'Asia/Kuwait': 'KW', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Bahrain': 'BH',
  'Asia/Dubai': 'AE', 'Asia/Muscat': 'OM', 'Asia/Aden': 'YE', 'Asia/Amman': 'JO', 'Asia/Beirut': 'LB',
  'Asia/Damascus': 'SY', 'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Asia/Gaza': 'PS',
  'Asia/Hebron': 'PS', 'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Baku': 'AZ',
  'Asia/Yekaterinburg': 'RU', 'Asia/Novosibirsk': 'RU', 'Asia/Krasnoyarsk': 'RU',
  'Asia/Irkutsk': 'RU', 'Asia/Vladivostok': 'RU',
  // Africa
  'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN',
  'Africa/Tripoli': 'LY', 'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Abidjan': 'CI',
  'Africa/Dakar': 'SN', 'Africa/Douala': 'CM', 'Africa/Kinshasa': 'CD', 'Africa/Luanda': 'AO',
  'Africa/Khartoum': 'SD', 'Africa/Addis_Ababa': 'ET', 'Africa/Nairobi': 'KE', 'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kigali': 'RW', 'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW',
  'Africa/Maputo': 'MZ', 'Africa/Windhoek': 'NA', 'Africa/Gaborone': 'BW',
  'Africa/Johannesburg': 'ZA', 'Indian/Antananarivo': 'MG', 'Indian/Mauritius': 'MU',
  'Indian/Reunion': 'RE',
  // Oceania
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Australia/Hobart': 'AU',
  'Australia/Darwin': 'AU', 'Australia/Canberra': 'AU', 'Pacific/Auckland': 'NZ', 'Pacific/Fiji': 'FJ',
  'Pacific/Guam': 'GU', 'Pacific/Port_Moresby': 'PG', 'Pacific/Noumea': 'NC', 'Pacific/Tahiti': 'PF',
});

/** Region subtag of a BCP 47 tag ('fr-FR' -> 'FR', 'zh-Hant-TW' -> 'TW', 'en' -> null, 'es-419' -> null). */
export function regionOfLanguageTag(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  let region = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Locale === 'function') region = new Intl.Locale(tag.trim()).region || null;
  } catch { /* e.g. 'en_US': fall through to the regex */ }
  if (!region) {
    const m = /^[a-z]{2,3}(?:[-_][a-z]{4})?[-_]([a-z]{2})(?:[-_]|$)/i.exec(tag.trim());
    region = m ? m[1] : null;
  }
  return normalizeCountry(region);
}

function navigatorLanguages() {
  if (typeof navigator === 'undefined' || !navigator) return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function currentTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/**
 * Best-effort country of the player, or null.
 * 1. Regions of navigator.languages ('fr-FR' -> FR; a bare 'en' carries no region).
 *    If the time zone's country is also among those regions, it wins.
 *    Exception: an 'en-US' first language is the default UI language of countless
 *    non-US machines, so when the time zone clearly points elsewhere, the zone wins.
 * 2. Intl time zone -> country (TIMEZONE_COUNTRY).
 * 3. null.
 * Both inputs can be injected (tests / custom UIs).
 */
export function guessCountry({ languages, timeZone } = {}) {
  const langs = Array.isArray(languages) ? languages : navigatorLanguages();
  const tz = timeZone === undefined ? currentTimeZone() : timeZone;
  const tzCountry = (tz && TIMEZONE_COUNTRY[tz]) || null;
  const regions = [];
  let firstTag = null;
  for (const tag of langs) {
    const r = regionOfLanguageTag(tag);
    if (!r) continue;
    if (!regions.length) firstTag = String(tag).trim().replace('_', '-').toLowerCase();
    if (!regions.includes(r)) regions.push(r);
  }
  if (tzCountry && regions.includes(tzCountry)) return tzCountry;
  if (regions.length) {
    if (firstTag === 'en-us' && tzCountry && tzCountry !== 'US') return tzCountry;
    return regions[0];
  }
  return tzCountry;
}

/** 'FR' -> '🇫🇷' (regional indicator pair); '' for anything that is not two letters. */
export function flagEmoji(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code.trim())) return '';
  return [...code.trim().toUpperCase()].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

// ---------------------------------------------------------------------------
// Real flags: flag-icons (MIT) 4x3 SVGs, emitted by Vite as hashed asset files
// and loaded lazily by URL. Only the URL map (a few KB of strings) is in the JS
// bundle; 'no-inline' stops Vite from base64-inlining the small SVGs.
// ---------------------------------------------------------------------------

let FLAG_FILES = {};
try {
  FLAG_FILES = import.meta.glob('./??.svg', {
    base: '/node_modules/flag-icons/flags/4x3/',
    query: '?url&no-inline', import: 'default', eager: true,
  });
} catch { /* plain Node without Vite: no flag files, flagUrl() returns null */ }

/** Intrinsic size given to flag images by loadFlagImage() (the SVGs' 4x3 viewBox). */
export const FLAG_IMAGE_SIZE = Object.freeze({ width: 640, height: 480 });

/**
 * URL of the real 4x3 SVG flag for an ISO 3166-1 alpha-2 code ('fr', 'FR', ' fr ').
 * Same-origin asset URL; use it in <img src>, CSS backgrounds, etc.
 * Unknown codes, non-ISO codes and null -> null.
 */
export function flagUrl(code) {
  const c = normalizeCountry(code);
  if (!c) return null;
  return FLAG_FILES[`./${c.toLowerCase()}.svg`] || null;
}

const flagImageCache = new Map(); // code -> Promise<HTMLImageElement|null>

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Loads a flag as an HTMLImageElement ready for ctx.drawImage() or a WebGL /
 * three.js texture. Resolves null for unknown codes, outside a browser, or on
 * load failure (failures are not cached, so a later call retries).
 * Cached per code: every call for 'FR' shares one image.
 *
 * The flag-icons SVGs only carry a viewBox, and some browsers (Firefox) refuse
 * to draw or upload SVG images that have no intrinsic size. So the SVG text is
 * fetched (same origin), given width=640 height=480, and loaded from a blob:
 * URL. The canvas stays untainted. If fetch is unavailable, the asset URL is
 * loaded directly.
 */
export function loadFlagImage(code) {
  const c = normalizeCountry(code);
  const url = c && flagUrl(c);
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  if (flagImageCache.has(c)) return flagImageCache.get(c);
  const promise = (async () => {
    let src = url;
    if (typeof fetch === 'function' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          let svg = await res.text();
          if (!/<svg[^>]*\swidth=/i.test(svg)) {
            svg = svg.replace(/<svg\b/i, `<svg width="${FLAG_IMAGE_SIZE.width}" height="${FLAG_IMAGE_SIZE.height}" preserveAspectRatio="none"`);
          }
          src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        }
      } catch { /* fall back to the asset URL */ }
    }
    const img = await loadImage(src);
    if (!img) {
      flagImageCache.delete(c);
      if (src !== url && src.startsWith('blob:')) URL.revokeObjectURL(src);
    }
    return img;
  })();
  flagImageCache.set(c, promise);
  return promise;
}

/** Drops cached flag images (tests, or to free memory). */
export function clearFlagImageCache() {
  flagImageCache.clear();
}

// ---------------------------------------------------------------------------
// Fallback-only helpers. Prefer flagUrl() / loadFlagImage() for display: the
// monogram badge below is just the two letters in a box, and flagEmoji() shows
// as two letters on Windows. Kept for backward compatibility and as a fallback
// when flagUrl() returns null.
// ---------------------------------------------------------------------------

/**
 * Windows renders flag emoji as two letters (fallback-only; see flagUrl()).
 * Heuristic on the platform string; pass a UA to test.
 */
export function emojiFlagsSupported(ua) {
  let platform = '';
  if (ua === undefined && typeof navigator !== 'undefined' && navigator) {
    platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent || '';
  } else {
    platform = ua || '';
  }
  return !/windows/i.test(platform);
}

/**
 * FALLBACK ONLY (use flagUrl() for real flags): a small rounded monogram badge
 * with the code in it, as an SVG string. Colour is derived from the code.
 * Returns '' for invalid codes.
 */
export function flagSvg(code, { height = 18 } = {}) {
  const c = normalizeCountry(code) || (typeof code === 'string' && /^[A-Za-z]{2}$/.test(code.trim()) ? code.trim().toUpperCase() : null);
  if (!c) return '';
  const h = Math.max(8, Number(height) || 18);
  const w = Math.round(h * 4 / 3);
  const hue = ((c.charCodeAt(0) - 65) * 26 + (c.charCodeAt(1) - 65)) * 47 % 360;
  const label = countryName(c) || c;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 32 24" role="img" aria-label="${label.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`)}">`
    + `<rect x="0.5" y="0.5" width="31" height="23" rx="4" fill="hsl(${hue} 55% 34%)" stroke="rgba(255,255,255,.55)"/>`
    + `<text x="16" y="16.5" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="0.5" fill="#fff">${c}</text></svg>`;
}

/** FALLBACK ONLY: flagSvg() monogram as a data: URL. Prefer flagUrl(). */
export function flagDataUrl(code, opts) {
  const svg = flagSvg(code, opts);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
