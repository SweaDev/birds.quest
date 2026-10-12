// Place names that must never appear in generated posts or in LLM prompts.
// The trip's own location is never known to the LLM, but Wikipedia range text and
// model hallucinations can still name places, so everything below is filtered.

const CONTINENTS_AND_REGIONS = [
  "Europe", "Asia", "Africa", "North America", "South America", "Central America", "Latin America",
  "Oceania", "Australasia", "Antarctica", "Arctic", "Antarctic", "Eurasia", "Palearctic", "Palaearctic",
  "Nearctic", "Neotropics", "Afrotropics", "Indomalaya", "Scandinavia", "Siberia", "Himalayas", "Himalaya",
  "Caribbean", "Middle East", "Balkans", "British Isles", "Iberian Peninsula", "Iberia", "Mediterranean",
  "Baltic", "Caucasus", "Sahara", "Sahel", "Amazon", "Andes", "Alps", "Pyrenees", "Urals", "Carpathians",
  "Atlantic", "Pacific", "Indian Ocean", "Arabian Peninsula", "Southeast Asia", "East Asia", "South Asia",
  "Central Asia", "Western Europe", "Eastern Europe", "Northern Europe", "Southern Europe", "Central Europe",
  "West Africa", "East Africa", "North Africa", "Southern Africa", "Sub-Saharan Africa", "Scandinavian",
  "New England", "Midwest", "Great Lakes", "Rocky Mountains", "Patagonia", "Tasmania", "Greenland",
  "Hemisphere", "Western Palearctic", "Holarctic", "Macaronesia", "Madagascar", "Borneo", "Sumatra",
  "Java", "Sulawesi", "New Guinea", "Hispaniola", "Lapland", "Anatolia", "Mesopotamia", "Levant",
  "Transcaucasia", "Polynesia", "Melanesia", "Micronesia", "Wallacea",
];

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin",
  "Bhutan", "Bolivia", "Bosnia", "Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso",
  "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Czech Republic", "Denmark", "Djibouti",
  "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Eritrea", "Estonia", "Eswatini",
  "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece",
  "Grenada", "Guatemala", "Guinea", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia",
  "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan",
  "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia",
  "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Burma", "Namibia", "Nauru", "Nepal", "Netherlands", "Holland", "New Zealand", "Nicaragua",
  "Niger", "Nigeria", "North Korea", "South Korea", "Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
  "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar", "Romania", "Russia", "Rwanda", "Samoa", "San Marino", "Saudi Arabia", "Senegal", "Serbia",
  "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa", "South Sudan",
  "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Togo", "Tonga", "Trinidad", "Tunisia", "Turkey", "Türkiye", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "UK", "Britain", "Great Britain", "England",
  "Scotland", "Wales", "Northern Ireland", "United States", "USA", "America", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe", "Hawaii", "Alaska",
  "Puerto Rico", "Siberia", "Greenland", "Svalbard", "Faroe Islands", "Canary Islands", "Azores", "Madeira",
];

const SUBDIVISIONS = [
  "Alabama", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "Ontario", "Quebec", "British Columbia",
  "Alberta", "Manitoba", "Saskatchewan", "Nova Scotia", "New Brunswick", "Newfoundland", "Queensland",
  "Victoria", "New South Wales", "Western Australia", "South Australia", "Northern Territory", "Bavaria",
  "Saxony", "Brandenburg", "Catalonia", "Andalusia", "Tuscany", "Normandy", "Brittany", "Provence",
  "Cornwall", "Yorkshire", "Kent", "Devon", "Norfolk", "Suffolk", "Cumbria",
];

