-- One-time migration: copies the 5 existing blog pages' real text into the new
-- campaign_content table, so nothing changes visually until Ash edits something
-- through the admin. Banners are left NULL on purpose (the blog pages fall back
-- to their original static image until she uploads a new one for that campaign).

INSERT INTO campaign_content (slug, title, eyebrow, hook, intro, world, stakes, audience, banner_id, banner_data, published, created_at, updated_at) VALUES
('flying-city', 'The Prophecy of the Flying City', 'Political Intrigue · Buried City',
'The grand city was supposed to soar into the heavens. Instead, it''s buried beneath your feet, and its political factions are still fighting over the wreckage.',
'A hundred years ago, the greatest minds of an empire poured every ounce of their arcane genius into a single, impossible dream: a city that would leave the earth behind and rise into the sky forever. They called the ritual the Uplift.

It failed.

Instead of ascending, the city fell inward and downward, sealed beneath layers of stone and collapsed ambition. There was no second sunrise, only the dark, the dust, and the silence of a dream that suffocated everyone inside it.

You weren''t born into glory. You were born into what''s left of it.',
'Generations later, the buried city still stands: a labyrinth of collapsed spires, flooded plazas, and forgotten districts held together by stubbornness and magic older than anyone currently in charge. Sunlight is a rumor. Political power is not.

With no sky to answer to, the city''s great houses, guilds, and cults have turned on each other, each one convinced they alone hold the key to finishing what the Uplift started, or to making sure no one else ever tries again.',
'Somewhere in the buried archives, someone is quietly reassembling the ritual that doomed this city the first time. Whether that''s a promise or a threat depends entirely on who gets there first, and what they''re willing to risk to be the one holding the prophecy when it comes true again.

Every faction has a plan. Every plan needs people willing to get involved. That''s where your party comes in.',
'This is a campaign built for players who love clever talk as much as clever tactics, though you''ll get chances for both. Expect layered NPCs, shifting alliances, and a world that actually remembers your choices. Every idea your party brings to the table gets taken seriously, prep goes into every session, and the rule of cool always has a seat here too. If you like mysteries with teeth and factions with agendas, this is your city.

The city is waiting for someone to finally shape its future. Will your party be the ones who do?',
NULL, NULL, 1, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),

('curse-of-strahd', 'Curse of Strahd', 'Gothic Horror · Barovia',
'The mists have carried you into Barovia, a land of gothic tragedy watched over by Count Strahd von Zarovich himself.',
'Your journey was supposed to end somewhere else. Then the fog rolled in, thick and strange, and swallowed the road behind you. When it finally thinned, you were somewhere it hadn''t touched in a hundred years: the land of Barovia.

In Barovia, nothing arrives by accident. The land itself seems to choose its guests, and its master has been alone in that castle for a very long time.',
'Barovia is a demiplane of dread sealed off from the rest of existence by a wall of living mist. Its villages are grim, its people superstitious for good reason, and its castle looms over everything from a mountain that never lets you forget it''s watching. Wolves don''t quite behave like wolves here, and neither does the weather.',
'Count Strahd von Zarovich hasn''t forgotten he was once a man. He remembers everything, and that history is part of what makes him such a rich villain to play against: patient, theatrical, and endlessly curious about whoever wanders into his domain.

A deck of fortune-telling cards, read by the wandering Vistani, charts your path through his domain and toward the one confrontation that matters.',
'This is D&D''s definitive gothic horror campaign, and I run it with care. Every character concept is welcome here, the rule of cool always beats rules-as-written, and I prep thoroughly every week so the story keeps moving no matter what your party decides to do. This is a table for creativity and collaboration first, dread and atmosphere second.

If you love candlelit tension, doomed romance, folk superstition, and a DM who takes your ideas seriously, welcome to Barovia.

Pack a torch, distrust the fog, and get ready to meet Barovia''s watchful master.',
NULL, NULL, 1, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),

