import { describe, expect, it } from 'vitest';
import * as server from './index.ts';
import type { SecretVault } from './index.ts';

describe('the package entry', () => {
  it('lets the desktop app protect the invoice QR signing key', () => {
    expect(typeof server.configureVerifyKeyVault).toBe('function');
    const vault: SecretVault = { protect: (plain) => plain, reveal: (stored) => stored };
    expect(() => server.configureVerifyKeyVault(vault)).not.toThrow();
    server.configureVerifyKeyVault(null);
  });
});