const CITIES = [
  "Berlin", "London", "Paris", "Madrid", "Rome", "Vienna", "Amsterdam", "Brussels", "Copenhagen", "Stockholm",
  "Oslo", "Helsinki", "Warsaw", "Prague", "Budapest", "Lisbon", "Dublin", "Athens", "Istanbul", "Moscow",
  "Kyiv", "Munich", "Hamburg", "Frankfurt", "Cologne", "Zurich", "Geneva", "Barcelona", "Milan", "Edinburgh",
  "Manchester", "Birmingham", "New York City", "Los Angeles", "Chicago", "Houston", "Seattle", "San Francisco",
  "Boston", "Toronto", "Vancouver", "Montreal", "Mexico City", "São Paulo", "Sao Paulo", "Rio de Janeiro",
  "Buenos Aires", "Santiago", "Lima", "Bogotá", "Bogota", "Cairo", "Lagos", "Nairobi", "Johannesburg",
  "Cape Town", "Dubai", "Tel Aviv", "Tehran", "Delhi", "Mumbai", "Kolkata", "Bangalore", "Dhaka", "Karachi",
  "Bangkok", "Jakarta", "Manila", "Hanoi", "Singapore", "Beijing", "Shanghai", "Hong Kong", "Seoul", "Tokyo",
  "Osaka", "Kyoto", "Sydney", "Melbourne", "Brisbane", "Perth", "Auckland", "Wellington", "Dhaka",
];

const PLACES: string[] = [...new Set([...CONTINENTS_AND_REGIONS, ...COUNTRIES, ...SUBDIVISIONS, ...CITIES])];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Case-sensitive on purpose: "Turkey" the country, not "turkey" the bird, and
// not Latin species epithets such as "niger" or "americanus".
const PLACE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${PLACES.sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);

// Anything that looks like a position or a pointer to one.
const HARD_PATTERNS: [string, RegExp][] = [
  ["coordinate pair", /-?\d{1,3}\.\d{2,}\s*[,;/]\s*-?\d{1,3}\.\d{2,}/],
  ["decimal coordinate", /(?<![\d.])-?\d{1,2}\.\d{4,}(?![\d.])/],
  ["degrees", /\d\s*°\s*\d*/],
  ["degrees-minutes", /\d+\s*[°º]\s*\d+\s*['′]/],
  ["coordinates word", /\b(?:latitude|longitude|coordinates?|geolocation|geotag(?:ged)?|gps|waypoint|lat\/lon|lat\/long)\b/i],
  ["map link", /\b(?:google maps|openstreetmap|osm|traccar|mapbox)\b/i],
  ["url", /\b(?:https?:\/\/|www\.)\S+/i],
];

export type LocationLeaks = {
  /** Things that must reject the whole text, e.g. coordinates or links. */
  hard: string[];
  /** Place names; the sentence containing them can be dropped. */
  places: string[];
};

/** Replaces allowed names (species names that contain place words) so they are not flagged. */
export function maskNames(text: string, allowedNames: readonly string[]): string {
  let masked = text;
  const names = [...allowedNames].filter((n) => n.trim().length > 2).sort((a, b) => b.length - a.length);
  for (const name of names) {
    masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "giu"), "§");
  }
  return masked;
}

export function findLocationLeaks(text: string, allowedNames: readonly string[] = []): LocationLeaks {
  const masked = maskNames(text, allowedNames);
  const hard = HARD_PATTERNS.filter(([, pattern]) => pattern.test(masked)).map(([label]) => label);
  const places = [...masked.matchAll(PLACE_PATTERN)].map((m) => m[0]);
  return { hard, places: [...new Set(places)] };
}

export function hasLocationLeak(text: string, allowedNames: readonly string[] = []): boolean {
  const leaks = findLocationLeaks(text, allowedNames);
  return leaks.hard.length > 0 || leaks.places.length > 0;
}

/** Splits text into sentences, keeping the terminators. */
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$|\n)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/** Drops every sentence that names a place. Returns the clean text and what was removed. */
export function stripPlaceSentences(
  text: string,
  allowedNames: readonly string[] = [],
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = splitSentences(text).filter((sentence) => {
    if (findLocationLeaks(sentence, allowedNames).places.length === 0) return true;
    removed.push(sentence);
    return false;
  });
  return { text: kept.join(" "), removed };
}
