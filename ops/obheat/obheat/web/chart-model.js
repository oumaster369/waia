/* Pure session and axis math for the order-book heatmap.
   The page treats this as the source of truth: a coin switch drops every
   buffer, and a late packet for another symbol cannot move the price scale. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ObheatChart = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var FOREIGN_BAND = 0.2;
  var EXTENT_BAND = 0.12;
  var EXTENT_PAD = 0.08;
  var LABEL_GAP = 14;

  function createView(partial) {
    partial = partial || {};
    return {
      epoch: 1,
      symbol: partial.symbol || "BTCUSDT",
      venue: partial.venue || "ALL",
      windowId: partial.windowId || "4h",
      columns: [],
      levels: null,
      liquidity: null,
      anchor: null,
      zoom: null,
    };
  }

  function retarget(view, patch) {
    patch = patch || {};
    view.epoch += 1;
    if (patch.symbol) view.symbol = patch.symbol;
    if (patch.venue) view.venue = patch.venue;
    if (patch.windowId) view.windowId = patch.windowId;
    view.columns = [];
    view.levels = null;
    view.liquidity = null;
    view.anchor = null;
    view.zoom = null;
    return view.epoch;
  }

  function inBand(price, anchor, band) {
    if (!(price > 0) || !(anchor > 0)) return false;
    return Math.abs(price - anchor) / anchor <= band;
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    var index = Math.min(values.length - 1, Math.max(0, Math.floor(p * (values.length - 1))));
    return values[index];
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }

  function seedAnchor(columns) {
    var mids = [];
    for (var i = 0; i < columns.length; i++) {
      if (columns[i].mid > 0) mids.push(columns[i].mid);
    }
    return median(mids);
  }

  function keepPrices(rows, priceOf, anchor) {
    var out = [];
    for (var i = 0; i < (rows || []).length; i++) {
      var price = priceOf(rows[i]);
      if (price > 0 && !inBand(price, anchor, FOREIGN_BAND)) continue;
      out.push(rows[i]);
    }
    return out;
  }

  function sanitizeColumn(column, symbol, venue, anchor) {
    if (!column) return null;
    var colSymbol = column.symbol;
    var colVenue = column.venue;
    if (!colSymbol || colSymbol !== symbol) return null;
    if (colVenue && venue && colVenue !== venue) return null;
    if (anchor > 0 && column.mid > 0 && !inBand(column.mid, anchor, FOREIGN_BAND)) return null;
    var next = {
      ts: column.ts,
      venue: colVenue,
      symbol: colSymbol,
      book_ok: column.book_ok,
      mid: column.mid,
      step: column.step,
      visible: column.visible || null,
      bids: column.bids || [],
      asks: column.asks || [],
      trades: column.trades || [],
      liquidations: column.liquidations || [],
      ohlc: column.ohlc || null,
      _n: column._n || 1,
    };
    if (anchor > 0) {
      next.bids = keepPrices(next.bids, function (row) { return row[0]; }, anchor);
      next.asks = keepPrices(next.asks, function (row) { return row[0]; }, anchor);
      next.trades = keepPrices(next.trades, function (row) { return row.price; }, anchor);
      next.liquidations = keepPrices(next.liquidations, function (row) { return row.price; }, anchor);
      if (next.visible && (!inBand(next.visible[0], anchor, FOREIGN_BAND) || !inBand(next.visible[1], anchor, FOREIGN_BAND))) {
        next.visible = null;
      }
      if (next.ohlc && next.ohlc.some(function (price) { return price > 0 && !inBand(price, anchor, FOREIGN_BAND); })) {
        next.ohlc = next.mid > 0 ? [next.mid, next.mid, next.mid, next.mid] : null;
      }
    }
    return next;
  }

  function cloneColumn(col, ts) {
    return {
      ts: ts,
      venue: col.venue,
      symbol: col.symbol,
      book_ok: col.book_ok,
      mid: col.mid,
      step: col.step,
      visible: col.visible || null,
      bids: (col.bids || []).map(function (row) { return row.slice(); }),
      asks: (col.asks || []).map(function (row) { return row.slice(); }),
      trades: (col.trades || []).slice(),
      liquidations: (col.liquidations || []).slice(),
      ohlc: col.ohlc ? col.ohlc.slice() : (col.mid > 0 ? [col.mid, col.mid, col.mid, col.mid] : null),
      _n: col._n || 1,
    };
  }

  function addSide(map, rows) {
    for (var i = 0; i < (rows || []).length; i++) {
      var row = rows[i];
      var slot = map.get(row[0]) || [0, 0];
      slot[0] += row[1] || 0;
      slot[1] += row[2] || 0;
      map.set(row[0], slot);
    }
  }

  function mergeColumns(into, col) {
    if (into.symbol !== col.symbol) return into;
    var bids = new Map();
    var asks = new Map();
    addSide(bids, into.bids);
    addSide(bids, col.bids);
    addSide(asks, into.asks);
    addSide(asks, col.asks);
    into.bids = Array.from(bids.entries()).sort(function (a, b) { return a[0] - b[0]; }).map(function (pair) {
      return [pair[0], pair[1][0], pair[1][1]];
    });
    into.asks = Array.from(asks.entries()).sort(function (a, b) { return a[0] - b[0]; }).map(function (pair) {
      return [pair[0], pair[1][0], pair[1][1]];
    });
    into._n = (into._n || 1) + 1;
    if (col.mid > 0) into.mid = col.mid;
    into.book_ok = into.book_ok || col.book_ok;
    into.trades = (into.trades || []).concat(col.trades || []);
    into.liquidations = (into.liquidations || []).concat(col.liquidations || []);
    var left = into.ohlc;
    var right = col.ohlc || (col.mid > 0 ? [col.mid, col.mid, col.mid, col.mid] : null);
    if (left && right) into.ohlc = [left[0], Math.max(left[1], right[1]), Math.min(left[2], right[2]), right[3]];
    else if (right) into.ohlc = right.slice();
    if (into.visible && col.visible) {
      into.visible = [Math.min(into.visible[0], col.visible[0]), Math.max(into.visible[1], col.visible[1])];
    } else {
      into.visible = into.visible || col.visible || null;
    }
    return into;
  }

  function pushColumn(view, column, stepS, keep) {
    var bin = Math.floor(column.ts / stepS) * stepS;
    var last = view.columns[view.columns.length - 1];
    if (!last || last.ts !== bin || last.symbol !== column.symbol) view.columns.push(cloneColumn(column, bin));
    else mergeColumns(last, column);
    if (view.columns.length > keep) view.columns.splice(0, view.columns.length - keep);
    if (column.mid > 0) view.anchor = column.mid;
  }

  function acceptHeatmap(view, epoch, payload) {
    if (!view || epoch !== view.epoch || !payload) return false;
    if (payload.symbol !== view.symbol) return false;
    if (payload.venue && payload.venue !== view.venue) return false;
    var tagged = [];
    var raw = payload.columns || [];
    for (var i = 0; i < raw.length; i++) {
      var col = raw[i];
      if (!col || col.symbol !== view.symbol) continue;
      if (col.venue && col.venue !== view.venue) continue;
      tagged.push(col);
    }
    var anchor = seedAnchor(tagged);
    var columns = [];
    for (var j = 0; j < tagged.length; j++) {
      var clean = sanitizeColumn(tagged[j], view.symbol, view.venue, anchor);
      if (clean) columns.push(cloneColumn(clean, clean.ts));
    }
    view.columns = columns;
    view.anchor = seedAnchor(columns) || anchor;
    view.zoom = null;
    return true;
  }

  function acceptLive(view, epoch, payload, stepS, keep) {
    if (!view || epoch !== view.epoch || !payload || !payload.column) return false;
    var column = payload.column;
    var symbol = payload.symbol || column.symbol;
    var venue = payload.venue || column.venue;
    if (symbol !== view.symbol) return false;
    if (venue && venue !== view.venue) return false;
    var tagged = Object.assign({}, column, {symbol: column.symbol || symbol, venue: column.venue || venue});
    var anchor = view.anchor || (tagged.mid > 0 ? tagged.mid : null);
    var clean = sanitizeColumn(tagged, view.symbol, view.venue, anchor);
    if (!clean) return false;
    if (!(view.anchor > 0) && clean.mid > 0) view.anchor = clean.mid;
    pushColumn(view, clean, stepS, keep);
    return true;
  }

  function acceptTagged(view, epoch, payload, field) {
    if (!view || epoch !== view.epoch || !payload) return false;
    if (payload.symbol && payload.symbol !== view.symbol) return false;
    if (payload.venue && payload.venue !== view.venue) return false;
    view[field] = payload;
    var last = payload.last || payload.mid;
    if (last > 0) view.anchor = last;
    return true;
  }

  function acceptLevels(view, epoch, payload) {
    return acceptTagged(view, epoch, payload, "levels");
  }

  function acceptLiquidity(view, epoch, payload) {
    return acceptTagged(view, epoch, payload, "liquidity");
  }

  function priceExtent(columns, anchor) {
    var last = anchor > 0 ? anchor : seedAnchor(columns || []);
    var prices = [];
    var foreign = 0;
    function consider(price) {
      if (!(price > 0)) return;
      if (!(last > 0)) {
        prices.push(price);
        return;
      }
      if (!inBand(price, last, EXTENT_BAND)) {
        foreign += 1;
        return;
      }
      prices.push(price);
    }
    for (var i = 0; i < (columns || []).length; i++) {
      var col = columns[i];
      consider(col.mid);
      for (var b = 0; b < (col.bids || []).length; b++) consider(col.bids[b][0]);
      for (var a = 0; a < (col.asks || []).length; a++) consider(col.asks[a][0]);
      for (var t = 0; t < (col.trades || []).length; t++) consider(col.trades[t].price);
      for (var q = 0; q < (col.liquidations || []).length; q++) consider(col.liquidations[q].price);
      if (col.ohlc) for (var o = 0; o < col.ohlc.length; o++) consider(col.ohlc[o]);
    }
    if (!prices.length) {
      if (last > 0) return {min: last * 0.99, max: last * 1.01, last: last, foreign: foreign};
      return {min: 0, max: 1, last: null, foreign: foreign};
    }
    prices.sort(function (a, b) { return a - b; });
    var min = percentile(prices, 0.01);
    var max = percentile(prices, 0.99);
    if (!(max > min)) {
      var slack = last > 0 ? last * 0.002 : 1;
      min -= slack;
      max += slack;
    }
    var span = max - min;
    min -= span * EXTENT_PAD;
    max += span * EXTENT_PAD;
    if (last > 0) {
      if (last < min) min = last - span * 0.05;
      if (last > max) max = last + span * 0.05;
    }
    return {min: min, max: max, last: last, foreign: foreign};
  }

  function countForeignPoints(columns, symbol, anchor) {
    var count = 0;
    for (var i = 0; i < (columns || []).length; i++) {
      var col = columns[i];
      if (col.symbol && col.symbol !== symbol) count += 1;
      var prices = [];
      if (col.mid > 0) prices.push(col.mid);
      for (var b = 0; b < (col.bids || []).length; b++) prices.push(col.bids[b][0]);
      for (var a = 0; a < (col.asks || []).length; a++) prices.push(col.asks[a][0]);
      for (var t = 0; t < (col.trades || []).length; t++) if (col.trades[t].price > 0) prices.push(col.trades[t].price);
      for (var q = 0; q < (col.liquidations || []).length; q++) if (col.liquidations[q].price > 0) prices.push(col.liquidations[q].price);
      for (var p = 0; p < prices.length; p++) {
        if (anchor > 0 && !inBand(prices[p], anchor, FOREIGN_BAND)) count += 1;
      }
    }
    return count;
  }

  function placeWallLabels(walls, last, yOf, limitEachSide) {
    var cap = limitEachSide == null ? 3 : limitEachSide;
    function pick(side, pred) {
      return (walls || []).filter(function (wall) {
        return wall && wall.side === side && pred(wall.price);
      }).sort(function (a, b) {
        return (b.usd || 0) - (a.usd || 0);
      }).slice(0, cap);
    }
    var chosen = pick("ask", function (price) { return price > last; }).concat(
      pick("bid", function (price) { return price < last; })
    );
    var placed = [];
    var ys = [];
    for (var i = 0; i < chosen.length; i++) {
      var y = yOf(chosen[i].price);
      var hit = false;
      for (var k = 0; k < ys.length; k++) {
        if (Math.abs(ys[k] - y) < LABEL_GAP) { hit = true; break; }
      }
      if (hit) continue;
      ys.push(y);
      placed.push({side: chosen[i].side, price: chosen[i].price, usd: chosen[i].usd, y: y});
    }
    return placed;
  }

  function bucketCandles(columns, target) {
    var cols = columns || [];
    var n = cols.length;
    if (!n) return [];
    var groups = Math.max(1, Math.min(n, target || n));
    var out = [];
    for (var g = 0; g < groups; g++) {
      var a = Math.floor(g * n / groups);
      var b = Math.max(a + 1, Math.floor((g + 1) * n / groups));
      var open = null;
      var high = null;
      var low = null;
      var close = null;
      for (var i = a; i < b; i++) {
        var col = cols[i];
        var bar = col.ohlc && col.ohlc.length === 4 ? col.ohlc : (col.mid > 0 ? [col.mid, col.mid, col.mid, col.mid] : null);
        if (!bar) continue;
        if (open == null) open = bar[0];
        high = high == null ? bar[1] : Math.max(high, bar[1]);
        low = low == null ? bar[2] : Math.min(low, bar[2]);
        close = bar[3];
      }
      if (open == null) continue;
      out.push({i: (a + b - 1) / 2, open: open, high: high, low: low, close: close});
    }
    return out;
  }

  // Rank in [0, 1] among the visible window. Ties share the middle of their
  // run, so a flat book does not all land on yellow.
  function percentileRank(sorted, value) {
    var n = sorted.length;
    if (!n || !(value > 0)) return 0;
    var lo = 0;
    var hi = n;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    var endLo = lo;
    var endHi = n;
    while (endLo < endHi) {
      var endMid = (endLo + endHi) >> 1;
      if (sorted[endMid] <= value) endLo = endMid + 1;
      else endHi = endMid;
    }
    return (lo + (endLo - lo) * 0.5) / n;
  }

  // floor is the brightness slider as a percentile (0.50 → p50 is still dark).
  // Yellow is the top of the window (p98), not a log dollar cutoff.
  function heatTone(rank, floor) {
    var lo = floor == null ? 0.5 : floor;
    if (!(lo >= 0)) lo = 0;
    if (lo > 0.95) lo = 0.95;
    var hi = 0.98;
    if (!(rank > lo)) return 0;
    if (rank >= hi) return 1;
    return (rank - lo) / (hi - lo);
  }

  function usdFromScale(encoded, maxUsd) {
    if (!(encoded > 0)) return 0;
    if (!(maxUsd > 0)) return encoded;
    var denom = Math.log10(1 + maxUsd);
    if (!(denom > 0)) return 0;
    return Math.pow(10, (encoded / 65535) * denom) - 1;
  }

  function makeCols(symbol, mid, n) {
    var cols = [];
    for (var i = 0; i < n; i++) {
      var price = mid * (1 + (i - n / 2) * 0.0003);
      cols.push({
        ts: 1700000000 + i * 15,
        symbol: symbol,
        venue: "ALL",
        book_ok: true,
        mid: price,
        step: symbol === "BTCUSDT" ? 10 : 0.5,
        bids: [[price * 0.998, 0, 1e6], [price * 0.995, 0, 5e5]],
        asks: [[price * 1.002, 0, 8e5]],
        trades: [],
        liquidations: [],
        ohlc: [price * 0.999, price * 1.001, price * 0.998, price],
      });
    }
    return cols;
  }

  function checkAxis(view, expected, errors) {
    var extent = priceExtent(view.columns, view.anchor);
    var last = extent.last;
    if (!(last > 0)) {
      errors.push("no last price");
      return;
    }
    var ratio = (extent.max - extent.min) / last;
    if (ratio > 0.25) errors.push("axis ratio " + ratio.toFixed(3) + " last " + last + " expected ~" + expected);
    if (extent.min < last * 0.8 || extent.max > last * 1.2) errors.push("axis left the coin " + JSON.stringify(extent));
    if (Math.abs(last - expected) / expected > 0.08) errors.push("last " + last + " vs " + expected);
  }

  function selfTest() {
    var errors = [];
    function check(cond, msg) { if (!cond) errors.push(msg); }

    var restored = usdFromScale(65535, 1e6);
    check(Math.abs(restored - 1e6) / 1e6 < 1e-6, "usd scale top");
    check(usdFromScale(0, 1e6) === 0, "usd scale zero");

    var ladder = [];
    for (var s = 1; s <= 100; s++) ladder.push(s);
    check(heatTone(percentileRank(ladder, 50), 0.5) === 0, "p50 stays dark");
    check(heatTone(percentileRank(ladder, 98), 0.5) > 0.95, "p98 is yellow");
    check(heatTone(percentileRank(ladder, 90), 0.5) < 0.9, "p90 is not saturated");
    var rank90 = percentileRank(ladder, 90);
    check(heatTone(rank90, 0.85) < heatTone(rank90, 0.5), "slider lifts the dark floor");
    var flat = [];
    for (var f = 0; f < 80; f++) flat.push(250000);
    check(heatTone(percentileRank(flat, 250000), 0.5) === 0, "flat book does not go yellow");
    var skewed = [];
    for (var u = 0; u < 98; u++) skewed.push(800000);
    skewed.push(1.5e8, 1.5e8);
    skewed.sort(function (a, b) { return a - b; });
    check(heatTone(percentileRank(skewed, 800000), 0.5) === 0, "typical level stays dark");
    check(heatTone(percentileRank(skewed, 1.5e8), 0.5) === 1, "wall is yellow");

    var dirty = makeCols("ETHUSDT", 2650, 30);
    dirty[2].bids.push([87000, 0, 5e7]);
    var clipped = priceExtent(dirty, 2650);
    check(clipped.foreign >= 1, "foreign print counted");
    check(clipped.max < 2650 * 1.2 && clipped.min > 2650 * 0.8, "extent stayed on ETH " + JSON.stringify(clipped));

    var btc = makeCols("BTCUSDT", 85200, 40);
    var eth = makeCols("ETHUSDT", 2650, 40);
    var ethPoison = makeCols("ETHUSDT", 2650, 40);
    ethPoison[5].bids.push([86990, 0, 9e7]);
    ethPoison[6].mid = 88850;
    ethPoison[6].bids = [[87000, 0, 1e8]];
    ethPoison[6].asks = [[88000, 0, 1e8]];

    var view = createView({symbol: "BTCUSDT", venue: "ALL", windowId: "4h"});
    check(acceptHeatmap(view, view.epoch, {symbol: "BTCUSDT", venue: "ALL", columns: btc}), "initial btc");
    checkAxis(view, 85200, errors);
    check(countForeignPoints(view.columns, "BTCUSDT", view.anchor) === 0, "btc clean");

    var order = ["ETHUSDT", "BTCUSDT", "ETHUSDT", "BTCUSDT", "ETHUSDT", "BTCUSDT"];
    for (var s = 0; s < order.length; s++) {
      var symbol = order[s];
      view.zoom = {i0: 1, i1: 4, p0: 1, p1: 9};
      var epoch = retarget(view, {symbol: symbol});
      var previous = symbol === "ETHUSDT" ? btc : eth;
      check(view.columns.length === 0, "cleared columns " + symbol);
      check(view.anchor == null && view.levels == null && view.liquidity == null && view.zoom == null, "cleared buffers " + symbol);
      check(!acceptHeatmap(view, epoch - 1, {symbol: previous[0].symbol, venue: "ALL", columns: previous}), "stale heatmap " + symbol);
      check(!acceptLive(view, epoch - 1, {symbol: previous[0].symbol, venue: "ALL", column: previous[0]}, 15, 100), "stale live " + symbol);
      check(!acceptLive(view, epoch, {symbol: previous[0].symbol, venue: "ALL", column: previous[previous.length - 1]}, 15, 100), "foreign live " + symbol);
      check(!acceptLevels(view, epoch, {symbol: previous[0].symbol, venue: "ALL", mid: previous[0].mid}), "foreign levels " + symbol);
      check(!acceptLiquidity(view, epoch, {symbol: previous[0].symbol, venue: "ALL", last: previous[0].mid, walls: []}), "foreign liquidity " + symbol);
      check(view.columns.length === 0 && view.levels == null && view.liquidity == null, "foreign packets dropped " + symbol);
      var incoming = symbol === "ETHUSDT" ? ethPoison : btc;
      check(acceptHeatmap(view, epoch, {symbol: symbol, venue: "ALL", columns: incoming}), "accept " + symbol);
      check(!acceptLive(view, epoch, {symbol: previous[0].symbol, venue: "ALL", column: previous[0]}, 15, 200), "late foreign " + symbol);
      var home = symbol === "ETHUSDT" ? 2655 : 85200;
      var sneak = {
        ts: incoming[incoming.length - 1].ts,
        symbol: symbol,
        venue: "ALL",
        book_ok: true,
        mid: symbol === "ETHUSDT" ? 2660 : 85300,
        bids: [[symbol === "ETHUSDT" ? 87000 : 2600, 0, 1e8], [home, 0, 1e6]],
        asks: [],
        trades: [{price: symbol === "ETHUSDT" ? 86990 : 2641, usd: 10}],
        liquidations: [{price: symbol === "ETHUSDT" ? 88000 : 2637}],
      };
      check(acceptLive(view, epoch, {symbol: symbol, venue: "ALL", column: sneak}, 15, 200), "live same symbol " + symbol);
      checkAxis(view, symbol === "ETHUSDT" ? 2650 : 85200, errors);
      var foreign = countForeignPoints(view.columns, symbol, view.anchor);
      check(foreign === 0, "no foreign points " + symbol + " n=" + foreign);
      check(acceptLevels(view, epoch, {symbol: symbol, venue: "ALL", mid: view.anchor, measured: {walls: []}}), "levels " + symbol);
      check(view.levels && view.levels.symbol === symbol, "levels symbol " + symbol);
    }

    var epochVenue = retarget(view, {venue: "BINANCE"});
    check(view.columns.length === 0 && view.venue === "BINANCE", "venue clear");
    check(!acceptHeatmap(view, epochVenue, {symbol: view.symbol, venue: "ALL", columns: btc}), "wrong venue dropped");
    var epochWindow = retarget(view, {windowId: "1h", venue: "ALL", symbol: "BTCUSDT"});
    check(view.windowId === "1h" && view.columns.length === 0 && view.symbol === "BTCUSDT", "window clear");
    check(epochWindow !== epochVenue, "epoch advanced");

    var spread = [];
    for (var i = 0; i < 8; i++) {
      spread.push({side: "ask", price: 110 + i * 5, usd: 800 - i * 10});
      spread.push({side: "bid", price: 90 - i * 5, usd: 700 - i * 10});
    }
    var far = placeWallLabels(spread, 100, function (price) { return (130 - price) * 4; }, 3);
    check(far.filter(function (w) { return w.side === "ask"; }).length === 3, "three asks");
    check(far.filter(function (w) { return w.side === "bid"; }).length === 3, "three bids");
    var pile = [];
    for (var j = 0; j < 6; j++) {
      pile.push({side: "ask", price: 101 + j * 0.01, usd: 500 - j});
      pile.push({side: "bid", price: 99 - j * 0.01, usd: 400 - j});
    }
    var crowded = placeWallLabels(pile, 100, function (price) { return (110 - price) * 10; }, 3);
    check(crowded.filter(function (w) { return w.side === "ask"; }).length <= 3, "ask cap");
    check(crowded.filter(function (w) { return w.side === "bid"; }).length <= 3, "bid cap");
    for (var a = 0; a < crowded.length; a++) {
      for (var b = a + 1; b < crowded.length; b++) {
        check(Math.abs(crowded[a].y - crowded[b].y) >= LABEL_GAP, "label overlap");
      }
    }

    var candles = bucketCandles(btc, 10);
    check(candles.length === 10, "candle buckets");
    check(candles[0].high >= candles[0].open && candles[0].low <= candles[0].open, "ohlc order");

    return {ok: errors.length === 0, errors: errors, switches: order.length};
  }

  return {
    createView: createView,
    retarget: retarget,
    acceptHeatmap: acceptHeatmap,
    acceptLive: acceptLive,
    acceptLevels: acceptLevels,
    acceptLiquidity: acceptLiquidity,
    priceExtent: priceExtent,
    countForeignPoints: countForeignPoints,
    placeWallLabels: placeWallLabels,
    bucketCandles: bucketCandles,
    usdFromScale: usdFromScale,
    percentileRank: percentileRank,
    heatTone: heatTone,
    selfTest: selfTest,
  };
});

if (typeof module !== "undefined" && module.exports && typeof require === "function" && require.main === module) {
  var result = module.exports.selfTest();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("ok switches=" + result.switches);
}
