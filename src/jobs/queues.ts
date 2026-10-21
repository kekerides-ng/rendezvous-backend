/**
 * Queue names, in one place, for the same reason event names are
 * (`common/events/events.ts`): a mistyped queue name is a job that is enqueued
 * and never processed, with nothing erroring.
 */
export const QUEUES = {
  /** Smile ID checks — a webhook can be slow or arrive twice. */
  kyc: 'kyc',
  /** Web Push, SMS and email, each retried independently. */
  notifications: 'notifications',
  /** Catches up on escrow events missed while the process was down. */
  chainBackfill: 'chain-backfill',
  /** architecture.md §6: releases a booking 6 h after the session ends. */
  keeperRelease: 'keeper-release',
  /** Keyword moderation on messages. */
  moderation: 'moderation',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
