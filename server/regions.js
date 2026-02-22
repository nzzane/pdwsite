// New Zealand regions with search terms (towns, suburbs, districts) for location filtering.
// Terms are matched case-insensitively against message content using word boundaries.
// Excludes prevent false positives from compound place names (e.g., Mount Wellington).
// Street suffix detection automatically prevents matching terms used as street names
// (e.g., "Tawa St", "Featherston St", "Heretaunga St" won't match as locations).

// Common NZ street/road type suffixes — if a term is immediately followed by one of
// these, it's a street name rather than a location/suburb reference.
const STREET_SUFFIXES = [
  'st', 'street', 'rd', 'road', 'ave', 'avenue', 'dr', 'drive',
  'pl', 'place', 'cres', 'crescent', 'cr', 'tce', 'terrace',
  'way', 'lane', 'ln', 'blvd', 'hwy', 'highway', 'court', 'crt', 'ct',
  'cl', 'close', 'gr', 'grove', 'pde', 'parade', 'sq', 'square',
  'quay', 'esplanade', 'esp', 'mews', 'row', 'walk', 'rise', 'loop',
  'path', 'track', 'line',
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUFFIX_ALT = STREET_SUFFIXES.map(s => escapeRegex(s)).join('|');

/**
 * Check if a search term matches as a location (not a street name) in content.
 * Uses word boundaries to prevent substring matches (e.g., "Tawa" won't match "Kaitawa").
 * Rejects matches where the term is followed by a street suffix (e.g., "Tawa St").
 */
function termMatchesAsLocation(termLower, contentLower) {
  const termPattern = escapeRegex(termLower).replace(/\s+/g, '\\s+');
  // Must appear as a whole word (word boundaries)
  const wordRegex = new RegExp('\\b' + termPattern + '\\b', 'i');
  if (!wordRegex.test(contentLower)) return false;
  // Must NOT be followed by a street suffix
  const streetRegex = new RegExp('\\b' + termPattern + '\\s+(?:' + SUFFIX_ALT + ')\\b', 'i');
  if (streetRegex.test(contentLower)) return false;
  return true;
}

/**
 * Check if message content matches a region.
 * First checks excludes (compound word false positives like "Mount Wellington"),
 * then checks if any term matches as a location using word boundaries + street suffix detection.
 */
function contentMatchesRegion(content, region) {
  const contentLower = (content || '').toLowerCase();
  // Check excludes first (compound word cases like "Mount Wellington", "Palmerston North")
  if (region.excludes && region.excludes.length > 0) {
    for (const exc of region.excludes) {
      if (contentLower.includes(exc.toLowerCase())) return false;
    }
  }
  // Check if any term matches as a location (not a street name)
  return region.terms.some(term => termMatchesAsLocation(term.toLowerCase(), contentLower));
}

const NZ_REGIONS = [
  {
    name: 'Northland',
    terms: [
      'Whangarei', 'Kaitaia', 'Kerikeri', 'Kaikohe', 'Dargaville', 'Paihia',
      'Mangawhai', 'Maungaturoto', 'Ruakaka', 'Hikurangi', 'Kawakawa',
      'Moerewa', 'Opononi', 'Rawene', 'Ahipara', 'Mangonui', 'Kaiwaka',
      'Waipu', 'Ngunguru', 'Tutukaka', 'Kaeo', 'Taipa', 'Russell',
      'Coopers Beach', 'Kamo', 'Tikipunga', 'Onerahi', 'Whangarei Heads',
      'Maungatapere', 'Waipapa', 'Houhora',
      'Far North District', 'Whangarei District', 'Kaipara District',
    ],
  },
  {
    name: 'Auckland',
    terms: [
      'Auckland', 'Manukau', 'North Shore', 'Waitakere', 'Henderson',
      'New Lynn', 'Mt Albert', 'Mt Roskill', 'Mt Eden', 'Ponsonby',
      'Parnell', 'Remuera', 'Newmarket', 'Onehunga', 'Mangere', 'Otara',
      'Papatoetoe', 'Botany', 'Howick', 'Pakuranga', 'Flat Bush',
      'Manurewa', 'Papakura', 'Pukekohe', 'Waiuku', 'Helensville',
      'Orewa', 'Whangaparaoa', 'Albany', 'Takapuna', 'Devonport',
      'Kumeu', 'Silverdale', 'Warkworth', 'Te Atatu', 'Avondale',
      'Sandringham', 'Grey Lynn', 'Epsom', 'Ellerslie', 'Panmure',
      'Glen Innes', 'St Heliers', 'Mission Bay', 'Orakei', 'Greenlane',
      'Hillsborough', 'Titirangi', 'Glen Eden', 'Massey', 'Hobsonville',
      'Westgate', 'Swanson', 'Browns Bay', 'Glenfield', 'Birkenhead',
      'Northcote', 'Milford', 'Long Bay', 'Torbay', 'Beachlands',
      'Drury', 'Karaka', 'Blockhouse Bay', 'Royal Oak', 'Penrose',
      'Mt Wellington', 'Sylvia Park', 'Otahuhu', 'Paparangi',
      'Lynfield', 'Mt Roskill', 'Meadowbank', 'Kohimarama',
      'Ranui', 'Te Atatu Peninsula', 'Kelston', 'Glendene',
      'Clendon', 'Takanini', 'Paerata', 'Bombay', 'Clarks Beach',
      'Auckland City', 'Franklin',
    ],
  },
  {
    name: 'Waikato',
    terms: [
      'Hamilton', 'Cambridge', 'Te Awamutu', 'Matamata', 'Morrinsville',
      'Huntly', 'Ngaruawahia', 'Raglan', 'Te Kuiti', 'Otorohanga',
      'Tokoroa', 'Putaruru', 'Thames', 'Paeroa', 'Waihi',
      'Whangamata', 'Tairua', 'Whitianga', 'Coromandel', 'Taupo',
      'Turangi', 'Mangakino', 'Te Kauwhata', 'Pokeno', 'Tuakau',
      'Meremere', 'Te Aroha', 'Tirau', 'Piopio', 'Waitomo',
      'Waikino', 'Katikati', 'Claudelands', 'Hillcrest', 'Rototuna',
      'Flagstaff', 'Dinsdale', 'Nawton', 'Frankton', 'Chartwell',
      'Hamilton East', 'Hamilton Central', 'Melville', 'Glenview',
      'Hamilton City', 'Waikato District', 'Waipa District',
      'Matamata-Piako District', 'Hauraki District', 'South Waikato District',
      'Thames-Coromandel District', 'Otorohanga District', 'Waitomo District',
      'Taupo District',
    ],
    // Cambridge Tce/Terrace is handled by street suffix detection automatically
    // But keep compound excludes that street suffix detection can't handle
    excludes: [],
  },
  {
    name: 'Bay of Plenty',
    terms: [
      'Tauranga', 'Mount Maunganui', 'Papamoa', 'Rotorua', 'Whakatane',
      'Opotiki', 'Te Puke', 'Katikati', 'Kawerau', 'Murupara',
      'Edgecumbe', 'Maketu', 'Omokoroa', 'Bethlehem', 'Greerton',
      'Pyes Pa', 'Welcome Bay', 'Ohope', 'Waihi Beach', 'Matata',
      'Te Teko', 'Taneatua', 'Ngongotaha', 'Mourea', 'Okere Falls',
      'Otumoetai', 'Brookfield', 'Gate Pa', 'Hairini',
      'Tauranga City', 'Western Bay of Plenty District',
      'Rotorua District', 'Whakatane District', 'Kawerau District',
      'Opotiki District',
    ],
  },
  {
    name: 'Gisborne',
    terms: [
      'Gisborne', 'Tolaga Bay', 'Tokomaru Bay', 'Ruatoria',
      'Te Puia Springs', 'Matawai', 'Te Karaka', 'Manutuke',
      'Patutahi', 'Muriwai', 'Wainui', 'Makaraka', 'Ormond',
      'Whatatutu', 'Tikitiki', 'Waipiro Bay', 'Uawa',
      'Kaiti', 'Tamarau', 'Mangapapa', 'Elgin', 'Riverdale',
      'Gisborne District', 'East Coast', 'East Cape',
    ],
    // Street suffix detection handles "Gisborne St" etc. automatically
    excludes: [],
  },
  {
    name: "Hawke's Bay",
    terms: [
      'Napier', 'Hastings', 'Havelock North', 'Waipukurau', 'Waipawa',
      'Wairoa', 'Taradale', 'Clive', 'Haumoana', 'Otane', 'Flaxmere',
      'Ahuriri', 'Bay View', 'Eskdale', 'Marewa', 'Onekawa',
      'Maraenui', 'Tamatea', 'Pirimai', 'Greenmeadows', 'Awatoto',
      'Pakipaki', 'Bridge Pa', 'Omahu', 'Tikokino', 'Porangahau',
      'Napier City', 'Hastings District', 'Central Hawke\'s Bay District',
      'Wairoa District',
    ],
    // Street suffix detection handles "Napier St", "Hastings Rd" etc. automatically
    excludes: [],
  },
  {
    name: 'Taranaki',
    terms: [
      'New Plymouth', 'Stratford', 'Hawera', 'Inglewood', 'Waitara',
      'Oakura', 'Opunake', 'Eltham', 'Patea', 'Kaponga', 'Manaia',
      'Normanby', 'Urenui', 'Bell Block', 'Fitzroy', 'Merrilands',
      'Spotswood', 'Vogeltown', 'Blagdon', 'Westown', 'Brooklands',
      'Lepperton', 'Egmont Village', 'Rahotu', 'Okato', 'Mokau',
      'Midhurst', 'Waverley', 'Ohawe', 'Kakaramea',
      'Moturoa', 'Marfell', 'Lynmouth', 'Strandon', 'Welbourn',
      'New Plymouth District', 'South Taranaki District', 'Stratford District',
      'Taranaki',
    ],
    // Street suffix detection handles "Taranaki St", "Stratford Rd" etc. automatically
    excludes: [],
  },
  {
    name: 'Manawatu-Whanganui',
    terms: [
      'Palmerston North', 'Whanganui', 'Feilding', 'Levin', 'Marton',
      'Bulls', 'Taihape', 'Ohakune', 'Waiouru', 'Dannevirke',
      'Woodville', 'Ashhurst', 'Foxton', 'Shannon', 'Sanson',
      'Rongotea', 'Raetihi', 'National Park', 'Pahiatua', 'Eketahuna',
      'Mangaweka', 'Hunterville', 'Foxton Beach', 'Himatangi',
      'Kelvin Grove', 'Roslyn', 'Terrace End', 'Hokowhitu', 'Awapuni',
      'Takaro', 'Milson', 'Cloverlea', 'Highbury', 'Linton',
      'Palmerston North City', 'Manawatu District', 'Whanganui District',
      'Rangitikei District', 'Ruapehu District', 'Horowhenua District',
      'Tararua District',
    ],
  },
  {
    name: 'Wellington',
    terms: [
      'Wellington', 'Lower Hutt', 'Upper Hutt', 'Porirua', 'Paraparaumu',
      'Waikanae', 'Petone', 'Eastbourne', 'Johnsonville', 'Karori',
      'Miramar', 'Kilbirnie', 'Newtown', 'Island Bay', 'Brooklyn',
      'Wadestown', 'Thorndon', 'Te Aro', 'Masterton', 'Carterton',
      'Greytown', 'Martinborough', 'Featherston', 'Otaki', 'Paekakariki',
      'Raumati', 'Plimmerton', 'Titahi Bay', 'Tawa', 'Churton Park',
      'Khandallah', 'Ngaio', 'Kelburn', 'Hataitai', 'Lyall Bay',
      'Seatoun', 'Stokes Valley', 'Wainuiomata', 'Naenae', 'Taita',
      'Avalon', 'Epuni', 'Waterloo', 'Moera', 'Gracefield',
      'Silverstream', 'Heretaunga', 'Totara Park', 'Trentham',
      'Wellington City', 'Hutt City', 'Lower Hutt City',
      'Upper Hutt City', 'Porirua City', 'Kapiti Coast District',
      'Masterton District', 'Carterton District', 'South Wairarapa District',
    ],
    // Mount Wellington / Mt Wellington is Auckland suburb (compound word, not caught by suffix detection)
    // Street suffix detection handles "Wellington St", "Tawa St", "Featherston St", "Heretaunga St" etc.
    excludes: [
      'Mount Wellington', 'Mt Wellington',
    ],
  },
  {
    name: 'Tasman',
    terms: [
      'Richmond', 'Motueka', 'Takaka', 'Murchison', 'Mapua',
      'Brightwater', 'Wakefield', 'Collingwood', 'Kaiteriteri',
      'Tapawera', 'Upper Moutere', 'Lower Moutere', 'Riwaka',
      'Golden Bay', 'Abel Tasman', 'St Arnaud', 'Pohara',
      'Tasman District',
    ],
    // Street suffix detection handles "Richmond Rd" etc. automatically
    excludes: [],
  },
  {
    name: 'Nelson',
    terms: [
      'Nelson', 'Stoke', 'Tahunanui', 'Atawhai', 'The Wood',
      'The Brook', 'Enner Glynn', 'Bishopdale', 'Maitai',
      'Washington Valley', 'Port Nelson', 'Monaco', 'Annesbrook',
      'Nayland', 'Saxton',
      'Nelson City',
    ],
    // Street suffix detection handles "Nelson St", "Nelson Rd" etc. automatically
    excludes: [],
  },
  {
    name: 'Marlborough',
    terms: [
      'Blenheim', 'Picton', 'Havelock', 'Seddon', 'Ward',
      'Renwick', 'Spring Creek', 'Wairau Valley', 'Rarangi',
      'Riverlands', 'Woodbourne', 'Grovetown',
      'Marlborough District',
    ],
    // Havelock North is in Hawke's Bay (compound word, not caught by suffix detection)
    excludes: [
      'Havelock North',
    ],
  },
  {
    name: 'West Coast',
    terms: [
      'Greymouth', 'Hokitika', 'Westport', 'Reefton', 'Ross',
      'Runanga', 'Blaketown', 'Cobden', 'Kumara', 'Blackball',
      'Punakaiki', 'Karamea', 'Haast', 'Franz Josef', 'Fox Glacier',
      'Dobson', 'Moana', 'Granity', 'Ngahere', 'Ahaura',
      'Grey District', 'Buller District', 'Westland District',
    ],
  },
  {
    name: 'Canterbury',
    terms: [
      'Christchurch', 'Timaru', 'Ashburton', 'Rangiora', 'Kaiapoi',
      'Rolleston', 'Lincoln', 'Darfield', 'Oxford', 'Geraldine',
      'Temuka', 'Pleasant Point', 'Waimate', 'Lyttelton', 'Sumner',
      'New Brighton', 'Riccarton', 'Hornby', 'Papanui', 'Merivale',
      'Fendalton', 'Ilam', 'Burnside', 'Akaroa', 'Hanmer Springs',
      'Amberley', 'Cheviot', 'Kaikoura', 'Methven', 'Rakaia',
      'Woodend', 'Pegasus', 'Prebbleton', 'Halswell', 'Spreydon',
      'Addington', 'Woolston', 'Shirley', 'Belfast', 'Redwood',
      'Harewood', 'Avonhead', 'Sockburn', 'St Albans', 'Cashmere',
      'Heathcote', 'Opawa', 'Sydenham', 'Waltham', 'Ferrymead',
      'Christchurch City', 'Selwyn District', 'Waimakariri District',
      'Hurunui District', 'Ashburton District', 'Timaru District',
      'Mackenzie District', 'Waimate District', 'Kaikoura District',
    ],
  },
  {
    name: 'Otago',
    terms: [
      'Dunedin', 'Queenstown', 'Wanaka', 'Oamaru', 'Alexandra',
      'Cromwell', 'Balclutha', 'Milton', 'Lawrence', 'Roxburgh',
      'Arrowtown', 'Clyde', 'Mosgiel', 'Port Chalmers', 'Palmerston',
      'Ranfurly', 'Naseby', 'St Kilda', 'South Dunedin', 'Caversham',
      'Roslyn', 'Mornington', 'Green Island', 'Outram', 'Frankton',
      'Lake Hayes', 'Hawea', 'Kingston', 'Middlemarch', 'Waitati',
      'Abbotsford', 'Kaikorai', 'Maori Hill',
      'Dunedin City', 'Queenstown-Lakes District', 'Central Otago District',
      'Clutha District', 'Waitaki District',
    ],
    // Palmerston North is in Manawatu (compound word, not caught by suffix detection)
    excludes: [
      'Palmerston North',
    ],
  },
  {
    name: 'Southland',
    terms: [
      'Invercargill', 'Gore', 'Te Anau', 'Winton', 'Riverton',
      'Bluff', 'Lumsden', 'Mataura', 'Edendale', 'Otautau',
      'Tuatapere', 'Wyndham', 'Stewart Island', 'Nightcaps',
      'Wallacetown', 'Otatara', 'Kennington', 'Makarewa',
      'Tokanui', 'Dipton', 'Balfour', 'Mossburn',
      'Invercargill City', 'Southland District', 'Gore District',
    ],
    // Street suffix detection handles "Gore St" etc. automatically
    excludes: [],
  },
];

module.exports = { NZ_REGIONS, STREET_SUFFIXES, contentMatchesRegion };
