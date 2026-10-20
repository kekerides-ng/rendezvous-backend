import { describe, expect, it } from 'vitest';

import { pgTable } from 'drizzle-orm/pg-core';

import { geographyPoint, usdc } from './columns';

/**
 * These test the driver round trip, which is the part that bites. A column
 * helper that looks right and loses precision on the way back from Postgres is
 * worse than no helper, because every module inherits the bug at once.
 */
/**
 * Built through a real table, because `usdc('amount')` is a column *builder* —
 * the driver mapping only exists on the built column. Testing the builder
 * would have tested nothing, and this is also how a module consumes it.
 */
const probe = pgTable('probe', {
  amount: usdc('amount'),
  location: geographyPoint('location'),
});

const money = probe.amount;
const place = probe.location;

describe('usdc', () => {
  it('is a bigint column', () => {
    expect(money.getSQLType()).toBe('bigint');
  });

  it('turns the driver string back into a bigint', () => {
    // `pg` returns bigint as a STRING so it does not lose precision. Without
    // this, a repo gets "31500000" and the first `+` concatenates.
    const value = money.mapFromDriverValue('31500000');
    expect(value).toBe(31_500_000n);
    expect(typeof value).toBe('bigint');
  });

  it('survives a value a JS number would corrupt', () => {
    // Number.MAX_SAFE_INTEGER is 9007199254740991.
    const huge = '9007199254740993';
    expect(money.mapFromDriverValue(huge)).toBe(9_007_199_254_740_993n);

    // Compared as strings on purpose: writing the literal
    // `9_007_199_254_740_993` would ALSO round, so the comparison would be two
    // identical wrong numbers. The loss is only visible on the way back out.
    expect(String(Number(huge))).toBe('9007199254740992');
  });

  it('sends a string back to the driver', () => {
    expect(money.mapToDriverValue(31_500_000n)).toBe('31500000');
  });

  it('round trips', () => {
    const original = 31_500_000n;
    expect(money.mapFromDriverValue(money.mapToDriverValue(original))).toBe(original);
  });
});

describe('geographyPoint', () => {
  it('is a geography point in WGS 84', () => {
    // `geometry` would do planar maths and return distances in degrees.
    expect(place.getSQLType()).toBe('geography(Point, 4326)');
  });

  it('writes longitude first, as PostGIS expects', () => {
    // Lekki Phase 1. Reversed, this is the Indian Ocean.
    const written = place.mapToDriverValue({ lon: 3.4738, lat: 6.4414 });
    expect(written).toBe('SRID=4326;POINT(3.4738 6.4414)');
  });

  it('reads longitude first too', () => {
    const read = place.mapFromDriverValue('POINT(3.4738 6.4414)');
    expect(read).toEqual({ lon: 3.4738, lat: 6.4414 });
  });

  it('handles negative coordinates', () => {
    // Accra is west of Greenwich; a naive parser drops the minus sign.
    expect(place.mapFromDriverValue('POINT(-0.1870 5.6037)')).toEqual({
      lon: -0.187,
      lat: 5.6037,
    });
  });

  it('refuses something that is not a point', () => {
    expect(() => place.mapFromDriverValue('0101000020E6100000')).toThrow(/Unrecognised point/);
  });
});
