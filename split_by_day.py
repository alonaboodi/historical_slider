#!/usr/bin/env python3
import json
import os
import sys

"""
Split large per-ticker JSON (data_json/<TICKER>.json) into per-day files:
  data_json/<TICKER>/<YYYY-MM-DD>.json

Each per-day file contains an array of records normalized to the UI schema:
  [{"t": time, "o": open, "h": high, "l": low, "c": close, "v": volume, "cnt": count}, ...]

Usage:
  python3 split_by_day.py [path_to_data_json] [TICKER ...]

If no tickers are provided, splits all <TICKER>.json in the directory.
"""


def normalize_row(x: dict):
    return {
        "t": x.get("time"),
        "o": x.get("open"),
        "h": x.get("high"),
        "l": x.get("low"),
        "c": x.get("close"),
        "v": x.get("volume"),
        "cnt": x.get("count"),
    }


def main():
    base = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].upper().endswith('.JSON') else os.path.join(os.getcwd(), 'data_json')
    if not os.path.isdir(base):
        print(f"data_json directory not found at: {base}")
        sys.exit(1)

    tickers = [t for t in sys.argv[1:] if t.upper().endswith('.JSON') is False and t != base]
    if not tickers:
        tickers = [name[:-5] for name in os.listdir(base) if name.lower().endswith('.json') and name not in ('manifest.json',)]

    for ticker in tickers:
        in_path = os.path.join(base, f"{ticker}.json")
        if not os.path.isfile(in_path):
            print(f"Skip {ticker}: {in_path} not found")
            continue
        print(f"Reading {in_path} ...")
        with open(in_path, 'r') as f:
            data = json.load(f)
        days = data.get('days') or {}
        out_dir = os.path.join(base, ticker)
        os.makedirs(out_dir, exist_ok=True)
        count = 0
        for date, rows in days.items():
            out_path = os.path.join(out_dir, f"{date}.json")
            norm = [normalize_row(r) for r in rows]
            with open(out_path, 'w') as of:
                json.dump(norm, of, separators=(',', ':'))
            count += 1
        print(f"Wrote {count} day files to {out_dir}")


if __name__ == '__main__':
    main()

