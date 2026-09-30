// Item catalogue: model node, HUD icon, behaviour flags, and the lore notes scattered around the house.
export const ITEMS = {
  battery: { name: 'Battery', model: 'Battery', stack: true, desc: 'Fresh cell for the flashlight. [R] to swap.' },
  medkit: { name: 'Medkit', model: 'Medkit', stack: true, use: true, desc: 'Restores 60 health.' },
  pills: { name: 'Sedatives', model: 'Pills', stack: true, use: true, desc: 'Calms the nerves. +25 health, clears fear.' },
  syringe: { name: 'Adrenaline', model: 'Syringe', stack: true, use: true, desc: 'Unlimited stamina and a burst of speed for 12 seconds.' },
  crucifix: { name: 'Crucifix', model: 'Crucifix', stack: true, desc: 'Breaks a ghost\'s grip once. Used automatically.' },
  crowbar: { name: 'Crowbar', model: 'Crowbar', tool: true, desc: 'Pry boards, smash glass. Loud.' },
  fuse: { name: 'Fuse', model: 'Fuse', objective: true, desc: 'A heavy ceramic fuse. The generator room needs one.' },
  musicbox: { name: 'Music Box', model: 'MusicBox', use: true, desc: 'Wind it and set it down. They cannot resist the song.' },
  key_brass: { name: 'Brass Key', model: 'Key_Brass', key: 'brass', desc: 'Opens the brass padlock on the front gate.' },
  key_iron: { name: 'Iron Key', model: 'Key_Iron', key: 'iron', desc: 'Opens the iron padlock on the front gate.' },
  key_silver: { name: 'Silver Key', model: 'Key_Silver', key: 'silver', desc: 'Opens the silver padlock on the front gate.' },
  note: { name: 'Note', model: 'Note', read: true },
};

export const KEY_IDS = ['brass', 'iron', 'silver'];
export const KEY_COLORS = { brass: '#c9a24a', iron: '#8c8f94', silver: '#e2e6ea' };

const svg = (body, vb = '0 0 32 32') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const ICONS = {
  battery: svg('<rect x="9" y="7" width="14" height="20" rx="2"/><rect x="13" y="4" width="6" height="3"/><path d="M16 12v6M13 15h6"/>'),
  medkit: svg('<rect x="4" y="9" width="24" height="17" rx="2"/><path d="M12 9V6h8v3M16 13v9M11.5 17.5h9"/>'),
  pills: svg('<rect x="10" y="9" width="12" height="18" rx="2"/><rect x="9" y="5" width="14" height="4" rx="1"/><path d="M13 15h6M13 19h4"/>'),
  syringe: svg('<path d="M22 4l6 6M25 7l-14 14-4-4L21 3M7 21l-3 3 4 4 3-3M14 14l2 2M17 11l2 2"/>'),
  crucifix: svg('<path d="M16 3v26M9 10h14"/>'),
  crowbar: svg('<path d="M24 4c3 0 4 3 2 5L8 28M8 28l-3-2M24 4l-2 3"/>'),
  fuse: svg('<rect x="9" y="11" width="14" height="10" rx="2"/><path d="M4 16h5M23 16h5M13 11v10M19 11v10"/>'),
  musicbox: svg('<rect x="5" y="14" width="22" height="13" rx="1"/><path d="M5 14l4-7h14l4 7M16 7V3M26 20h3"/>'),
  key: svg('<circle cx="10" cy="16" r="5"/><path d="M15 16h13M24 16v4M20 16v3"/>'),
  note: svg('<path d="M8 4h12l5 5v19H8z"/><path d="M20 4v5h5M11 14h11M11 18h11M11 22h8"/>'),
};

export const NOTES = [
  { title: 'Housekeeper\'s ledger', body: 'The master had the front gate fitted with three locks — brass, iron and silver.\nHe kept each key somewhere different "so no single thief could take the house".\nI think he meant so no single one of US could leave.' },
  { title: 'Torn page', body: 'Lady Blackwood locked herself in her bath the night of the wedding and never came out.\nThe door is still bolted from the inside.\nThe children used to crawl through the old air vent from the sewing room to fetch her things.' },
  { title: 'Note to the groundskeeper', body: 'The generator eats fuses. Keep spares somewhere dry — not in the generator room, the damp gets into everything.\nIf the lights go, the breaker lever is on the fuse box. Pull it back up.' },
  { title: 'Curator\'s card', body: 'Item 14 — silver key, maker unknown. Displayed under glass in The Collection.\nThe cases are sealed. Anyone breaking one will be heard throughout the house.' },
  { title: 'Child\'s drawing', body: '[a crayon drawing of a tall woman in a veil, a little girl holding a bear, and a huge man with a sack on his head]\n\n"MY NEW FAMILY. THEY SAY I CAN STAY FOREVER."' },
  { title: 'Diary, last entry', body: 'She only moves when you aren\'t looking properly. Keep the torch on her face and she hesitates.\nThe little one hears everything. Walk. Don\'t run.\nAnd the big one — you hear the chain first. Hide and hold your breath.' },
  { title: 'Scrawled on a napkin', body: 'The wardrobes are the only safe place. Close the doors. Don\'t breathe.\nIf she saw you go in, it\'s already too late.' },
  { title: 'Butler\'s memo', body: 'Wind the music box and the children come running. Useful when you need them elsewhere.\nDo NOT wind it near yourself.' },
  { title: 'Water-stained letter', body: 'My dearest — if you are reading this, do not go upstairs after the lights go out.\nThe keys will not help you if you are not alive to turn them.' },
];

export const LOADING_TIPS = [
  'Sprinting is loud. The Hollow Child hears footsteps through walls.',
  'Shine your flashlight on The Widow\'s face to make her hesitate.',
  'You hear The Warden\'s chain long before you see him.',
  'Hold [Space] inside a wardrobe to hold your breath.',
  'Wind the music box and leave it behind you. They cannot resist it.',
  'Crouch [C] to squeeze through broken vents.',
  'Sliding [C while sprinting] gives a short burst of speed — and costs stamina.',
  'When the power dies, the fuse glows for anyone brave enough to look.',
  'Breaking glass will be heard across the whole house.',
  'A crucifix breaks a ghost\'s grip. Once.',
  'Press [Tab] for the map and your objectives.',
];
