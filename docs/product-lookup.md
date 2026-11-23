# Product pictures and names from the barcode

When an item is added by its barcode, Qasa ERP can look for its picture and name in the open product databases:
[Open Food Facts](https://world.openfoodfacts.org) and its sister projects Open Beauty Facts, Open Products Facts
and Open Pet Food Facts. It is free, needs no account, and is **off until an admin switches it on**. On every plan.

## What is sent, and to whom

- **Only the barcode number.** Not the company's name, not a user, not a price, a quantity or anything about
  customers. The request names the app ("QasaERP", its version, and Meroxis' contact address), as the databases ask of
  every program that reads them.
- **Only a barcode a manufacturer printed.** A code the shop made itself is never sent: a scale's label and every
  number in the ranges kept for use inside a shop (EAN-13 starting with 2, 02 or 04, which is where the app numbers
  its own variants), anything shorter than 8 digits, anything with letters, and a code whose check digit is wrong.
- **Only to those four databases**, over https: `world.openfoodfacts.org`, `world.openbeautyfacts.org`,
  `world.openproductsfacts.org`, `world.openpetfoodfacts.org`, and their picture hosts (`images.…`). A redirect
  anywhere else is refused.
- **Only the office's own server asks.** The pages of the app, the till and the phone app talk to nobody but the
  office; a phone sends the barcode to its office through the encrypted phone link, and the office asks.
- Like any web request, the database sees the internet address the request comes from.

## What comes back, and what is kept

- Name suggestions (Arabic, English, Kurdish when the database has them, and the size) and the front picture of the
  product. A name is filled in only when its button is pressed; the picture is used unless the person unticks
  "Use this picture" or adds a photo or a file of their own.
- Nothing is saved for an item until the person saves the item. The answer itself is kept in the company's database
  for a while (a product for 30 days, a "not found" for 7) so the same barcode is not asked about twice.
- A picture saved from a database keeps where it came from. Wherever such a picture is shown to people outside the
  shop (the price checker's screen, a printed document that shows item pictures) the credit
  "Images: Open Food Facts contributors, CC BY-SA" is shown, as the pictures' licence asks. The data is under the Open
  Database License, the pictures under Creative Commons Attribution-ShareAlike; pictures of packaging may show
  trademarks that belong to their owners. Replacing the picture with the shop's own photo removes the credit.

## Turning it on and off

- **Settings → Sales and point of sale → Product pictures and names from the barcode** (an admin).
- The first time an admin adds an item with a manufacturer's barcode, the form asks once, in plain words; "Not now"
  leaves it off and the question does not come back.
- Off, or without internet, everything works as before: the form never waits for the lookup, and the picture is
  added by hand ("Take a photo" on a phone or tablet, "Choose a file", "Remove").
- **Items → Find pictures for items without one** (an admin, with the setting on) goes through the items that have a
  manufacturer's barcode and no picture, about six a minute, in the background. It can be stopped, and it never
  replaces a picture that is there.
- **Find a picture** under the picture of one item (its page and its edit form; whoever may add items, with the setting
  on) asks about that one barcode when the button is pressed. What comes back is shown first and saved only with
  **Use this picture**, so a picture the shop chose is never replaced by itself.

## Limits the app keeps

The databases allow 15 product reads a minute from one internet address. The app asks at most 10 a minute, for each
company and for the whole office server, gives up on a request after three seconds, takes a picture only when its
bytes really are a JPEG, PNG or WebP that fits an item's picture, and stops the search over every item when the
databases do not answer three times in a row.

## For developers

- Server: `packages/server/src/product-lookup.ts` (`POST /api/items/lookup`, the setting, the search over every
  item), schema 20 (`product_lookups`, `item_image_sources`), the barcode rule in `packages/core/src/product-lookup.ts`.
- Web: `apps/web/src/industry/ProductLookup.tsx`. Phone: `apps/mobile/src/item-lookup.ts` (phone app 1.2.0, with an
  office whose phone link offers `itemLookup`: the Pro module's `src/phone/staff-routes.ts`).
- Tests use recorded answers (`packages/server/src/fixtures/product-lookup`): no test talks to the internet.
- The databases' rules, as read in November 2026: https://openfoodfacts.github.io/openfoodfacts-server/api/ (the
  User-Agent, the rate limits, the licences) and https://world.openfoodfacts.org/terms-of-use (attribution).
