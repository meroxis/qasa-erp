import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { creditedSources, type ProductSource } from '@qasa/core';
import { ErrorBox, Icon, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { mediaApi } from './media-api.ts';

/**
 * Item pictures. The page first learns which items have one (one small request), then loads each picture only when it
 * scrolls into view, and keeps it for the visit. A picture is made small in the browser before it is saved (at most
 * 800 px and 300 KB), so lists stay fast even on an office network.
 */

const MAX_SIDE = 800;
const TARGET_BYTES = 300 * 1024;
/** The largest file the browser is asked to open as a picture (a phone photo is a few MB). */
export const MAX_PICTURE_FILE_BYTES = 20 * 1024 * 1024;

/* ---------- which items have a picture ---------- */

let index: Map<string, string> | null = null;
// 2.1: the pictures that came from an open product database (their credit is shown where they are shown publicly)
let sources = new Map<string, ProductSource>();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function loadIndex(): void {
  if (loading) return;
  loading = mediaApi.imageIndex()
    .then((rows) => {
      index = new Map(rows.map((r) => [r.itemId, r.updatedAt]));
      sources = new Map(rows.flatMap((r) => (r.source ? [[r.itemId, r.source] as const] : [])));
    })
    .catch(() => { index = new Map(); sources = new Map(); })
    .finally(() => notify());
}

/** Forgets what it knew (after a change, or another person's change) and asks again. */
export function refreshItemImages(): void {
  loading = null;
  loadIndex();
}

function setIndexEntry(itemId: string, updatedAt: string | null, source?: ProductSource): void {
  index ??= new Map();
  index = new Map(index);
  sources = new Map(sources);
  if (updatedAt) index.set(itemId, updatedAt);
  else index.delete(itemId);
  if (updatedAt && source) sources.set(itemId, source);
  else sources.delete(itemId);
  notify();
}

/**
 * The open product databases the pictures of these items came from (each once): what a page that shows them to
 * people outside the shop credits. Empty while the list of pictures is not known, and for the shop's own pictures.
 */
export function usePictureSources(itemIds: readonly (string | null | undefined)[]): ProductSource[] {
  const key = useSyncExternalStore(
    (onChange) => { listeners.add(onChange); loadIndex(); return () => listeners.delete(onChange); },
    () => creditedSources(itemIds.map((id) => (id ? sources.get(id) : undefined))).join(','),
    () => ''
  );
  return key ? key.split(',') as ProductSource[] : [];
}

function useImageVersion(itemId: string): string | null | undefined {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); loadIndex(); return () => listeners.delete(onChange); },
    () => (index ? index.get(itemId) ?? null : undefined),
    // drawn without a window (the tests): not known yet, so the initials
    () => undefined
  );
}

/* ---------- the pictures themselves ---------- */

const cache = new Map<string, Promise<string | null>>();

