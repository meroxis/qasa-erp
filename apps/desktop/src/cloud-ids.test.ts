import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs module used by build.mjs
import { cloudIds } from '../cloud-ids.mjs';

const ID = '265772485517-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const SECRET = 'GOCSPX-Abc_def-0123456789abcdefghijk';

describe('cloud backup IDs in the build', () => {
  it('drops a byte order mark, zero-width spaces and line endings (Error 401: invalid_client otherwise)', () => {
    const ids = cloudIds({ QASA_GOOGLE_CLIENT_ID: `﻿${ID}\r\n`, QASA_GOOGLE_CLIENT_SECRET: `﻿${SECRET}​\n` });
    expect(ids).toEqual({ google: ID, googleSecret: SECRET, onedrive: '' });
  });

  it('keeps empty values empty, so that provider shows as coming soon', () => {
    expect(cloudIds({})).toEqual({ google: '', googleSecret: '', onedrive: '' });
  });

  it('stops the build for a value in the wrong format, or an ID without its secret', () => {
    expect(() => cloudIds({ QASA_GOOGLE_CLIENT_ID: 'not-an-id', QASA_GOOGLE_CLIENT_SECRET: SECRET })).toThrow(/google is not in the expected format/);
    expect(() => cloudIds({ QASA_GOOGLE_CLIENT_ID: ID, QASA_GOOGLE_CLIENT_SECRET: 'secret' })).toThrow(/googleSecret/);
    expect(() => cloudIds({ QASA_GOOGLE_CLIENT_ID: ID })).toThrow(/set together/);
    expect(() => cloudIds({ QASA_MS_CLIENT_ID: 'x' })).toThrow(/onedrive/);
    expect(cloudIds({ QASA_MS_CLIENT_ID: '0b4f2c1e-1234-4abc-9def-0123456789ab' }).onedrive).toBe('0b4f2c1e-1234-4abc-9def-0123456789ab');
  });
});
