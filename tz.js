// A time zone name people actually recognize (EST, AEST, PDT, CET...) for the
// visitor's own zone. Browsers in some regions only offer a raw "GMT+10", so we
// ask a few English regions for their abbreviation and, if none has one, say
// "your time" (the time is already converted to the visitor's own clock).
// We never show "GMT+10" to a visitor.
function friendlyTimeZone(date) {
  const when = date || new Date();
  const raw = /^(GMT|UTC)[+\-−]/;
  const locales = ['en-US', 'en-GB', 'en-AU', 'en-NZ', 'en-CA', 'en-IN', 'en-ZA'];
  for (let i = 0; i < locales.length; i++) {
    try {
      const part = new Intl.DateTimeFormat(locales[i], { timeZoneName: 'short' })
        .formatToParts(when)
        .find((p) => p.type === 'timeZoneName');
      if (part && !raw.test(part.value)) return part.value;
    } catch (err) {
      /* this locale is not available here, try the next */
    }
  }
  return 'your time';
}
