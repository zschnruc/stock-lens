/**
 * 看盘终端
 * 数据层：JSONP 对接东方财富公开行情接口（file:// 双击即可运行）
 * 详见 TECH.md
 */

/* ==================== 1. 通用 JSONP 请求器 ==================== */
function jsonp(url, callbackParam = 'cb', timeout = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = '__jp_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    };
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      cleanup();
      fn(arg);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('请求超时，请检查网络'));
    }, timeout);

    window[cbName] = (data) => finish(resolve, data);
    script.onerror = () => finish(reject, new Error('网络错误，无法连接数据服务器'));

    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    script.src = url + sep + callbackParam + '=' + encodeURIComponent(cbName);
    document.head.appendChild(script);
  });
}

/* ==================== 2. 东方财富接口封装 ==================== */
const API = {
  kline: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
  suggest: 'https://searchapi.eastmoney.com/api/suggest/get'
};
const API_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const KLINE_UT = 'fa5fd1943c7b386f172d6893dbfba10b';

/**
 * 代码推断 secid（回车直达时的兜底，搜索候选优先用接口返回的 MktNum）
 *  market.code 规则：1=沪  0=深/北交所  116=港股  105=美股(纳斯达克)
 */
function guessSecid(input) {
  const s = input.trim().toUpperCase();
  if (/^\d{6}$/.test(s)) {
    if (/^[69]/.test(s)) return '1.' + s;        // 沪市 / 科创板
    return '0.' + s;                             // 深市 / 北交所
  }
  if (/^\d{5}$/.test(s)) return '116.' + s;      // 港股
  if (/^[A-Z][A-Z.\-]*$/.test(s)) return '105.' + s; // 美股（默认纳斯达克）
  return null;
}

/** 搜索联想：返回 [{ code, name, secid, market }] */
async function searchStocks(keyword) {
  const params = new URLSearchParams({
    input: keyword, type: '14', token: API_TOKEN, count: '10'
  });
  const data = await jsonp(API.suggest + '?' + params.toString(), 'cb');
  const rows = data && data.QuotationCodeTable && data.QuotationCodeTable.Data;
  if (!Array.isArray(rows)) return [];
  return rows.map(r => {
    const mkt = r.MktNum != null ? r.MktNum : guessMarket(r.SecurityType);
    return {
      code: r.Code,
      name: r.Name,
      secid: mkt + '.' + r.Code,
      market: r.SecurityTypeName || ''
    };
  });
}

// 接口未给 MktNum 时的最后兜底
function guessMarket(secType) {
  return 0;
}

/** 获取 K 线（前复权），返回 { name, code, kline } */
async function fetchKline(secid, klt) {
  // 手动拼接，保持与已验证可用的 URL 完全一致（URLSearchParams 会把逗号编码成 %2C）
  const url = API.kline
    + '?secid=' + encodeURIComponent(secid)
    + '&ut=' + KLINE_UT
    + '&fields1=f1,f2,f3,f4,f5,f6'
    + '&fields2=f51,f52,f53,f54,f55,f56,f57,f58'
    + '&klt=' + (klt || '101')
    + '&fqt=1'
    + '&beg=0'
    + '&end=20500101'
    + '&lmt=600';
  const res = await jsonp(url);
  if (!res || !res.data || !res.data.klines || !res.data.klines.length) {
    throw new Error('未获取到K线数据，请确认代码是否正确');
  }
  const d = res.data;
  // 前复权早期价格可能为负，仅取最近 500 根
  const recent = d.klines.slice(-500);
  const kline = recent.map(line => {
    const p = line.split(',');
    return {
      time: p[0],
      open: +p[1], close: +p[2], high: +p[3], low: +p[4],
      volume: +p[5], amount: +p[6]
    };
  });
  return { name: d.name, code: d.code, kline };
}

/**
 * 演示数据：仅当真实行情接口不可达时兜底使用，界面会明确标注"演示数据"。
 * 基于 secid 做确定性伪随机，同一标的每次生成结果一致，避免刷新后走势乱跳。
 */
