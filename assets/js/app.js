'use strict';

  (function () {
    const state = {
      dataByTicker: new Map(),
      localFiles: new Map(),
      localDayFiles: new Map(), // key: `${ticker}:${date}` -> File
      currentTicker: null,
      currentDate: null,
      precision: 4,
      dayData: [],
      cumVolume: [],
      cumCount: [],
    firstClose: null,
    closes: [],
    logReturns: [],
    minuteTimes: [],
    minuteCloses: [],
    minuteLogReturns: [],
    minuteIndexByKey: new Map(),
    charts: { price: null, volume: null },
  };

  const els = {
    localLoadGroup: document.getElementById('local-load-group'),
    loadLocalBtn: document.getElementById('load-local'),
    folderInput: document.getElementById('folder-input'),
    stockSelect: document.getElementById('stock-select'),
    dateSelect: document.getElementById('date-select'),
    precisionToggle: document.getElementById('precision-toggle'),
    slider: document.getElementById('time-slider'),
    time: document.getElementById('current-time'),
    o: document.getElementById('open-value'),
    h: document.getElementById('high-value'),
    l: document.getElementById('low-value'),
    c: document.getElementById('close-value'),
    ret: document.getElementById('return-value'),
    vol: document.getElementById('volatility-value'),
    volu: document.getElementById('volume-value'),
    cnt: document.getElementById('count-value'),
  };

  const nf4 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  function fmtNum(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    if (digits === 0) return nf0.format(Number(n));
    return nf2.format(Number(n));
  }

  function fmtPrice(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return state.precision === 4 ? nf4.format(Number(n)) : nf2.format(Number(n));
  }

  function initCharts() {
    const baseOpts = {
      chart: { backgroundColor: '#ffffff', spacing: [10, 10, 10, 10] },
      title: { text: null },
      legend: { enabled: false },
      credits: { enabled: false },
      tooltip: { enabled: false },
      xAxis: { labels: { style: { color: '#000', fontSize: '11px' } }, gridLineWidth: 0 },
      yAxis: { labels: { style: { color: '#000', fontSize: '11px' } }, title: { text: null }, gridLineWidth: 0 },
      plotOptions: {
        series: { animation: false, marker: { enabled: false }, lineWidth: 1.5, color: '#000', boostThreshold: 1, turboThreshold: 0 },
        column: { borderWidth: 0, color: '#000', boostThreshold: 1, turboThreshold: 0 }
      }
    };

    state.charts.price = Highcharts.chart('price-chart', {
      ...baseOpts,
      yAxis: { ...baseOpts.yAxis, title: { text: 'Price' } },
      series: [{ type: 'line', data: [], name: 'Close' }]
    });
    state.charts.volume = Highcharts.chart('volume-chart', {
      ...baseOpts,
      yAxis: { ...baseOpts.yAxis, title: { text: 'Volume' } },
      series: [{ type: 'column', data: [], name: 'Volume' }]
    });
  }

  async function readJsonViaFetch(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  }

  async function tryFetchJson(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      throw e;
    }
  }

  async function readGzipJsonViaFetch(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const buf = await res.arrayBuffer();

    // Prefer native DecompressionStream when available
    if ('DecompressionStream' in window && Blob.prototype.stream) {
      try {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buf]).stream().pipeThrough(ds);
        const text = await new Response(stream).text();
        return JSON.parse(text);
      } catch (e) {
        console.warn('DecompressionStream failed, falling back to pako', e);
      }
    }

    if (window.pako?.ungzip) {
      const u8 = window.pako.ungzip(new Uint8Array(buf));
      const text = new TextDecoder('utf-8').decode(u8);
      return JSON.parse(text);
    }

    throw new Error('No gzip decompressor available');
  }

  async function readJsonFromFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  // Stream-extract a single day array from a large per-ticker JSON without loading it fully.
  // Works for structures like: { "ticker": "T", "days": { "YYYY-MM-DD": [ {..},{..} ], ... } }
  async function streamExtractDayFromResponseStream(stream, date) {
    const decoder = new TextDecoder('utf-8');
    const reader = stream.getReader();
    const needle = `"${date}"`;
    let buffer = '';
    let foundIdx = -1;
    let bracketStart = -1;
    let bracketDepth = 0;
    let done = false;
    while (!done) {
      const { value, done: rdone } = await reader.read();
      done = rdone;
      if (value) buffer += decoder.decode(value, { stream: true });

      if (foundIdx === -1) {
        foundIdx = buffer.indexOf(needle);
        if (foundIdx === -1) {
          // Keep buffer from growing unbounded; retain a tail overlap
          if (buffer.length > 1_000_000) buffer = buffer.slice(-200_000);
          continue;
        }
        // find the first '[' after the key's ':'
        const colonIdx = buffer.indexOf(':', foundIdx + needle.length);
        if (colonIdx === -1) continue;
        bracketStart = buffer.indexOf('[', colonIdx);
        if (bracketStart === -1) continue;
        bracketDepth = 1;
      }

      if (bracketStart !== -1 && bracketDepth > 0) {
        for (let i = bracketStart + 1; i < buffer.length; i++) {
          const ch = buffer[i];
          if (ch === '[') bracketDepth++;
          else if (ch === ']') {
            bracketDepth--;
            if (bracketDepth === 0) {
              const arrayText = buffer.slice(bracketStart, i + 1);
              try { return JSON.parse(arrayText); } catch (e) { throw e; }
            }
          }
        }
        // Not complete yet; adjust start to near end of buffer
        if (buffer.length > 1_000_000) {
          // Keep context including the bracket start
          buffer = buffer.slice(Math.max(0, bracketStart - 1000));
          // bracketStart shifts to new buffer start
          bracketStart = 1000 > bracketStart ? bracketStart : 1000;
        }
      }
    }
    throw new Error('Day array not found in stream');
  }

  async function streamExtractDayFromUrl(url, date) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    return streamExtractDayFromResponseStream(res.body, date);
  }

  async function streamExtractDayFromFile(file, date) {
    if (!file.stream) throw new Error('File stream not supported');
    const stream = file.stream();
    return streamExtractDayFromResponseStream(stream, date);
  }

  async function loadTickerData(ticker) {
    if (!ticker) return null;
    if (state.dataByTicker.has(ticker)) return state.dataByTicker.get(ticker);

    let json = null;
    if (state.localFiles.has(ticker)) {
      const file = state.localFiles.get(ticker);
      json = await readJsonFromFile(file);
    } else {
      const urlJson = `data_json/${ticker}.json`;
      try {
        json = await readJsonViaFetch(urlJson);
      } catch (e) {
        // Surface a clearer, on-page message for the user
        const msg = `Failed to load data for ${ticker}. Tried: ${urlJson} -> ${e && e.message ? e.message : e}`;
        showMessage(msg);
        throw new Error(msg);
      }
    }

    if (!json || typeof json !== 'object' || !json.days) throw new Error('Malformed JSON: missing days');
    state.dataByTicker.set(ticker, json);
    return json;
  }

  async function loadDayData(ticker, date) {
    if (!ticker || !date) return [];

    const localKey = `${ticker}:${date}`;
    if (state.localDayFiles.has(localKey)) {
      const f = state.localDayFiles.get(localKey);
      const json = await readJsonFromFile(f);
      return normalizeDayArray(json);
    }

    if (location.protocol !== 'file:') {
      try {
        const json = await tryFetchJson(`data_json/${ticker}/${date}.json`);
        return normalizeDayArray(json);
      } catch (_) { /* fall back */ }
    }

    // Try streaming extraction from the large ticker JSON (URL or local File)
    try {
      if (state.localFiles.has(ticker)) {
        const f = state.localFiles.get(ticker);
        const arr = await streamExtractDayFromFile(f, date);
        return normalizeDayArray(arr);
      } else if (location.protocol !== 'file:') {
        const arr = await streamExtractDayFromUrl(`data_json/${ticker}.json`, date);
        return normalizeDayArray(arr);
      }
    } catch (e) {
      console.warn('Streaming extraction failed, falling back to full JSON parse', e);
    }

    // Fallback: load full ticker JSON and slice the day
    const data = await loadTickerData(ticker);
    const rawDay = (data.days && data.days[date]) || [];
    return normalizeDayArray(rawDay);
  }

  function normalizeDayArray(raw) {
    // Accept either already-normalized array [{t,o,h,l,c,v,cnt}] or long-key form
    const arr = Array.isArray(raw?.day) ? raw.day : Array.isArray(raw) ? raw : [];
    return arr.map(x => ({
      t: x.t || x.time,
      o: Number(x.o ?? x.open),
      h: Number(x.h ?? x.high),
      l: Number(x.l ?? x.low),
      c: Number(x.c ?? x.close),
      v: Number(x.v ?? x.volume),
      cnt: Number(x.cnt ?? x.count),
    }));
  }

  let manifestCache = null;
  async function loadTickerDates(ticker) {
    if (manifestCache === null && location.protocol !== 'file:') {
      try {
        const res = await fetch('data_json/manifest.json', { cache: 'no-store' });
        if (res.ok) manifestCache = await res.json();
        else manifestCache = {};
      } catch (_) { manifestCache = {}; }
    }

    const datesFromManifest = Array.isArray(manifestCache?.dates?.[ticker]) ? manifestCache.dates[ticker] : null;
    if (datesFromManifest && datesFromManifest.length) return datesFromManifest.slice().sort();

    if (location.protocol !== 'file:') {
      try {
        const res2 = await fetch(`data_json/${ticker}.dates.json`, { cache: 'no-store' });
        if (res2.ok) {
          const djson = await res2.json();
          if (Array.isArray(djson?.dates)) return djson.dates.slice().sort();
        }
      } catch (_) { /* ignore */ }
    }

    return null;
  }

  function showMessage(text) {
    try {
      const el = document.getElementById('app-message');
      if (!el) return;
      el.textContent = text;
      el.style.display = 'block';
    } catch (e) { console.warn('showMessage failed', e); }
  }

  async function autoDiscoverTickers() {
    if (location.protocol === 'file:') {
      els.localLoadGroup.style.display = '';
      return;
    }

    const setTickers = (tickers) => {
      tickers = Array.from(new Set(tickers)).sort();
      els.stockSelect.innerHTML = '<option value="">Select a stock...</option>' + tickers.map(t => `<option value="${t}">${t}</option>`).join('');
    };

    try {
      const res = await fetch('data_json/manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const m = await res.json();
        manifestCache = m;
        if (m && Array.isArray(m.tickers) && m.tickers.length) { setTickers(m.tickers); return; }
      }
    } catch (e) { /* ignore */ }

    try {
      const res2 = await fetch('data_json/', { cache: 'no-store' });
      if (res2.ok) {
        const html = await res2.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const anchors = Array.from(doc.querySelectorAll('a[href]'));
        const tickers = [];
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          try {
            const u = new URL(href, res2.url);
            if (u.pathname.endsWith('/')) continue;
            const name = decodeURIComponent(u.pathname.split('/').pop() || '');
            if (name.toLowerCase().endsWith('.json')) {
              const base = name.replace(/\.json$/i, '');
              if (base && !tickers.includes(base)) tickers.push(base);
            } else if (name.toLowerCase().endsWith('.json.gz')) {
              const base = name.replace(/\.json\.gz$/i, '');
              if (base && !tickers.includes(base)) tickers.push(base);
            }
          } catch (err) { /* ignore bad URLs */ }
        }
        if (tickers.length) { setTickers(tickers.sort()); return; }
      }
    } catch (e) { /* ignore */ }

    setTickers(['ABNB','AMAT','NFLX','NIO','UAL']);
  }

  function updateSliderBounds(max) {
    els.slider.min = 0;
    els.slider.max = Math.max(0, (max || 0));
    els.slider.value = 0;
    els.slider.step = 1;
  }

  function computeCumulative(dayData) {
    const n = dayData.length;
    const cumV = new Array(n);
    const cumC = new Array(n);
    let v = 0, c = 0;
    for (let i = 0; i < n; i++) {
      v += (dayData[i].v || 0);
      c += (dayData[i].cnt || 0);
      cumV[i] = v;
      cumC[i] = c;
    }
    return { cumV, cumC };
  }

  function computeLogReturns(closes) {
    const logs = [];
    for (let i = 1; i < closes.length; i++) {
      const p0 = closes[i - 1];
      const p1 = closes[i];
      if (p0 && p1 && p0 > 0) logs.push(Math.log(p1 / p0));
      else logs.push(0);
    }
    return logs;
  }

  function buildMinuteSeries(dayData) {
    const times = [];
    const closes = [];
    const indexByKey = new Map();
    let currentKey = null;
    let lastClose = null;
    for (let i = 0; i < dayData.length; i++) {
      const t = dayData[i].t || '';
      const key = t.slice(0, 5); // HH:MM
      if (!key) continue;
      if (currentKey === null) currentKey = key;
      if (key !== currentKey) {
        indexByKey.set(currentKey, times.length);
        times.push(currentKey);
        closes.push(lastClose != null ? lastClose : dayData[i].c);
        currentKey = key;
      }
      lastClose = dayData[i].c;
    }
    if (currentKey !== null) {
      indexByKey.set(currentKey, times.length);
      times.push(currentKey);
      closes.push(lastClose != null ? lastClose : (dayData.length ? dayData[dayData.length - 1].c : null));
    }
    return { times, closes, indexByKey };
  }

  function stddev(arr) {
    if (!arr || arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const n = arr.length;
    const varSum = n > 1 ? arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1) : 0;
    return Math.sqrt(varSum);
  }

  function updateDisplays(idx) {
    if (idx == null || state.dayData.length === 0) {
      els.time.textContent = '—';
      els.o.textContent = '—';
      els.h.textContent = '—';
      els.l.textContent = '—';
      els.c.textContent = '—';
      els.ret.textContent = '—';
      els.vol.textContent = '—';
      els.volu.textContent = '—';
      els.cnt.textContent = '—';
      return;
    }

    idx = Math.max(0, Math.min(idx, state.dayData.length - 1));
    const pt = state.dayData[idx];
    els.time.textContent = pt.t || '—';
    els.o.textContent = fmtPrice(pt.o);
    els.h.textContent = fmtPrice(pt.h);
    els.l.textContent = fmtPrice(pt.l);
    els.c.textContent = fmtPrice(pt.c);

    const ret = state.firstClose ? ((pt.c / state.firstClose - 1) * 100) : 0;
    els.ret.textContent = `${fmtNum(ret, 2)}%`;

    let volStr = '—';
    if (idx >= 1 && state.minuteLogReturns.length > 0) {
      const minuteKey = (pt.t || '').slice(0, 5);
      const mIdx = state.minuteIndexByKey.get(minuteKey);
      if (typeof mIdx === 'number' && mIdx >= 30) {
        // Rolling 30-minute window: use last 30 minute returns (exclusive of current minute)
        const end = mIdx; // returns up to previous minute
        const start = end - 30;
        const slice = state.minuteLogReturns.slice(start, end);
        if (slice.length === 30) {
          const sd = stddev(slice);
          const ann = sd * Math.sqrt(252 * 390);
          volStr = `${fmtNum(ann * 100, 2)}%`;
        }
      }
    }
    els.vol.textContent = volStr;

    els.volu.textContent = fmtNum(state.cumVolume[idx], 0);
    els.cnt.textContent = fmtNum(state.cumCount[idx], 0);
  }

  function updateChartsAtIndex(idx) {
    if (!state.charts.price || !state.charts.volume || state.dayData.length === 0) return;
    const ax1 = state.charts.price.xAxis[0];
    const ax2 = state.charts.volume.xAxis[0];
    // Clip view to [0, idx]
    ax1.setExtremes(0, idx, false, false);
    ax2.setExtremes(0, idx, false, false);
    // Move a vertical cursor
    try { ax1.removePlotLine('cursor'); } catch (_) {}
    try { ax2.removePlotLine('cursor'); } catch (_) {}
    const line = { id: 'cursor', value: idx, color: '#0b63ff', width: 1, zIndex: 5 };
    ax1.addPlotLine(line);
    ax2.addPlotLine(line);
    state.charts.price.redraw(false);
    state.charts.volume.redraw(false);
  }

  function initChartsForDay() {
    if (!state.charts.price || !state.charts.volume) return;
    const cats = state.dayData.map(d => d.t);
    const closes = state.closes;
    const vols = state.dayData.map(x => x.v || 0);
    state.charts.price.xAxis[0].setCategories(cats, false);
    state.charts.price.series[0].setData(closes, false);
    state.charts.volume.xAxis[0].setCategories(cats, false);
    state.charts.volume.series[0].setData(vols, false);
    state.charts.price.redraw(false);
    state.charts.volume.redraw(false);
  }

  function clearCharts() {
    if (state.charts.price) {
      try { state.charts.price.xAxis[0].removePlotLine('cursor'); } catch (_) {}
      state.charts.price.xAxis[0].setCategories([], false);
      state.charts.price.series[0].setData([], false);
      state.charts.price.redraw(false);
    }
    if (state.charts.volume) {
      try { state.charts.volume.xAxis[0].removePlotLine('cursor'); } catch (_) {}
      state.charts.volume.xAxis[0].setCategories([], false);
      state.charts.volume.series[0].setData([], false);
      state.charts.volume.redraw(false);
    }
  }

  let rafId = null;
  let pendingIdx = null;
  function scheduleUpdate(idx) {
    pendingIdx = idx;
    if (rafId == null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const idxToUse = pendingIdx;
        pendingIdx = null;
        performUpdate(idxToUse);
      });
    }
  }

  function performUpdate(idx) {
    if (state.dayData.length === 0) return;
    updateDisplays(idx);
    updateChartsAtIndex(idx);
  }

  els.stockSelect.addEventListener('change', async (e) => {
    const t = e.target.value;
    state.currentTicker = t || null;
    state.currentDate = null;
    els.dateSelect.innerHTML = '<option value="">Loading dates...</option>';
    state.dayData = [];
    updateSliderBounds(0);
    updateDisplays(null);
    clearCharts();
    if (!t) {
      els.dateSelect.innerHTML = '<option value="">Select a date...</option>';
      
      return;
    }
    try {
      let dates = await loadTickerDates(t);
      if (!dates) {
        // Tip for faster date loading when a manifest is missing
        showMessage('Tip: run generate_manifest.py to speed up date loading.');
        const data = await loadTickerData(t);
        dates = Object.keys(data.days || {}).sort();
      }
      els.dateSelect.innerHTML = '<option value="">Select a date...</option>' + dates.map(d => `<option value="${d}">${d}</option>`).join('');
      
    } catch (err) {
      console.error('Failed to load dates for', t, err);
      els.dateSelect.innerHTML = '<option value="">Failed to load dates — see console</option>';
    }
  });

  els.dateSelect.addEventListener('change', async (e) => {
    const d = e.target.value;
    state.currentDate = d || null;
    state.dayData = [];
    updateSliderBounds(0);
    updateDisplays(null);
    if (!d || !state.currentTicker) return;
    try {
      const day = await loadDayData(state.currentTicker, d);
      state.dayData = day;
      state.closes = day.map(x => x.c);
      state.firstClose = state.closes.length ? state.closes[0] : null;
      // Build minutely series for more realistic intraday volatility
      const m = buildMinuteSeries(day);
      state.minuteTimes = m.times;
      state.minuteCloses = m.closes;
      state.minuteIndexByKey = m.indexByKey;
      state.minuteLogReturns = computeLogReturns(state.minuteCloses);
      const cc = computeCumulative(day);
      state.cumVolume = cc.cumV;
      state.cumCount = cc.cumC;
      state.logReturns = computeLogReturns(state.closes); // keep seconds log returns if needed elsewhere
      const maxIdx = Math.max(0, day.length - 1);
      updateSliderBounds(maxIdx);
      initChartsForDay();
      // initialize at end of day
      els.slider.value = String(maxIdx);
      performUpdate(maxIdx);
    } catch (err) {
      console.error('Failed to prepare day data', err);
    }
  });

  els.slider.addEventListener('input', () => {
    if (state.dayData.length === 0) return;
    const idx = parseInt(els.slider.value, 10) || 0;
    // schedule (throttled) updates to avoid heavy synchronous work on every input event
    scheduleUpdate(idx);
  });

  // Precision toggle handler
  els.precisionToggle?.addEventListener('change', () => {
    state.precision = els.precisionToggle.checked ? 4 : 2;
    if (state.dayData.length > 0) {
      const idx = Math.min(parseInt(els.slider.value, 10) || 0, state.dayData.length - 1);
      updateDisplays(idx);
    } else {
      updateDisplays(null);
    }
  });


  // Local folder input handling (file:// origin)
  els.loadLocalBtn?.addEventListener('click', () => { els.folderInput?.click(); });
  els.folderInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    state.localFiles.clear();
    state.localDayFiles.clear();
    for (const f of files) {
      const name = f.name || '';
      const rel = (f.webkitRelativePath || '').replace(/\\/g, '/');
      // Capture per-day files at data_json/<TICKER>/<DATE>.json
      if (/^.*\/(.+?)\/(\d{4}-\d{2}-\d{2})\.json$/i.test(rel)) {
        const m = rel.match(/^.*\/(.+?)\/(\d{4}-\d{2}-\d{2})\.json$/i);
        if (m) {
          const ticker = m[1];
          const date = m[2];
          state.localDayFiles.set(`${ticker}:${date}`, f);
        }
      }
      if (name.toLowerCase().endsWith('.json')) {
        const ticker = name.replace(/\.json$/i, '');
        state.localFiles.set(ticker, f);
      }
    }
    const tickers = Array.from(state.localFiles.keys()).sort();
    els.stockSelect.innerHTML = '<option value="">Select a stock...</option>' + tickers.map(t => `<option value="${t}">${t}</option>`).join('');

    // Clear downstream state
    els.dateSelect.innerHTML = '<option value="">Select a date...</option>';
    state.dataByTicker.clear();
    state.currentTicker = null;
    state.currentDate = null;
    state.dayData = [];
    updateSliderBounds(0);
    updateDisplays(null);
    clearCharts();
  });

  // Init - run when DOM is ready (script loaded with defer)
  function start() {
    initCharts();
    // Initialize precision toggle default
    if (els.precisionToggle) {
      els.precisionToggle.checked = state.precision === 4;
    }
    autoDiscoverTickers().catch(err => console.error('autoDiscoverTickers failed', err));
    // Hide loading overlay (if present) so the page appears responsive quickly
    try {
      const ov = document.getElementById('loading-overlay');
      if (ov) ov.style.display = 'none';
    } catch (e) {
      /* ignore */
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

})();
