// The OAuth client IDs for Pro cloud backup, as build.mjs puts them into the app (from the release's secrets).
//
// A value copied through Windows PowerShell can carry a byte order mark (U+FEFF) or a line ending; Google then answers
// "Error 401: invalid_client" for an ID that looks right. So every value is cleaned of invisible characters and checked
// against the provider's format, and a value that still doesn't fit stops the build instead of shipping a broken button.

const INVISIBLE = /[﻿​-‍⁠\s]/g;

const FORMATS = {
  google: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
  googleSecret: /^GOCSPX-[A-Za-z0-9_-]+$/,
  // a Microsoft Entra application (client) ID is a GUID
  onedrive: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
};

/** The cleaned IDs; empty stays empty (that provider shows as coming soon). Throws for a value in the wrong format. */
export function cloudIds(env = process.env) {
  const ids = {
    google: env.QASA_GOOGLE_CLIENT_ID ?? '',
    googleSecret: env.QASA_GOOGLE_CLIENT_SECRET ?? '',
    onedrive: env.QASA_MS_CLIENT_ID ?? ''
  };
  for (const key of Object.keys(ids)) {
    ids[key] = ids[key].replace(INVISIBLE, '');
    if (ids[key] && !FORMATS[key].test(ids[key])) throw new Error(`cloud backup: ${key} is not in the expected format`);
  }
  if (Boolean(ids.google) !== Boolean(ids.googleSecret)) throw new Error('cloud backup: the Google client ID and secret must be set together');
  return ids;
}
