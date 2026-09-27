// The list of games a player can say they want to play. Ash's own tables come
// first, then the official D&D 5e adventures, grouped so the list is easy to scan.
// Players can also type in anything that is not here ("something else").
var GAME_MODULES = [
  {
    group: 'Ash runs these',
    items: [
      'The Crooked Moon',
      'Curse of Strahd',
      'The Wild Beyond the Witchlight',
      'Ravenloft: Undead Survival',
      'The Prophecy of the Flying City',
    ],
  },
  {
    group: 'Full campaigns',
    items: [
      'Lost Mine of Phandelver',
      'Dragons of Stormwreck Isle',
      'Dragon of Icespire Peak',
      'Hoard of the Dragon Queen',
      'The Rise of Tiamat',
      'Princes of the Apocalypse',
      'Out of the Abyss',
      'Storm King\'s Thunder',
      'Tomb of Annihilation',
      'Waterdeep: Dragon Heist',
      'Waterdeep: Dungeon of the Mad Mage',
      'Baldur\'s Gate: Descent into Avernus',
      'Icewind Dale: Rime of the Frostmaiden',
      'Strixhaven: A Curriculum of Chaos',
      'Call of the Netherdeep',
      'Dragonlance: Shadow of the Dragon Queen',
      'Phandelver and Below: The Shattered Obelisk',
      'Vecna: Eve of Ruin',
    ],
  },
  {
    group: 'Short adventures and collections',
    items: [
      'Tales from the Yawning Portal',
      'Ghosts of Saltmarsh',
      'Candlekeep Mysteries',
      'Keys from the Golden Vault',
      'Journeys Through the Radiant Citadel',
      'Quests from the Infinite Staircase',
      'Planescape: Adventures in the Multiverse',
      'Spelljammer: Adventures in Space',
      'The Lost Laboratory of Kwalish',
    ],
  },
  {
    group: 'Settings to explore',
    items: [
      'Eberron: Rising from the Last War',
      'Explorer\'s Guide to Wildemount',
      'Mythic Odysseys of Theros',
      'Van Richten\'s Guide to Ravenloft',
      'Tal\'Dorei Campaign Setting Reborn',
    ],
  },
  {
    group: 'Something different',
    items: [
      'A one-shot (any story)',
      'A homebrew campaign',
      'Not sure yet, surprise me',
    ],
  },
];
