// The Game Master Agreement. This one file is the single source of the text: the signing page shows
// it, and the server uses the very same text for the signed copy (PDF and email) and for the record
// it keeps. Change the wording here (and raise VERSION) and everything stays in step.
//
// Plain language on purpose. It is not legal advice; have a lawyer look it over before relying on it.

export const AGREEMENT = {
  version: '2026-10',
  title: 'Game Master Agreement',
  platform: 'Ash Tabletop',
  termMonths: 12,
  intro:
    'This agreement is between Ash Tabletop ("Ash Tabletop", "we", "us") and the person who signs it ("you", "the GM"). ' +
    'By signing it electronically you agree to everything below. It is written in plain language on purpose. ' +
    'Please read all of it, and ask us any question before you sign.',
  sections: [
    {
      title: 'What this agreement is for',
      body: [
        'You want to run paid tabletop role-playing games (TTRPGs) for players through Ash Tabletop. We provide the website, your GM profile, the schedule and sign-up for your games, in-site messages, and the handling of payments through our payment provider, Whop.',
        'You run the games. You are an independent GM. You are not our employee, partner or agent. We do not promise you any number of players or any amount of income.',
        'You must be 18 or older, and you must be allowed to enter into this agreement.',
      ],
    },
    {
      title: 'How long it lasts, and how to renew',
      body: [
        'This agreement starts on the day you sign it and lasts for one year (12 months). The exact expiry date is written on your signed copy.',
        'We will email you a reminder about 30 days before it expires. To renew, sign again using the same link. A renewed agreement lasts one more year from the day you sign it again.',
        'If it expires and you have not renewed, your listings can be paused and you cannot take new players. Anything you already owe under this agreement stays owed, and sessions players have already paid for must still be run or refunded.',
        'Either of us can end this agreement earlier by giving the other 14 days notice in writing (a message or an email is enough). We can pause or remove you right away for the reasons in section 11. When it ends, you must run or refund any session a player has already paid for.',
      ],
    },
    {
      title: 'Fees and getting paid',
      body: [
        'Players pay for each session when it starts. Every payment goes through Whop.',
        'The only fee Ash Tabletop charges is 5% of what players pay for your sessions.',
        'Whop, our payment provider, charges its own fees on payments. Those fees belong to Whop, not to us. You pay them, and Ash Tabletop is not responsible for them or for any change in them.',
        'Your earnings for a session are what the players paid, minus Whop\'s fees, minus our 5%.',
        'We pay your earnings out after a 24-hour hold following each session, so we can sort out any problem first. Your very first payout may be held for up to 72 hours. We send payouts by the payout method we agree with you, and we may group them together. You must give us correct payout details.',
        'You are responsible for following the laws and rules that apply to you where you live and work, including taxes, licenses and permits. We do not give tax or legal advice, we do not take taxes out of your payouts, and we are not responsible for your government\'s laws or your taxes. If the law requires us to share information about you or your earnings with an authority, we may do so.',
      ],
    },
    {
      title: 'Refunds',
      body: [
        'A player is refunded when a session did not happen as promised. For example: you did not show up, you cancelled late, you started much later than the time shown, or the session could not run because of you. We may also refund a player who tells us there is a problem with a charge, when it looks fair to us. We decide in good faith.',
        'Every refund comes out of your earnings for that session, and that includes any payment fee that Whop keeps. If you have already been paid, you agree to pay it back. We may subtract it from your later earnings. If there are none, you agree to pay it within 14 days of our request.',
        'We do not refund a player just because they did not enjoy a session that was run properly.',
      ],
    },
    {
      title: 'Bank disputes and chargebacks',
      body: [
        'If a player disputes a charge with their bank (a "chargeback"), you are responsible for the amount and for any fees charged for the dispute. We may subtract them from your earnings, in the same way as refunds.',
        'We will help by collecting evidence from the site\'s records, such as the schedule, the notices sent to players, and attendance. If you have a lot of disputes or refunds, we may hold your payouts for longer.',
      ],
    },
    {
      title: 'You are responsible for your games',
      body: [
        'You are responsible for the games you run: their content, how you treat players, safety at your table, your schedule, your rules, and anything said or done in your games.',
        'Ash Tabletop is a platform that connects GMs with players and handles payments. We do not run, supervise or control your games.',
        'You agree to cover Ash Tabletop for claims, refunds, losses and costs that come from your games, your conduct, or your breaking this agreement, as far as the law allows.',
      ],
    },
    {
      title: 'Starting and running a game',
      body: [
        'Switch your game on at least 24 hours before its first session. This lets us send players the "game is active" notice. Players also get a reminder email 24 hours before they are charged for their first session.',
        'A game needs at least 3 players for a session to be charged. Players can skip a session up to 1 hour before it starts, and they can leave a game at any time.',
        'Start your sessions on time. If you must cancel or move a session, tell your players at least 24 hours ahead through the site. A cancelled session is not charged, or it is refunded.',
      ],
    },
    {
      title: 'How you treat people',
      body: [
        'Run a respectful and safe table. No harassment, hate or discrimination. Use safety tools and keep to the comfort limits your players set. Players must be 18 or older.',
        'Never ask players for their card details. Do not ask players you met through Ash Tabletop to pay you outside the site for games listed here.',
        'Keep players\' personal information private. Use it only to run your game.',
      ],
    },
    {
      title: 'Your profile and your content',
      body: [
        'You own what you create. You let us show your name, picture, banner, bio and game details on the site so players can find you.',
        'Copyrights and trademarks belong to their owners. Dungeons & Dragons and other game names, books, artwork and logos belong to Wizards of the Coast or to the publishers who made them. You are responsible for making sure that everything you use, upload, show or sell through your profile and your games is yours, or that you have the right to use it, including pictures, text, maps, music and game material.',
        'Ash Tabletop is not affiliated with Wizards of the Coast or any other game publisher, and you must not suggest that it is.',
        'If anyone makes a claim about material you used, you deal with it, you remove the material when we ask, and you cover the claim and its costs. This is part of what you cover us for in section 6.',
      ],
    },
    {
      title: 'Messages and safety reports',
      body: [
        'Messages sent through the site are stored on the site. Any person in a conversation can report it. If someone reports a conversation, or there is a complaint or a safety concern, we may read the messages involved.',
      ],
    },
    {
      title: 'Pausing or removing you',
      body: [
        'We may pause or remove you, or one of your games, right away if there are repeated complaints, missed sessions, unsafe behavior, a break of this agreement, unusually many refunds or disputes, or anything that puts players, the site or our Whop account at risk.',
        'While we look into a problem, we may hold your payouts to cover refunds and disputes that may follow.',
      ],
    },
    {
      title: 'No promises',
      body: [
        'We do not promise any number of players, any income, or that the site will always be available. Features can change. Whop\'s own terms apply to the payments it handles.',
      ],
    },
    {
      title: 'Limits to our responsibility',
      body: [
        'As far as the law allows, we are not responsible for your lost income or for indirect damages. Our total responsibility to you under this agreement is limited to the fees we received from your sessions in the last 3 months.',
        'Nothing in this agreement limits anything that the law does not allow to be limited.',
      ],
    },
    {
      title: 'Changes',
      body: [
        'We may update this agreement. We will tell you at least 14 days before a change takes effect. If you do not agree to a change, you can end the agreement under section 2. If you keep running games after the change takes effect, you accept it. A renewal always uses the latest version.',
      ],
    },
    {
      title: 'If we disagree',
      body: [
        'Talk to us first, by message or email, and we will both try in good faith to solve it within 30 days.',
        'This agreement is governed by the law that applies where Ash Tabletop is operated from, except that nothing here takes away rights you have under the law of your own country that cannot be waived.',
      ],
    },
    {
      title: 'Signing, copies and the rest',
      body: [
        'Typing your full name and ticking the box counts as your signature. We keep a record of your name, email, the date and time, and the version of the text you signed.',
        'We email a copy of the signed agreement (as a PDF) to you and keep one ourselves. You can print it. If you lose it, ask us and we will send it again.',
        'Sections on refunds, disputes, your responsibilities, copyright and our limits stay in force after this agreement ends, for anything that happened while it applied.',
        'If Ash Tabletop becomes a company or someone else takes over running it, we may transfer this agreement to them. You may not transfer it to anyone else.',
        'This is the whole agreement between us about running games on Ash Tabletop. If one part turns out not to be valid, the rest still applies.',
      ],
    },
  ],
};

// Plain text of the whole agreement, with the numbering used everywhere (page, PDF, email).
export function agreementParagraphs() {
  const out = [{ kind: 'p', text: AGREEMENT.intro }];
  AGREEMENT.sections.forEach((s, i) => {
    out.push({ kind: 'h', text: (i + 1) + '. ' + s.title });
    s.body.forEach((b) => out.push({ kind: 'p', text: b }));
  });
  return out;
}
