import { describe, expect, it } from 'vitest';

import { databaseError } from '../scripts/database-error';

describe('database CLI diagnostics', () => {
  it('unwraps a query error without logging SQL, parameters or credentials', () => {
    const error = new Error(
      'Failed query: insert password=private-value postgres://user:secret@host/db',
      { cause: Object.assign(new Error('password authentication failed'), { code: '28P01' }) },
    );
    const message = databaseError(error);
    expect(message).toContain('[28P01]');
    expect(message).not.toMatch(/private-value|secret|insert password/);
  });
  it('unwraps aggregate network failures', () => {
    expect(
      databaseError(
        new AggregateError([Object.assign(new Error('connection'), { code: 'ECONNREFUSED' })]),
      ),
    ).toContain('[ECONNREFUSED]');
  });
  it('handles circular causes', () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(databaseError(error)).toContain('without a driver error code');
  });
  it('never logs arbitrary error messages', () => {
    expect(databaseError(new Error('sensitive input'))).not.toContain('sensitive input');
  });
});
