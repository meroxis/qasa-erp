import { describe, expect, it } from 'vitest';
import { OfficeLink, relayBase, DEFAULT_RELAY_URL, type LinkState, type Route } from '../src/link';
import { generateKeyPair } from '../src/protocol';
import { fakeOffice, sleep, waitFor } from './fake-office';

const fast = [10, 20, 40];

describe('the link connects again by itself', () => {
  it('after the office PC goes away and comes back, on the Wi-Fi', async () => {
    const o = fakeOffice();
    const states: [LinkState, Route | null | undefined][] = [];
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Raz', socket: o.socket, reconnectMs: fast, onState: (s, _d, via) => states.push([s, via]) });
    await link.connect();
    expect(link.via).toBe('lan');
    expect(states.at(-1)).toEqual(['online', 'lan']);

    o.drop();
    await waitFor(() => link.state === 'offline');
    // tries while the PC is away fail, and go on later
    await sleep(80);
    expect(link.state).not.toBe('online');
    o.state.up = true;
    await waitFor(() => link.state === 'online', 2000);
    expect(await link.request('GET', '/api/items')).toEqual({ s: 200, b: { echo: '/api/items' } });
    link.close();
  });

  it('not while the app is in the background; at once when it is back', async () => {
    const o = fakeOffice();
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Raz', socket: o.socket, reconnectMs: [5000] });
    await link.connect();
    link.pause();
    o.drop();
    await waitFor(() => link.state === 'offline');
    o.state.up = true;
    await sleep(50);
    expect(link.state).toBe('offline');
    // back on the screen: no waiting for the 5 s
    link.resume();
    await waitFor(() => link.state === 'online', 1000);
    link.close();
  });

  it('not after the office refused the phone, nor after close()', async () => {
    const refusing = fakeOffice({ refuse: 'unknown_device' });
    let tries = 0;
    const link = new OfficeLink({ office: refusing.office, phone: generateKeyPair(), name: 'x', reconnectMs: fast, socket: (url) => { tries++; return refusing.socket(url); } });
    await expect(link.connect()).rejects.toMatchObject({ code: 'unknown_device' });
    await sleep(80);
    expect(tries).toBe(1);
    expect(link.state).toBe('refused');

    const o = fakeOffice();
    let opened = 0;
    const closing = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'x', reconnectMs: fast, socket: (url) => { opened++; return o.socket(url); } });
    await closing.connect();
    closing.close();
    await sleep(80);
    expect(opened).toBe(1);
    await expect(closing.connect()).rejects.toMatchObject({ code: 'closed' });
  });

  it('a busy office (too many tries) is tried again later', async () => {
    const busy = fakeOffice({ refuse: 'too_many' });
    let tries = 0;
    const link = new OfficeLink({ office: busy.office, phone: generateKeyPair(), name: 'x', reconnectMs: fast, socket: (url) => { tries++; return busy.socket(url); } });
    await expect(link.connect()).rejects.toMatchObject({ code: 'too_many' });
    expect(link.state).toBe('offline');
    await waitFor(() => tries >= 3, 2000);
    link.close();
  });
});

describe('what goes over the link', () => {
  it('a change carries its key; unpairing tells the office and closes', async () => {
    const o = fakeOffice();
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Raz', socket: o.socket, reconnect: false });
    await link.request('POST', '/api/invoices', { kind: 'sale' }, '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4');
    await link.request('GET', '/api/items');
    const sent = o.seen.filter((m) => m.m !== 'hello');
    expect(sent[0]).toMatchObject({ m: 'POST', p: '/api/invoices', b: { kind: 'sale' }, k: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' });
    expect(sent[1]).not.toHaveProperty('k');

    expect(await link.unpair()).toBe(true);
    expect(o.seen.at(-1)).toMatchObject({ m: 'bye' });
    expect(link.state).toBe('offline');
  });

  it('unpairing an office that can\'t be reached closes the link anyway', async () => {
    const o = fakeOffice();
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Raz', socket: o.socket, reconnect: false });
    expect(await link.unpair(50)).toBe(false);
    expect(link.state).toBe('offline');
  });

  it('uses only a wss:// relay from the build, else Meroxis\' relay', () => {
    expect(relayBase(undefined)).toBe(DEFAULT_RELAY_URL);
    expect(relayBase('wss://relay.test.example/')).toBe('wss://relay.test.example');
    expect(relayBase('ws://relay.test.example')).toBe(DEFAULT_RELAY_URL);
    expect(relayBase('https://relay.test.example')).toBe(DEFAULT_RELAY_URL);
    expect(relayBase('wss://relay.test.example/path?x=1')).toBe(DEFAULT_RELAY_URL);
  });
});
