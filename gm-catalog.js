// What a Game Master can pick from when building their profile. Shared by the editor
// (gm-profile.html) and by the profile page that visitors see (gm-render.js), so a choice
// made in one always shows up the same way in the other.
(function () {
  // Tools and game systems, shown as small tags under the name.
  var TOOLS = [
    'D&D 5e', 'Pathfinder 2e', 'Call of Cthulhu', 'Vampire: The Masquerade', 'Other TTRPG systems',
    'Roll20', 'Discord', 'D&D Beyond', 'Foundry VTT', 'Fantasy Grounds', 'Owlbear Rodeo',
    'Tabletop Simulator', 'TaleSpire', 'Zoom', 'Google Meet', 'Syrinscape', 'In person'
  ];

  // "My tables are..." (a GM picks up to four).
  var QUALITIES = [
    { id: 'welcoming', emoji: '🌈', label: 'Welcoming to everyone.' },
    { id: 'rulecool', emoji: '🎲', label: 'Rule of cool take a front seat in cool moments.' },
    { id: 'prepped', emoji: '📖', label: 'Prepped weekly.' },
    { id: 'lowpressure', emoji: '💬', label: 'Low pressure and judgment free, come as you are.' },
    { id: 'beginner', emoji: '🌱', label: 'Beginner friendly.' },
    { id: 'story', emoji: '📜', label: 'Story comes first.' },
    { id: 'roleplay', emoji: '🎭', label: 'Heavy on roleplay.' },
    { id: 'combat', emoji: '⚔️', label: 'Tactical, exciting combat.' },
    { id: 'humor', emoji: '😂', label: 'Humor and happy chaos.' },
    { id: 'dark', emoji: '🕯️', label: 'Dark and gritty.' },
    { id: 'cozy', emoji: '🍵', label: 'Cozy and relaxed.' },
    { id: 'puzzles', emoji: '🧩', label: 'Puzzles and mysteries.' },
    { id: 'sandbox', emoji: '🗺️', label: 'Open world, go where you like.' },
    { id: 'safety', emoji: '🛡️', label: 'Safety tools are always on.' },
    { id: 'lgbtq', emoji: '🏳️‍🌈', label: 'LGBTQ+ friendly.' },
    { id: 'voices', emoji: '🎙️', label: 'Voices, music and mood for every scene.' }
  ];

  // The boxes under the profile card. A GM answers up to three of these.
  // "hint" explains the question to the GM; "note" is the small parenthesis visitors see.
  var QUESTIONS = [
    { id: 'became', title: 'I became a GM because...', hint: 'Your story: what pulled you behind the screen?', note: '', placeholder: 'I got hooked on D&D when...' },
    { id: 'comfort', title: 'How I keep the table comfortable', hint: 'Safety tools like Lines and Veils or the X-Card, Session Zero, and how you handle boundaries.', note: '(safety tools and Session Zero)', placeholder: 'At my table I use...' },
    { id: 'newplayer', title: 'New to D&D?', hint: 'This question is for the visitor, not you. A new player is reading your profile and being asked "are you new to D&D?". Answer them: tell new players how you welcome them.', note: '(a question for you, the player)', placeholder: 'Absolutely welcome! I will help you with...' },
    { id: 'style', title: 'My GM style', hint: 'Rules-light or by the book? Serious or silly? Fast or slow?', note: '', placeholder: 'My games feel like...' },
    { id: 'expect', title: 'What I ask of my players', hint: 'Anything you expect from the table, like respect, showing up, or being ready to roleplay.', note: '(what I expect from you)', placeholder: 'All I ask is...' },
    { id: 'session0', title: 'What happens in Session Zero', hint: 'Your free first meeting. What do you go over with new players?', note: '(the free first meeting)', placeholder: 'In Session Zero we...' },
    { id: 'why', title: 'Why play at my table?', hint: 'What makes your games special?', note: '', placeholder: 'People come back because...' },
    { id: 'prep', title: 'How I prepare my games', hint: 'Your prep routine and what players can count on week to week.', note: '', placeholder: 'Every week I...' }
  ];

  // Where a GM can send visitors. Only the ones filled in are shown.
  var SOCIALS = [
    { id: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourchannel' },
    { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourname' },
    { id: 'x', label: 'X (Twitter)', placeholder: 'https://x.com/yourname' },
    { id: 'bluesky', label: 'Bluesky', placeholder: 'https://bsky.app/profile/yourname' },
    { id: 'patreon', label: 'Patreon', placeholder: 'https://patreon.com/yourname' },
    { id: 'twitch', label: 'Twitch', placeholder: 'https://twitch.tv/yourname' },
    { id: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@yourname' },
    { id: 'website', label: 'Website', placeholder: 'https://yourwebsite.com' }
  ];

  var ICONS = {
    youtube: '<path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.3" fill="currentColor"/>',
    x: '<path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z"/>',
    bluesky: '<path fill="currentColor" d="M12 10.8c-1.09-2.11-4.05-6.05-6.8-8C2.57.94 1.56 1.27.9 1.57.14 1.91 0 3.08 0 3.77c0 .69.38 5.65.62 6.48.82 2.74 3.71 3.66 6.38 3.36.14-.02.28-.04.42-.06-.14.02-.28.04-.42.06-3.91.58-7.39 2-2.83 7.08 5.01 5.19 6.87-1.11 7.83-4.31.95 3.2 2.05 9.27 7.73 4.31 4.27-4.31 1.17-6.5-2.74-7.08a8.7 8.7 0 0 1-.42-.06c.14.02.28.04.42.06 2.67.3 5.57-.63 6.38-3.36.25-.83.62-5.79.62-6.48 0-.69-.14-1.86-.9-2.2-.66-.3-1.67-.62-4.3 1.24C16.05 4.75 13.09 8.69 12 10.8z"/>',
    patreon: '<path fill="currentColor" d="M22.96 7.21c0-3.06-2.39-5.58-5.19-6.48C14.29-.4 9.7-.23 6.38 1.33 2.36 3.23 1.09 7.39 1.05 11.54c-.04 3.41.3 12.4 5.37 12.46 3.77.05 4.33-4.8 6.07-7.14 1.24-1.66 2.84-2.13 4.8-2.62 3.38-.84 5.68-3.5 5.67-7.03z"/>',
    twitch: '<path fill="currentColor" d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43z"/>',
    tiktok: '<path fill="currentColor" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
    website: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.8"/>'
  };

  // What Ash's own profile says until she changes it.
  var ASH_DEFAULT = {
    name: 'Ash',
    pronouns: 'he/they',
    tagline: 'Every story needs a party. Come build one with us.',
    tools: ['D&D 5e', 'Roll20', 'Discord', 'D&D Beyond'],
    bio: "Hello lovely people, I'm Ash! I run D&D 5e games on Roll20, Discord, and D&D Beyond, and I love helping people build stories they'll still be talking about months later. Gothic horror, feywild chaos, political intrigue, undead survival: I've got a table for whatever mood you're in. New to D&D? Totally welcome. Been playing for years? Also welcome. Every game starts with a free Session Zero, so you can meet the table and see if it's a fit before we start our game.",
    qualities: ['welcoming', 'rulecool', 'prepped', 'lowpressure'],
    questions: [
      { id: 'became', answer: "I was obsessed with Dungeons & Dragons. I joined lots of games run by great DMs, and I wanted to share what I learned from my favorite game masters with everyone. Seeing my friends gather at the table, having fun, and seeing the intrigue in their eyes as they uncover the secrets I put in the game made all the prep hours worth it. And that's how I started." },
      { id: 'comfort', answer: 'I use safety tools like Lines and Veils and the X-Card at my table. I also meet every player in a Session Zero before our game, so everyone is comfortable with the themes that may come up during play.' },
      { id: 'newplayer', answer: "Absolutely welcome! I'll help you with everything you need, from making a character (backstory and mechanics) to introducing you to the game and the rest of the players. However comfortable you are with playing, you can go at your own pace." }
    ],
    socials: {},
    discord: 'https://discord.com/users/1137869041495724094',
    avatar: 'medie/ash-token.png',
    banner: ''
  };

  window.GmCatalog = {
    TOOLS: TOOLS, QUALITIES: QUALITIES, QUESTIONS: QUESTIONS, SOCIALS: SOCIALS, ICONS: ICONS, ASH_DEFAULT: ASH_DEFAULT,
    quality: function (id) { return QUALITIES.filter(function (q) { return q.id === id; })[0] || null; },
    question: function (id) { return QUESTIONS.filter(function (q) { return q.id === id; })[0] || null; }
  };
})();
