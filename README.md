# Historical Data Slider

A lightweight, static web app to explore intraday stock data at 1‑second resolution. Pick a stock, pick a date, and scrub a time slider to see:

- Price and volume charts (with y‑axis titles “Price” and “Volume”).
- Current OHLC at the selected second (with a precision toggle).
- Intraday return vs. the day’s first close.
- Rolling 30‑minute annualized volatility computed from minute returns.

It’s fast: the app loads only what it needs (optionally per‑day), draws charts once, and updates a cursor as you move the slider.

## Project layout

```
├── assets/
│   └── js/
│       └── app.js         # main logic to load highcharts
├── data_json/             # large per‑ticker JSON
│   ├── ABNB.json          # { ticker, days: { YYYY-MM-DD: [ ... ] } }
│   └── ...
├── generate_manifest.py   # builds manifest.json and <TICKER>.dates.json - run this!
├── split_by_day.py        # split each day of each ticker - recommended if want optimal performance locally
├── index.html             # single static page -- v0.dev!
├── README.md
├── data_cleaning.ipynb.   # me cleaning and reorganizing the csv files for the data
└── requirements.txt       # only for the notebooks/utilities
```

## Data formats

Per‑ticker JSON (large, one file per ticker):

```
{
  "ticker": "ABNB",
  "days": {
    "YYYY-MM-DD": [
      {"time": "09:30:00", "open": 134.43, "high": 134.50, "low": 134.41, "close": 134.50, "volume": 300, "count": 20},
      ... 23.5k rows per day ...
    ],
    ... more days ...
  }
}
```

## Preparing data

Both uncompressed `.json` and compressed `.json.gz` are supported. Uncompressed is simplest. I uploaded hte json.gz. because github doesn't allow the bigger files

```
gunzip data_json/*.json.gz
```

### Generate the date manifest (recommended)

Create a small manifest so the UI can list days without downloading huge files:

```
python3 generate_manifest.py
```

This writes:
- `data_json/manifest.json` with `{ tickers: [...], dates: { TICKER: [YYYY-MM-DD, ...] } }`
- `data_json/<TICKER>.dates.json` per ticker with `{ "dates": [ ... ] }`

### Optional: split per‑ticker files into per‑day files

```
python3 split_by_day.py           # split all data_json/<TICKER>.json
# or for specific stocks
python3 split_by_day.py data_json ABNB AMAT
```

Outputs: `data_json/<TICKER>/<YYYY-MM-DD>.json` in normalized `{t,o,h,l,c,v,cnt}` form.

## Running locally

Run below:

```
python3 -m http.server 8080
# then visit http://localhost:8080/index.html
```

## Using the app

1) Pick a stock
- Populated from `data_json/manifest.json` if present (fallback to directory listing).

2) Pick a date
- The date dropdown lists available days for the chosen stock (from manifest or, if missing, by peeking the large JSON).
- If per‑day files exist (`data_json/<TICKER>/<DATE>.json`), the app loads those; otherwise it streams just that day out of the large per‑ticker file.

3) Scrub the slider
- Charts are preloaded for the day; moving the slider updates a thin cursor and the left‑panel stats.
- Top chart: price; bottom chart: volume.

4) Controls and metrics
- Price precision: toggle “High precision (4 decimal points)” to switch between 2 and 4 decimals for OHLC display (default is 4 dp). Charts use full precision.
- Return: current close vs. day’s first close, shown in %.
- Volatility: annualized rolling 30‑minute realized volatility computed from minute log returns. Shows “—” until 30 minutes have elapsed.
