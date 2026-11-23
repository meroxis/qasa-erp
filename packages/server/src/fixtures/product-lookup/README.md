Answers of the open product databases, recorded as they came on 23 November 2026 with the app's own request
(`GET https://world.<database>.org/api/v2/product/<barcode>?fields=…`, the fields product-lookup.ts asks for):

- `found-5449000000996.json` — Open Food Facts, HTTP 200
- `not-found-3600523951369.json` — Open Food Facts, HTTP 404
- `elsewhere-8410757001090.json` — Open Food Facts, HTTP 404: the product is kept by a sister project
- `found-beauty-8410757001090.json` — Open Beauty Facts, HTTP 200

The data is from Open Food Facts and Open Beauty Facts (https://world.openfoodfacts.org, https://world.openbeautyfacts.org),
made available under the Open Database License (https://opendatacommons.org/licenses/odbl/1-0/). No picture of theirs
is kept here: the tests make their own bytes.
