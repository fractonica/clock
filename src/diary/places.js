/**
 * The default place of the diary's sky (Sun and Moon on the pages): the main city of an IANA zone. Options can name
 * any coordinates (opts.sky.lat / lon); this table only fills them when they are empty.
 *
 * placeOf(opts, zone) -> {place, lat, lon} | null   (null: no coordinates and an unknown zone – no sky is drawn)
 */

/** zone → [city, latitude °N, longitude °E] */
const ZONES = {
  'Europe/Moscow': ['Moscow', 55.7558, 37.6173],
  'Europe/London': ['London', 51.5074, -0.1278],
  'Europe/Dublin': ['Dublin', 53.3498, -6.2603],
  'Europe/Lisbon': ['Lisbon', 38.7223, -9.1393],
  'Europe/Madrid': ['Madrid', 40.4168, -3.7038],
  'Europe/Paris': ['Paris', 48.8566, 2.3522],
  'Europe/Brussels': ['Brussels', 50.8503, 4.3517],
  'Europe/Amsterdam': ['Amsterdam', 52.3676, 4.9041],
  'Europe/Berlin': ['Berlin', 52.52, 13.405],
  'Europe/Zurich': ['Zurich', 47.3769, 8.5417],
  'Europe/Rome': ['Rome', 41.9028, 12.4964],
  'Europe/Vienna': ['Vienna', 48.2082, 16.3738],
  'Europe/Prague': ['Prague', 50.0755, 14.4378],
  'Europe/Warsaw': ['Warsaw', 52.2297, 21.0122],
  'Europe/Stockholm': ['Stockholm', 59.3293, 18.0686],
  'Europe/Oslo': ['Oslo', 59.9139, 10.7522],
  'Europe/Copenhagen': ['Copenhagen', 55.6761, 12.5683],
  'Europe/Helsinki': ['Helsinki', 60.1699, 24.9384],
  'Europe/Riga': ['Riga', 56.9496, 24.1052],
  'Europe/Vilnius': ['Vilnius', 54.6872, 25.2797],
  'Europe/Tallinn': ['Tallinn', 59.437, 24.7536],
  'Europe/Kiev': ['Kyiv', 50.4501, 30.5234],
  'Europe/Kyiv': ['Kyiv', 50.4501, 30.5234],
  'Europe/Minsk': ['Minsk', 53.9006, 27.559],
  'Europe/Bucharest': ['Bucharest', 44.4268, 26.1025],
  'Europe/Sofia': ['Sofia', 42.6977, 23.3219],
  'Europe/Athens': ['Athens', 37.9838, 23.7275],
  'Europe/Istanbul': ['Istanbul', 41.0082, 28.9784],
  'Europe/Belgrade': ['Belgrade', 44.7866, 20.4489],
  'Europe/Budapest': ['Budapest', 47.4979, 19.0402],
  'Europe/Samara': ['Samara', 53.1959, 50.1002],
  'Europe/Kaliningrad': ['Kaliningrad', 54.7104, 20.4522],
  'Asia/Yekaterinburg': ['Yekaterinburg', 56.8389, 60.6057],
  'Asia/Omsk': ['Omsk', 54.9885, 73.3242],
  'Asia/Novosibirsk': ['Novosibirsk', 55.0084, 82.9357],
  'Asia/Krasnoyarsk': ['Krasnoyarsk', 56.0153, 92.8932],
  'Asia/Irkutsk': ['Irkutsk', 52.2869, 104.305],
  'Asia/Yakutsk': ['Yakutsk', 62.0355, 129.6755],
  'Asia/Vladivostok': ['Vladivostok', 43.1155, 131.8855],
  'Asia/Magadan': ['Magadan', 59.5612, 150.8301],
  'Asia/Kamchatka': ['Petropavlovsk-Kamchatsky', 53.0452, 158.6483],
  'Asia/Tbilisi': ['Tbilisi', 41.7151, 44.8271],
  'Asia/Yerevan': ['Yerevan', 40.1792, 44.4991],
  'Asia/Baku': ['Baku', 40.4093, 49.8671],
  'Asia/Almaty': ['Almaty', 43.222, 76.8512],
  'Asia/Tashkent': ['Tashkent', 41.2995, 69.2401],
  'Asia/Dubai': ['Dubai', 25.2048, 55.2708],
  'Asia/Tehran': ['Tehran', 35.6892, 51.389],
  'Asia/Jerusalem': ['Jerusalem', 31.7683, 35.2137],
  'Asia/Riyadh': ['Riyadh', 24.7136, 46.6753],
  'Asia/Karachi': ['Karachi', 24.8607, 67.0011],
  'Asia/Kolkata': ['New Delhi', 28.6139, 77.209],
  'Asia/Kathmandu': ['Kathmandu', 27.7172, 85.324],
  'Asia/Dhaka': ['Dhaka', 23.8103, 90.4125],
  'Asia/Bangkok': ['Bangkok', 13.7563, 100.5018],
  'Asia/Jakarta': ['Jakarta', -6.2088, 106.8456],
  'Asia/Singapore': ['Singapore', 1.3521, 103.8198],
  'Asia/Shanghai': ['Beijing', 39.9042, 116.4074],
  'Asia/Hong_Kong': ['Hong Kong', 22.3193, 114.1694],
  'Asia/Taipei': ['Taipei', 25.033, 121.5654],
  'Asia/Seoul': ['Seoul', 37.5665, 126.978],
  'Asia/Tokyo': ['Tokyo', 35.6762, 139.6503],
  'Asia/Manila': ['Manila', 14.5995, 120.9842],
  'Australia/Perth': ['Perth', -31.9505, 115.8605],
  'Australia/Adelaide': ['Adelaide', -34.9285, 138.6007],
  'Australia/Brisbane': ['Brisbane', -27.4698, 153.0251],
  'Australia/Sydney': ['Sydney', -33.8688, 151.2093],
  'Australia/Melbourne': ['Melbourne', -37.8136, 144.9631],
  'Pacific/Auckland': ['Auckland', -36.8485, 174.7633],
  'Pacific/Honolulu': ['Honolulu', 21.3069, -157.8583],
  'America/Anchorage': ['Anchorage', 61.2181, -149.9003],
  'America/Los_Angeles': ['Los Angeles', 34.0522, -118.2437],
  'America/Vancouver': ['Vancouver', 49.2827, -123.1207],
  'America/Denver': ['Denver', 39.7392, -104.9903],
  'America/Phoenix': ['Phoenix', 33.4484, -112.074],
  'America/Chicago': ['Chicago', 41.8781, -87.6298],
  'America/Mexico_City': ['Mexico City', 19.4326, -99.1332],
  'America/New_York': ['New York', 40.7128, -74.006],
  'America/Toronto': ['Toronto', 43.6532, -79.3832],
  'America/Halifax': ['Halifax', 44.6488, -63.5752],
  'America/Bogota': ['Bogotá', 4.711, -74.0721],
  'America/Lima': ['Lima', -12.0464, -77.0428],
  'America/Santiago': ['Santiago', -33.4489, -70.6693],
  'America/Argentina/Buenos_Aires': ['Buenos Aires', -34.6037, -58.3816],
  'America/Sao_Paulo': ['São Paulo', -23.5505, -46.6333],
  'Africa/Cairo': ['Cairo', 30.0444, 31.2357],
  'Africa/Lagos': ['Lagos', 6.5244, 3.3792],
  'Africa/Nairobi': ['Nairobi', -1.2921, 36.8219],
  'Africa/Johannesburg': ['Johannesburg', -26.2041, 28.0473],
  'Africa/Casablanca': ['Casablanca', 33.5731, -7.5898],
  'Atlantic/Reykjavik': ['Reykjavík', 64.1466, -21.9426],
};

/** The place of a zone's main city, or null. */
export function zonePlace(zone) {
  const z = ZONES[zone];
  return z ? { place: z[0], lat: z[1], lon: z[2] } : null;
}

/** The diary's sky place: the options' coordinates, else the zone's city; null when neither is known. */
export function placeOf(opts, zone) {
  const s = opts.sky ?? {};
  if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) return { place: s.place ?? null, lat: s.lat, lon: s.lon };
  return zonePlace(zone);
}