function pictureUrl(itemId: string, version: string): Promise<string | null> {
  const key = `${itemId}@${version}`;
  let p = cache.get(key);
  if (!p) {
    p = mediaApi.image(itemId).then((img) => `data:${img.mime};base64,${img.data}`).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

function initials(name: string): string {
  // words that start with a letter or digit (skips separators such as · or —)
  const words = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return (words.length > 1 ? words[0]!.charAt(0) + words[1]!.charAt(0) : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/**
 * An item's picture as an address for <img>, or null while there is none to show: the item has no picture (nothing is
 * asked for it), its box is not in view yet, or the picture is still on its way. `box` goes on the element that
 * stands where the picture will be.
 */
export function useItemPicture(itemId: string): { box: RefObject<HTMLSpanElement | null>; url: string | null } {
  const version = useImageVersion(itemId);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true); }, { rootMargin: '200px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [visible]);

  useEffect(() => {
    let live = true;
    if (!version || !visible) { setUrl(null); return; }
    void pictureUrl(itemId, version).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [itemId, version, visible]);
  return { box, url };
}

/** An item's picture, or its initials when it has none. */
export function ItemImage({ itemId, name, size = 36 }: { itemId: string; name: string; size?: number }) {
  const { box, url } = useItemPicture(itemId);
  const style = { inlineSize: size, blockSize: size, borderRadius: 'var(--r-md)', flexShrink: 0, overflow: 'hidden' } as const;
  return (
    <span ref={box} className="avatar mark" style={{ ...style, fontSize: Math.max(11, Math.round(size / 3)) }} aria-hidden={url ? undefined : true}>
      {url
        ? <img src={url} alt={name} width={size} height={size} style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover', display: 'block', background: 'var(--surface)' }} />
        : initials(name)}
    </span>
  );
}

/* ---------- choosing a picture ---------- */

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Makes a photo small enough: at most 800 px on its long side and about 300 KB, as WebP (or JPEG where WebP can't be made). */
export async function shrinkPicture(file: Blob, size: { maxSide?: number; targetBytes?: number } = {}): Promise<Blob> {
  const maxSide = size.maxSide ?? MAX_SIDE;
  const target = size.targetBytes ?? TARGET_BYTES;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d')!;
      // a white background, so transparent PNGs don't turn black as JPEG
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.72, 0.6]) {
        let blob = await toBlob(canvas, 'image/webp', quality);
        if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
        if (blob && blob.size <= target) return blob;
      }
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('too_large');
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A picture chosen in a form, ready to send: made small, as base64, with its type (what the canvas really wrote). */
export interface PreparedPicture {
  data: string; mime: string;
  /** 2.1: the picture a lookup of this barcode found (not the shop's own): saved with its source, for the credit */
  lookupBarcode?: string;
  source?: ProductSource;
}

/**
 * Checks a chosen file and makes it small. Only a file the browser can really decode as a picture gets through (its
 * name and declared type are not trusted), and it is drawn again on a canvas, so nothing but pixels is sent; the
 * server checks the bytes again.
 */
export async function preparePicture(file: File, size: { maxSide?: number; targetBytes?: number } = {}): Promise<PreparedPicture | { refused: 'too_big' | 'unreadable' }> {
  if (file.size > MAX_PICTURE_FILE_BYTES) return { refused: 'too_big' };
  if (file.size === 0 || (file.type && !file.type.startsWith('image/'))) return { refused: 'unreadable' };
  try {
    const small = await shrinkPicture(file, size);
    return { data: await base64Of(small), mime: small.type };
  } catch {
    return { refused: 'unreadable' };
  }
}

/** Saves a prepared picture as an item's picture, and lets the lists know. */
export async function saveItemPicture(itemId: string, data: string, lookupBarcode?: string): Promise<void> {
  const saved = await mediaApi.setImage(itemId, data, lookupBarcode);
  setIndexEntry(itemId, saved.updatedAt, saved.source?.source);
}

/** A phone or a tablet (a finger, not a mouse): there "Take a photo" opens the camera; on a PC it would only open the same file box. */
export const hasCamera = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * The picture of an item that is not saved yet (the new-item form): chosen and shown here, sent by the form once the
 * item exists.
 */
export function NewItemPicture({ value, onChange, size = 104 }: { value: PreparedPicture | null; onChange(picture: PreparedPicture | null): void; size?: number }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [touch] = useState(hasCamera);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      const picture = await preparePicture(file);
      if ('refused' in picture) setProblem(picture.refused === 'too_big' ? t('it_pictureTooBig', { n: MAX_PICTURE_FILE_BYTES / (1024 * 1024) }) : t('md_imageUnreadable'));
      else onChange(picture);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (camera.current) camera.current.value = '';
    }
  };
  return (
    <div className="stack" style={{ gap: 8, alignItems: 'center', inlineSize: size + 24, flexShrink: 0 }}>
      <span className="avatar mark" style={{ inlineSize: size, blockSize: size, borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        {value
          ? <img src={`data:${value.mime};base64,${value.data}`} alt={t('it_picture')} width={size} height={size} style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover', display: 'block', background: 'var(--surface)' }} />
          : <Icon name="plus" size={22} />}
      </span>
      <div className="row" style={{ justifyContent: 'center', gap: 4, flexWrap: 'nowrap' }}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>{touch ? t('pl_chooseFile') : value ? t('md_changePicture') : t('md_addPicture')}</button>
        {value && (
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => onChange(null)} aria-label={t('md_removePicture')} title={t('md_removePicture')}><Icon name="x" size={14} /></button>
        )}
      </div>
      {touch && (
        <>
          {/* a phone or a tablet: straight to the camera (the photo is made small like any other picture) */}
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void choose(e.target.files?.[0])} />
          <button type="button" className="btn small" disabled={busy} onClick={() => camera.current?.click()}>{t('pl_takePhoto')}</button>
        </>
      )}
      {problem && <div className="alert bad small" role="alert">{problem}</div>}
    </div>
  );
}

/** The picture on an item's page: shows it large, and lets someone with the stock permission choose or remove it. */
export function ImagePicker({ itemId, name, canEdit = true, size = 140 }: { itemId: string; name: string; canEdit?: boolean; size?: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const version = useImageVersion(itemId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLocalError(null);
    setBusy(true);
    try {
      const picture = await preparePicture(file);
      if ('refused' in picture) {
        setLocalError(picture.refused === 'too_big' ? t('it_pictureTooBig', { n: MAX_PICTURE_FILE_BYTES / (1024 * 1024) }) : t('md_imageUnreadable'));
        return;
      }
      await saveItemPicture(itemId, picture.data);
      toast(t('md_imageSaved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      await mediaApi.deleteImage(itemId);
      setIndexEntry(itemId, null);
      toast(t('md_imageRemoved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10, alignItems: 'center' }}>
      <ItemImage itemId={itemId} name={name} size={size} />
      {canEdit && (
        <div className="row no-print" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="plus" size={16} />{version ? t('md_changePicture') : t('md_addPicture')}
          </button>
          {version && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()} aria-label={t('md_removePicture')} title={t('md_removePicture')}>
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}
      {localError && <div className="alert bad" role="alert">{localError}</div>}
      <ErrorBox error={error} />
    </div>
  );
}
