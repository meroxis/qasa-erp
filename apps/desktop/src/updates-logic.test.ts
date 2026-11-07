import { describe, expect, it } from 'vitest';
import { channelOf, htmlToText, isPrerelease, notesText, updaterOptions } from './updates-logic.ts';

describe('update channel', () => {
  it('stable never takes prereleases or downgrades', () => {
    expect(updaterOptions(false)).toEqual({ channel: 'latest', allowPrerelease: false, allowDowngrade: false });
  });
  it('beta takes prereleases but never downgrades', () => {
    expect(updaterOptions(true)).toEqual({ channel: 'beta', allowPrerelease: true, allowDowngrade: false });
  });
  it('detects prerelease versions', () => {
    expect(isPrerelease('0.2.0-beta.1')).toBe(true);
    expect(isPrerelease('0.2.0')).toBe(false);
    expect(isPrerelease('garbage')).toBe(false);
  });
  it('uses the saved choice, else beta only on a beta build', () => {
    expect(channelOf('beta', '0.1.8')).toBe('beta');
    expect(channelOf('stable', '0.2.0-beta.1')).toBe('stable');
    expect(channelOf(undefined, '0.1.8')).toBe('stable');
    expect(channelOf(null, '0.2.0-beta.2')).toBe('beta');
    expect(channelOf('nonsense', '0.1.8')).toBe('stable');
  });
});

describe('release notes from the updater', () => {
  it('turns GitHub HTML into markdown-lite text', () => {
    const t = htmlToText('<h3>New</h3><ul><li><strong>Fast</strong> &amp; calm</li></ul><p>Bye<br>now</p><script>x</script>');
    expect(t).toContain('### New');
    expect(t).toContain('- **Fast** & calm');
    expect(t).toContain('Bye\nnow');
    expect(t).not.toContain('<');
  });
  it('accepts a string, a list of notes, or nothing', () => {
    expect(notesText(null)).toBeNull();
    expect(notesText('plain')).toBe('plain');
    expect(notesText([{ version: '1', note: 'a' }, { version: '2', note: 'b' }])).toContain('---');
  });
});