function generateDemoKline(secid, klt, fallbackName) {
  let seed = 0;
  for (let i = 0; i < (secid || '').length; i++) {
    seed = (seed * 31 + secid.charCodeAt(i)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const base = 20 + rand() * 180;          // 基础价位
  const drift = (rand() - 0.45) * 0.004;   // 轻微趋势
  const count = 300;
  const stepMs = (klt === '103' ? 30 : klt === '102' ? 7 : 1) * 86400000;
  const startDay = Date.now() - count * stepMs;
  const kline = [];
  let price = base;
  for (let i = 0; i < count; i++) {
    const open = price;
    const change = (rand() - 0.5) * base * 0.05 + base * drift;
    const close = Math.max(1, open + change);
    const high = Math.max(open, close) * (1 + rand() * 0.02);
    const low = Math.min(open, close) * (1 - rand() * 0.02);
    const volume = Math.floor(50000 + rand() * 900000);
    const d = new Date(startDay + i * stepMs);
    const time = d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
    kline.push({ time, open, close, high, low, volume, amount: close * volume });
    price = close;
  }
  return { name: fallbackName || '', code: (secid || '').split('.')[1] || '', kline, demo: true };
}

/* ==================== 3. 应用主体 ==================== */
const WATCHLIST_KEY = 'stock_viewer_watchlist';
const DEFAULT_WATCHLIST = [
  { secid: '1.600519', code: '600519', name: '贵州茅台' },
  { secid: '0.300750', code: '300750', name: '宁德时代' },
  { secid: '116.00700', code: '00700', name: '腾讯控股' },
  { secid: '105.AAPL', code: 'AAPL', name: '苹果' }
];

class StockApp {
  constructor() {
    this.watchlist = this.loadWatchlist();
    this.current = null;         // { secid, name, code, market }
    this.klt = '101';
    this.kline = [];
    this.suggestions = [];
    this.suggestIndex = -1;
    this.suggestTimer = null;

    this.$ = id => document.getElementById(id);
    this.initChart();
    this.bindEvents();
    this.renderWatchlist();
    // 默认展示贵州茅台
    this.openStock({ secid: '1.600519', name: '贵州茅台', code: '600519', market: '沪A' });
  }

  /* --- 本地存储 --- */
  loadWatchlist() {
    try {
      const s = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
      if (Array.isArray(s)) return s;
    } catch (e) { /* 读取异常兜底为默认列表 */ }
    return DEFAULT_WATCHLIST.slice();
  }
  saveWatchlist() {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(this.watchlist));
  }
  inWatchlist(code) {
    return this.watchlist.some(w => w.code === code);
  }
  toggleWatchlist() {
    if (!this.current) return;
    const { secid, name, code } = this.current;
    if (this.inWatchlist(code)) {
      this.watchlist = this.watchlist.filter(w => w.code !== code);
      this.toast(`已移除自选：${name}`);
    } else {
      this.watchlist.push({ secid, name, code });
      this.toast(`已加入自选：${name}`);
    }
    this.saveWatchlist();
    this.renderWatchlist();
    this.updateWatchBtn();
  }

  /* --- ECharts --- */
  initChart() {
    this.chart = echarts.init(this.$('chart'), 'dark');
    const ro = new ResizeObserver(() => this.chart.resize());
    ro.observe(this.$('chart'));
  }

  bindEvents() {
    const input = this.$('searchInput');

    input.addEventListener('input', () => {
      clearTimeout(this.suggestTimer);
      const kw = input.value.trim();
      if (!kw) { this.hideSuggest(); return; }
      this.suggestTimer = setTimeout(async () => {
        try {
          this.showSuggest(await searchStocks(kw));
        } catch (e) {
          this.hideSuggest();
        }
      }, 250);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.suggestIndex = Math.min(this.suggestIndex + 1, this.suggestions.length - 1);
        this.highlightSuggest();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.suggestIndex = Math.max(this.suggestIndex - 1, 0);
        this.highlightSuggest();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.suggestIndex >= 0 && this.suggestions[this.suggestIndex]) {
          this.pickSuggestion(this.suggestions[this.suggestIndex]);
        } else {
          const kw = input.value.trim().toUpperCase();
          const secid = guessSecid(kw);
          if (secid) {
            this.openStock({ secid, name: kw, code: kw, market: this.marketLabel(secid) });
          } else if (this.suggestions.length) {
            this.pickSuggestion(this.suggestions[0]);
          }
        }
        this.hideSuggest();
      } else if (e.key === 'Escape') {
        this.hideSuggest();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) this.hideSuggest();
    });

    this.$('addWatchBtn').addEventListener('click', () => this.toggleWatchlist());

    document.querySelectorAll('.period').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.klt = btn.dataset.period;
        if (this.current) this.loadChart(this.current.secid);
      });
    });

    ['cbMa5', 'cbMa10', 'cbMa20', 'cbVol'].forEach(id => {
      this.$(id).addEventListener('change', () => this.renderChart());
    });

    // 演示数据状态下，点击股票信息条的"刷新"按钮重试真实接口
    this.$('retryBtn').addEventListener('click', () => {
      if (this.current) this.openStock(this.current);
    });
  }

  /* --- 搜索建议 --- */
  showSuggest(list) {
    this.suggestions = list;
    this.suggestIndex = -1;
    const box = this.$('suggestBox');
    if (!list.length) { this.hideSuggest(); return; }
    box.innerHTML = list.map((s, i) => `
      <div class="suggest-item" data-i="${i}">
        <span class="s-name">${this.escapeHtml(s.name)}</span>
        <span class="s-code">${this.escapeHtml(s.code)} · ${this.escapeHtml(s.market || '')}</span>
      </div>`).join('');
    box.classList.add('show');
    box.querySelectorAll('.suggest-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.pickSuggestion(this.suggestions[+el.dataset.i]);
        this.hideSuggest();
      });
    });
  }
  hideSuggest() {
    this.$('suggestBox').classList.remove('show');
    this.suggestIndex = -1;
  }
  highlightSuggest() {
    const items = this.$('suggestBox').querySelectorAll('.suggest-item');
    items.forEach((el, i) => el.classList.toggle('active', i === this.suggestIndex));
  }
  pickSuggestion(s) {
    this.$('searchInput').value = s.name;
    this.openStock(s);
  }

  /* --- 取数：真实接口优先，失败降级为演示数据 --- */
  async getKline(stock) {
    try {
      const kd = await fetchKline(stock.secid, this.klt);
      this.isDemo = false;
      return kd;
    } catch (e) {
      this.isDemo = true;
      const kd = generateDemoKline(stock.secid, this.klt, stock.name || stock.code);
      this.toast('行情接口不可用，已显示演示数据');
      return kd;
    }
  }

  /* --- 核心：打开股票 --- */
  async openStock(stock) {
    this.current = stock;
    this.$('stockName').textContent = '加载中...';
    this.$('stockCode').textContent = stock.code || '';
    this.$('stockMarket').textContent = '正在获取数据';
    this.resetQuote();
    this.updateWatchBtn();

    const kd = await this.getKline(stock);
    const name = kd.name || stock.name || stock.code;
    this.current = { ...stock, name };
    this.$('stockName').textContent = name;
    this.$('stockCode').textContent = kd.code || stock.code || '';
    this.$('stockMarket').textContent = (stock.market || this.marketLabel(stock.secid))
      + (this.isDemo ? ' · 演示数据' : '');

    this.kline = kd.kline;
    this.renderChart();
    this.updateQuoteFromKline(kd.kline);
    this.updateWatchBtn();
  }

  async loadChart(secid) {
    const kd = await this.getKline(this.current || { secid });
    this.kline = kd.kline;
    this.renderChart();
    // 切换周期后同步修正市场标签的演示标记
    const base = (this.current && this.current.market) || this.marketLabel(secid);
    this.$('stockMarket').textContent = base + (this.isDemo ? ' · 演示数据' : '');
  }

  marketLabel(secid) {
    const p = (secid || '').split('.')[0];
    return {
      '1': '沪A', '0': '深A', '116': '港股',
      '105': '美股', '106': '美股', '107': '美股'
    }[p] || '股票';
  }

  /* --- 头部行情展示（基于最新一根 K 线，非实时） --- */
  resetQuote() {
    ['curPrice', 'priceChange', 'mOpen', 'mHigh', 'mLow', 'mPrev', 'mVol', 'mAmount']
      .forEach(id => { this.$(id).textContent = '--'; });
    this.$('curPrice').className = 'price';
    this.$('priceChange').className = 'change';
  }
  updateQuoteFromKline(kline) {
    if (!kline.length) return;
    const last = kline[kline.length - 1];
    const prev = kline[kline.length - 2] || last;
    const change = last.close - prev.close;
    const pct = prev.close ? (change / prev.close) * 100 : 0;
    const cls = change >= 0 ? 'up' : 'down';

    this.$('curPrice').textContent = last.close.toFixed(2);
    const chgEl = this.$('priceChange');
    chgEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    chgEl.className = 'change ' + cls;
    this.$('curPrice').className = 'price ' + cls;

    this.$('mOpen').textContent = last.open.toFixed(2);
    this.$('mHigh').textContent = last.high.toFixed(2);
    this.$('mLow').textContent = last.low.toFixed(2);
    this.$('mPrev').textContent = prev.close.toFixed(2);
    this.$('mVol').textContent = this.fmtNum(last.volume);
    this.$('mAmount').textContent = this.fmtMoney(last.amount);

    // 同步更新自选列表中该股的价格
    this.updateWatchPrice(this.current.code, last, prev);
  }

  fmtNum(n) {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return String(n);
  }
  fmtMoney(n) {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return String(n);
  }

  /* --- K 线绘制 --- */
  calcMA(n, data) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i].close;
      if (i >= n) sum -= data[i - n].close;
      out.push(i >= n - 1 ? (sum / n).toFixed(2) : '-');
    }
    return out;
  }

  renderChart() {
    const data = this.kline;
    if (!data || !data.length) return;
    const up = '#f0515a', down = '#2ebd85';
    const dates = data.map(d => d.time);
    const candles = data.map(d => [d.open, d.close, d.low, d.high]);
    const vols = data.map(d => ({
      value: d.volume,
      itemStyle: { color: d.close >= d.open ? up : down }
    }));

    const showVol = this.$('cbVol').checked;
    const series = [{
      name: 'K线', type: 'candlestick', data: candles,
      itemStyle: { color: up, color0: down, borderColor: up, borderColor0: down },
      xAxisIndex: 0, yAxisIndex: 0
    }];
    if (this.$('cbMa5').checked) {
      series.push({ name: 'MA5', type: 'line', data: this.calcMA(5, data), smooth: true, symbol: 'none', lineStyle: { color: '#f5a623', width: 1.3 } });
    }
    if (this.$('cbMa10').checked) {
      series.push({ name: 'MA10', type: 'line', data: this.calcMA(10, data), smooth: true, symbol: 'none', lineStyle: { color: '#4a90e2', width: 1.3 } });
    }
    if (this.$('cbMa20').checked) {
      series.push({ name: 'MA20', type: 'line', data: this.calcMA(20, data), smooth: true, symbol: 'none', lineStyle: { color: '#d975c0', width: 1.3 } });
    }
    if (showVol) {
      series.push({ name: '成交量', type: 'bar', data: vols, xAxisIndex: 1, yAxisIndex: 1 });
    }

    const H = this.$('chart').clientHeight || 500;
    const volH = 70;
    const mainH = showVol ? Math.max(120, H - volH - 90) : Math.max(120, H - 70);

    const grids = [{ left: 64, right: 24, top: 30, height: mainH }];
    const xAxes = [{
      type: 'category', data: dates, boundaryGap: true,
      axisLine: { lineStyle: { color: '#333' } },
      axisLabel: { color: '#8b98a9', fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: '#1c2230' } }
    }];
    const yAxes = [{
      scale: true, gridIndex: 0,
      axisLine: { lineStyle: { color: '#333' } },
      axisLabel: { color: '#8b98a9', fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: '#1c2230' } }
    }];

    if (showVol) {
      const volTop = 30 + mainH + 30;
      grids.push({ left: 64, right: 24, top: volTop, height: volH });
      xAxes.push({
        type: 'category', data: dates, gridIndex: 1, boundaryGap: true,
        axisLabel: { show: false }, axisLine: { lineStyle: { color: '#333' } }
      });
      yAxes.push({
        scale: true, gridIndex: 1, splitNumber: 2,
        axisLabel: { color: '#8b98a9', fontSize: 10 },
        axisLine: { lineStyle: { color: '#333' } }, splitLine: { show: false }
      });
    }

    this.chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(19,24,32,.95)',
        borderColor: '#333',
        textStyle: { color: '#e6edf3', fontSize: 12 }
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      legend: { show: false },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: grids.length > 1 ? [0, 1] : [0],
          start: 30, end: 100
        },
        {
          type: 'slider',
          xAxisIndex: grids.length > 1 ? [0, 1] : [0],
          bottom: 6, height: 18,
          borderColor: '#333', backgroundColor: '#131820',
          fillerColor: 'rgba(47,129,247,.22)',
          handleStyle: { color: '#2f81f7' },
          textStyle: { color: '#8b98a9' }
        }
      ],
      series
    }, true);
  }

  /* --- 自选股 --- */
  renderWatchlist() {
    this.$('wlCount').textContent = this.watchlist.length;
    const el = this.$('watchlist');
    if (!this.watchlist.length) {
      el.innerHTML = '<div class="empty">暂无自选股<br>在上方搜索并加入</div>';
      return;
    }
    el.innerHTML = this.watchlist.map(w => {
      const active = this.current && this.current.code === w.code ? 'active' : '';
      return `<div class="wl-item ${active}" data-secid="${this.escapeHtml(w.secid)}" data-code="${this.escapeHtml(w.code)}">
        <div class="wl-info">
          <span class="wl-name">${this.escapeHtml(w.name)}</span>
          <span class="wl-code">${this.escapeHtml(w.code)}</span>
        </div>
        <div class="wl-price">
          <span class="wl-px" id="px-${this.escapeHtml(w.code)}">--</span>
          <span class="wl-chg" id="chg-${this.escapeHtml(w.code)}">--</span>
        </div>
        <button class="wl-del" data-del="${this.escapeHtml(w.code)}" title="移除">✕</button>
      </div>`;
    }).join('');

    el.querySelectorAll('.wl-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('wl-del')) {
          e.stopPropagation();
          const code = e.target.dataset.del;
          this.watchlist = this.watchlist.filter(w => w.code !== code);
          this.saveWatchlist();
          this.renderWatchlist();
          this.updateWatchBtn();
          this.toast('已移除自选');
          return;
        }
        const w = this.watchlist.find(x => x.code === item.dataset.code);
        if (w) {
          this.$('searchInput').value = w.name;
          this.openStock(w);
        }
      });
    });
  }

  /** 打开某股后用其 K 线数据填充自选列表对应行 */
  updateWatchPrice(code, last, prev) {
    const px = this.$('px-' + code);
    const chg = this.$('chg-' + code);
    if (px) px.textContent = last.close.toFixed(2);
    if (chg) {
      const change = last.close - prev.close;
      const pct = prev.close ? (change / prev.close) * 100 : 0;
      chg.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
      chg.className = 'wl-chg ' + (change >= 0 ? 'up' : 'down');
    }
  }

  updateWatchBtn() {
    if (!this.current) return;
    const btn = this.$('addWatchBtn');
    if (this.inWatchlist(this.current.code)) {
      btn.textContent = '★ 已自选';
      btn.classList.add('in-wl');
    } else {
      btn.textContent = '☆ 加自选';
      btn.classList.remove('in-wl');
    }
  }

  /* --- 工具 --- */
  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  toast(msg) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new StockApp();
});