('ravenloft-undead-survival', 'Ravenloft: Undead Survival', 'Survival Horror · Domains of Dread',
'The dead don''t rest in the Domains of Dread. Out here, they don''t even stay down.',
'Somewhere past the borders of the world you know, the Mists have claimed another village, and this one is drowning in its own graveyard. The dead have stopped staying buried, supplies are running low, and the unspoken rules are simple: don''t get bitten, don''t get caught outside after dark, and don''t trust anyone who''s been gone too long.

Nobody asks to end up here. The Mists don''t send invitations, they send outcomes.',
'Every barricade you build buys a little time. Every supply run costs something. The horde outside isn''t the kind you fight in one big battle, it''s the kind your party survives together, day by day, leaning on each other to keep the walls (and the food) holding out.',
'Somewhere behind the horde''s endless hunger is the will of a Darklord, one of the countless rulers cursed to preside over their own personal nightmare forever. Understanding that curse, or breaking it, is the real path through this story, and your choices are what shape how that story goes.',
'This is gritty, resource-scarce survival horror, and it''s built for teamwork. Every bullet, bandage, and barricade matters more when you''re solving it together. The rule of cool still applies here, so a clever plan deserves to work, and I prep every session so the pressure always feels earned, never arbitrary or unfair. If Curse of Strahd is a slow gothic tragedy, this is its faster, more collaborative cousin.

Ration your supplies, watch each other''s backs, and take the horde one barricade at a time.',
NULL, NULL, 1, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),

('crooked-moon', 'The Crooked Moon', 'Folk Horror · Druskenvald',
'You bought a one-way ticket to the afterlife. Somehow, you''re not there yet, and that might be the strangest news you get all night.',
'The Ghostlight Express was supposed to carry you somewhere final. Instead, it derailed into somewhere in between: a land called Druskenvald, thirteen provinces deep in shadow, lit only by a crescent moon that hangs a little too low and grins a little too wide.

Nobody here remembers a time before the Crooked Moon watched over them. Nobody here is in a hurry to talk about what happens when it''s full.',
'Druskenvald runs on old rules: don''t take gifts from strangers in the woods, don''t answer if something calls your name twice, and never, ever ask what happened to the last village over the hill. Its provinces are stitched together by superstition, half-remembered rites, and a growing sense that something ancient is stirring back to life, because it never actually finished dying.',
'Long ago, something called the Crooked Queen was bound and buried by people who understood exactly how dangerous she was. Now factions all over Druskenvald, some desperate, some devout, some simply greedy, are racing to be the ones who dig her back up. Whether your party is trying to stop that or just trying to get through it in one piece, your choices become part of Druskenvald''s story either way.',
'This one starts as folk horror, with eerie villages, half-true legends, and things that watch from the treeline, and it doesn''t stay there. The tone deepens as the campaign goes, shaped by whatever your table decides to do. I keep things collaborative throughout: your character ideas matter, the rule of cool wins arguments, and I prep thoroughly so the mystery always holds together. If you like your horror atmospheric, your legends unreliable, and your table welcoming no matter your experience level, Druskenvald is for you.

The moon is already crooked. Come find out what that means.',
NULL, NULL, 1, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),

('witchlight', 'The Wild Beyond the Witchlight', 'Whimsical Fey Tale · Feywild',
'The carnival only comes around once every eight years. It''s always more than happy to let you in. Getting back out is a different kind of ticket.',
'The lights are too colorful, the music is a little too catchy, and every game booth is running a con you can''t quite prove, but the Witchlight Carnival has rolled into town, and it''s the most wonderful, most curious thing you''ve ever wanted to walk into.

Step past the gates and the ordinary rules stop applying. Wishes are real here. So is the price for making one.',
'Beyond the carnival''s mirrored tents lies Prismeer, a hidden, sun-drenched realm of the Feywild built entirely around a single wish, made a very long time ago by someone who never should have had that kind of power. It should be paradise. Something has been quietly rotting it from the inside for years, and the deeper you go, the more the fairy tale starts to feel like a trap dressed up in ribbons.',
'The carnival''s real owners aren''t who they claim to be, and every attraction hides a piece of a much larger game, one being played over the fate of an entire hidden realm and everyone inside its borders, including, possibly, your party. Curiosity is the price of admission, and there''s always more going on here than the glitter lets on.',
'This campaign is built for roleplay-first tables: puzzles over pure combat, clever solutions over brute force, and a tone that swings between delightfully weird and quietly unsettling without ever losing its sense of wonder. Every weird idea your party brings is fair game here, rule of cool included, and I prep every session so the puzzles and payoffs actually land. If you want a game that''s whimsical, funny, welcoming to any experience level, and occasionally has real heart underneath the glitter, the carnival''s calling your name.

Step right up. The carnival doesn''t wait, and it definitely doesn''t refund tickets.',
NULL, NULL, 1, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z');
