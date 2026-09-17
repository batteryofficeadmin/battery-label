# Battery Label — QR Product Lookup

A standalone product lookup page for batteries, designed to be accessed by scanning a QR code printed on the battery label. Given a supplier, brand, and product code in the URL, it looks up the matching row in a client-side SQLite database and renders a product info card (specs, safety icons, production code pattern, declaration of conformity, etc).

## Usage

Link format:

```
https://<deployed-domain>/?Supplier=<name>&Brand=<name>&Code=<code>
```

`app.js` reads these query params, loads `products.db` with [sql.js](https://sql.js.org/), and renders the matching product's info card.

## Structure

- `index.html` — the lookup page
- `app.js` — reads URL params, queries `products.db`, renders the result card
- `style.css` — page styles
- `products.db` — SQLite database of products (see below for updating)
- `img/` — safety/recycling icons and supplier production-code pattern images
- `assets/` — declaration of conformity PDFs, site logo, favicon

## Updating the database

1. Go to the `OfficeAdmin/QR Codes` folder locally.
2. Run `populate_db.py` and update `products.db`.
3. Copy the updated `products.db` into this project's root and commit it.

No build step is required — this is a static site and can be served from any web server or static host (e.g. GitHub Pages).
