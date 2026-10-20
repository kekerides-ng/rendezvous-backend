/**
 * Event names, in one place.
 *
 * A string literal typed at the emit site and mistyped at the listen site is
 * an event that silently never fires — the worst kind of bug, because nothing
 * errors and the feature just quietly does not happen. Modules import the
 * constant, so a typo is a compile error.
 *
 * Each module also declares its own payload types in `<module>.events.ts`; this
 * file is only the names, so that `common/` never imports from `modules/`.
 */
export const EVENTS = {
  booking: {
    funded: 'booking.funded',
    confirmed: 'booking.confirmed',
    started: 'booking.started',
    completed: 'booking.completed',
    cancelled: 'booking.cancelled',
    disputed: 'booking.disputed',
  },
  kyc: {
    verified: 'kyc.verified',
    rejected: 'kyc.rejected',
  },
  media: {
    uploaded: 'media.uploaded',
    moderated: 'media.moderated',
  },
  messaging: {
    sent: 'messaging.sent',
    flagged: 'messaging.flagged',
  },
  safety: {
    sos: 'safety.sos',
    reported: 'safety.reported',
    blocked: 'safety.blocked',
  },
} as const;

/** Every event name, for exhaustive handling and tests. */
export type EventName =
  (typeof EVENTS)[keyof typeof EVENTS][keyof (typeof EVENTS)[keyof typeof EVENTS]];
