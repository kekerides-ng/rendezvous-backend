/**
 * What pino replaces a redacted value with. A marker rather than removing the
 * key, so a log line still tells you the field was present — "we logged a phone
 * number here and hid it" is useful; a silently missing key is not.
 */
export const REDACT_CENSOR = '[Redacted]';

/**
 * Paths pino redacts on every log record, everywhere, with no call site able to
 * opt out. Redaction lives here rather than at each call site because the only
 * version that works is the one nobody has to remember: a `log.info({ booking })`
 * written at 2am must not be able to leak a phone number.
 *
 * Path syntax: `foo.bar` is an exact path from the root of the logged object.
 * A `*` matches exactly ONE level, so `*.phone` catches `{ user: { phone } }`
 * but NOT `{ a: { b: { phone } } }`. There is no any-depth wildcard — list the
 * paths a field actually occurs at, which is a good forcing function for
 * keeping logged objects shallow.
 *
 * Two pino rules worth knowing before adding entries:
 *   - you cannot redact both a parent and its child (`user` and `user.phone`)
 *   - a path that never occurs costs nothing, so err on the side of listing it
 */
export const REDACT_PATHS: readonly string[] = [
  // --- transport and auth: never domain-specific, always sensitive ---------
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // Possessing a webhook signature lets an attacker replay a KYC result.
  'req.headers["x-smileid-signature"]',

  // --- credentials, keys and tokens, at the top level and one down --------
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'otp',
  '*.otp',
  'totp',
  '*.totp',
  // The PIN a user reads out at the venue to check in (architecture.md §6).
  'pin',
  '*.pin',
  'checkInPin',
  '*.checkInPin',

  // --- chain keys: catastrophic, not merely sensitive ---------------------
  // The operator key can issue refunds. It is loaded from env and must never
  // reach a log line, not even inside a config dump on boot.
  'privateKey',
  '*.privateKey',
  'OPERATOR_PRIVATE_KEY',
  '*.OPERATOR_PRIVATE_KEY',
  'operatorPrivateKey',
  '*.operatorPrivateKey',
  'mnemonic',
  '*.mnemonic',

  // --- NDPA: encrypted at rest, so never plaintext in a log (§8) ----------
  // Encrypting a column and then logging the value is theatre.
  'phone',
  '*.phone',
  'phoneNumber',
  '*.phoneNumber',
  'dob',
  '*.dob',
  'dateOfBirth',
  '*.dateOfBirth',
  'email',
  '*.email',
  'bvn',
  '*.bvn',
  'nin',
  '*.nin',
  'selfie',
  '*.selfie',
  'firstName',
  '*.firstName',
  'lastName',
  '*.lastName',
  // Smile ID returns result codes, which we store; never the document itself.
  'idNumber',
  '*.idNumber',
  'documentImage',
  '*.documentImage',

  // --- live location (§8: deleted after the session) ----------------------
  // A log file outlives the session, so a coordinate here defeats the deletion
  // promise entirely.
  'location',
  '*.location',
  'lat',
  '*.lat',
  'lng',
  '*.lng',
  'coordinates',
  '*.coordinates',

  // --- user-authored content ----------------------------------------------
  // Judgment call: message text is redacted even though that makes debugging
  // the moderation filter harder. A flagged message is reproducible from its id
  // plus reason codes in the database; a conversation does not need to sit in a
  // log aggregator for weeks to do it.
  //
  // Deliberately NOT redacting `message` itself — that collides with
  // `Error.message` and our own `ApiError.message`, and blanking those would
  // hide the very errors we keep logs for.
  'body',
  '*.body',
  'text',
  '*.text',
  'messageBody',
  '*.messageBody',
  'bio',
  '*.bio',

  // --- venue ---------------------------------------------------------------
  // Judgment call: the address is redacted, the name is not. A venue name is a
  // public business and useful in a log. An address plus a booking's `startsAt`
  // is "this person will be standing here at 19:00 on Tuesday", which is the one
  // fact the whole safety model exists to protect.
  'address',
  '*.address',
  'venue.address',
  'data.venue.address',
];
