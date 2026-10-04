# Chip Bagger

A static site for Dan's potato chip bag collection ([@chip.bagger](https://www.instagram.com/chip.bagger/) on Instagram): every bag, a leaderboard for **collectability** and **curb appeal**, and a **chip map** of where the bags come from. No build step; it runs on GitHub Pages as-is.

## Run locally

```sh
python3 -m http.server
# open http://localhost:8000
```

(Opening `index.html` straight from disk won't load the data; browsers block `fetch` on `file://`.)

## Deploy on GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`. The site appears at `https://dan-logan.github.io/chipbagger/`.

## Data

| File | What it holds |
| --- | --- |
| `data/bags.csv` | One row per bag: `brand, flavor, notes, picture, collectability, curb_appeal, made_in`. The first four columns match the "Chip bags" Google Sheet. |
| `images/bags/` | Full-size photos, named exactly as in the Drive folder (`picture` column minus the `Chip bags_Images/` prefix). |
| `images/thumbs/` | Smaller copies used in the grid and leaderboards. If a thumbnail is missing, the full photo is used. |
| `data/origins.json` | Map locations (`places`) and which place each brand maps to (`brands`). `byNote` switches a brand's place when a bag's notes mention a word, e.g. Lay's bags marked "China" or "Taiwan". |

### Ratings

Scores are 1–10. Either type them into the `collectability` and `curb_appeal` columns, or use the site:

1. Open the Leaderboard and click **Rate bags** (or visit `/?rate`).
2. Open any bag and move the two sliders. Scores save in your browser as you go.
3. Click **Download bags.csv** and commit it over `data/bags.csv`.

### Adding bags

Add the row to the sheet (or `data/bags.csv`) and drop the photo into `images/bags/` with the same file name. To make a thumbnail (optional):

```sh
convert "images/bags/NAME.jpg" -resize '360x360>' -strip -quality 78 "images/thumbs/NAME.jpg"
```

If you re-export the sheet as CSV, keep the `collectability`, `curb_appeal` and `made_in` columns (add them to the sheet once and they'll come along).

### Origins

A bag's location comes from `made_in` (a key from `places` in `origins.json`) if set, otherwise from its brand. The brand locations are each company's home base or main plant, not necessarily the exact plant printed on every bag. Brands with no entry show up under "Origin unknown" on the map page.

## Credits

Colors and logo (`images/brand/logo.svg`) follow the @chip.bagger Instagram logo: navy `#334788`, orange `#f4a641`. They're set as variables at the top of `css/style.css`.

Map: [Leaflet](https://leafletjs.com/) (vendored in `vendor/leaflet`, BSD-2-Clause). The map uses no tile server and no API key: country and US state outlines are bundled in `vendor/geo` (from [world-atlas](https://github.com/topojson/world-atlas) and [us-atlas](https://github.com/topojson/us-atlas), Natural Earth / US Census data, ISC license) and drawn with [topojson-client](https://github.com/topojson/topojson-client) (ISC).
