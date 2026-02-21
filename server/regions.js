// New Zealand regions with search terms (towns, suburbs, districts) for location filtering.
// Terms are matched case-insensitively against message content.
// Excludes prevent false positives from suburb/street names that contain another region's name.

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
    // Cambridge Tce/Terrace is a Wellington CBD street, not Waikato
    // Hamilton Rd/St are street names in other cities
    excludes: [
      'Cambridge Tce', 'Cambridge Terrace',
      'Hamilton St', 'Hamilton Street', 'Hamilton Rd', 'Hamilton Road',
    ],
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
    // Gisborne St is a street name in some cities
    excludes: [
      'Gisborne St', 'Gisborne Street',
    ],
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
    // Napier St/Rd and Hastings St/Rd are common street names elsewhere
    excludes: [
      'Napier St', 'Napier Street', 'Napier Rd', 'Napier Road',
      'Hastings St', 'Hastings Street', 'Hastings Rd', 'Hastings Road',
    ],
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
    // Taranaki St/Street is a major Wellington CBD street
    // Stratford Rd is a street name in some cities
    excludes: [
      'Taranaki St', 'Taranaki Street', 'Taranaki Rd', 'Taranaki Road',
      'Stratford Rd', 'Stratford Road',
    ],
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
    // Mount Wellington / Mt Wellington is an Auckland suburb
    // Wellington St/Rd are street names in other cities
    excludes: [
      'Mount Wellington', 'Mt Wellington',
      'Wellington St', 'Wellington Street', 'Wellington Rd', 'Wellington Road',
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
    // Richmond Rd/St is a street name in Auckland and other cities
    excludes: [
      'Richmond Rd', 'Richmond Road', 'Richmond St', 'Richmond Street',
    ],
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
    // Nelson St/Street is a very common street name (Auckland CBD, Hamilton, etc.)
    excludes: [
      'Nelson St', 'Nelson Street', 'Nelson Rd', 'Nelson Road',
      'Nelson Ave', 'Nelson Avenue', 'Nelson Cres', 'Nelson Crescent',
    ],
  },
  {
    name: 'Marlborough',
    terms: [
      'Blenheim', 'Picton', 'Havelock', 'Seddon', 'Ward',
      'Renwick', 'Spring Creek', 'Wairau Valley', 'Rarangi',
      'Riverlands', 'Woodbourne', 'Grovetown',
      'Marlborough District',
    ],
    // Havelock North is in Hawke's Bay, not Marlborough's Havelock
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
    // Palmerston North is in Manawatu, not Otago's Palmerston
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
    // Gore St is a street name in some cities
    excludes: [
      'Gore St', 'Gore Street',
    ],
  },
];

module.exports = NZ_REGIONS;
