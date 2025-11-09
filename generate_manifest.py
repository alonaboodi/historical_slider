#!/usr/bin/env python3
import json
import os
import sys

"""
Generates data_json/manifest.json with:
  - tickers: list of discovered tickers from <TICKER>.json (or .json.gz)
  - dates: mapping of ticker -> list of available YYYY-MM-DD dates

Also writes a small per-ticker file data_json/<TICKER>.dates.json with:
  { "dates": ["YYYY-MM-DD", ...] }

Usage:
  python3 generate_manifest.py [path_to_data_json]

If path is omitted, assumes ./data_json relative to repository root.
"""

import re


def find_ticker_files(base: str):
    files = []
    for name in os.listdir(base):
        low = name.lower()
        if low.endswith('.json') and not low.endswith('.dates.json') and name != 'manifest.json':
            files.append((name[:-5], os.path.join(base, name)))
        elif low.endswith('.json.gz'):
            files.append((name[:-8], os.path.join(base, name)))
    return sorted(files)


def extract_dates_from_json(filepath: str):
    pat = re.compile(rb'"(20\d{2}-\d{2}-\d{2})"\s*:\s*\[')
    dates = []
    # Read in chunks with overlap to avoid boundary misses
    overlap = 64
    prev = b''
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            data = prev + chunk
            for m in pat.finditer(data):
                try:
                    dates.append(m.group(1).decode('utf-8'))
                except Exception:
                    pass
            prev = data[-overlap:]
    # Unique + sort
    dates = sorted(set(dates))
    return dates


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), 'data_json')
    if not os.path.isdir(base):
        print(f"data_json directory not found at: {base}")
        sys.exit(1)

    files = find_ticker_files(base)
    tickers = [t for (t, _) in files]
    dates_map = {}

    for ticker, path in files:
        if path.lower().endswith('.json'):
            print(f"Scanning dates for {ticker} from {os.path.basename(path)} ...")
            dates = extract_dates_from_json(path)
            dates_map[ticker] = dates
            # Write per-ticker dates file
            with open(os.path.join(base, f"{ticker}.dates.json"), 'w') as df:
                json.dump({ 'dates': dates }, df)
        else:
            pass

    out_path = os.path.join(base, 'manifest.json')
    with open(out_path, 'w') as f:
        json.dump({ 'tickers': tickers, 'dates': dates_map }, f)
    print(f"Wrote manifest with {len(tickers)} tickers to {out_path}")

if __name__ == '__main__':
    main()
