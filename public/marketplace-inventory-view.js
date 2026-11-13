(function () {
  'use strict';

  const endpoint = '/prod-api/business/inventory/overseas/marketplace';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const amount = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString('zh-CN', {maximumFractionDigits: 0}) : '—';
  };
  const date = value => value ? String(value).replace('T', ' ').slice(0, 19) : '未提供';
  const days = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toLocaleString('zh-CN', {maximumFractionDigits: 1})} 天` : '—';
  };
  const risk = value => ({
    STOCKOUT: ['已缺货', 'danger'],
    CRITICAL: ['≤7天缺货风险', 'danger'],
    WATCH: ['8–14天关注', 'warn'],
    OK: ['库存正常', 'ok'],
    NO_RECENT_SALES: ['近30天无有效销量', 'muted'],
    SALES_SOURCE_UNAVAILABLE: ['销量源不可用', 'muted'],
    SALES_NOT_MATCHED: ['销量未匹配', 'muted'],
    SALES_NOT_LINKED: ['销量尚未连接', 'muted']
  }[value] || ['—', 'muted']);
  let cached = null, cachedAt = 0, pending = null;

  function token() {
    const prefix = `${encodeURIComponent('Admin-Token')}=`;
    const cookie = document.cookie.split('; ').find(row => row.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
  }

  async function load() {
    if (cached && Date.now() - cachedAt < 30000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const headers = {Accept: 'application/json'};
      const current = token();
      if (current) headers.Authorization = `Bearer ${current}`;
      const response = await fetch(endpoint, {headers, credentials: 'same-origin'});
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || Number(payload.code ?? 200) !== 200) throw new Error(payload.msg || '实时平台仓库存读取失败');
      cached = payload.data === undefined ? payload : payload.data;
      cachedAt = Date.now();
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  }

  function metric(title, value, note = '') {
    return `<div class="mp-metric"><dt>${esc(title)}</dt><dd>${amount(value)}</dd>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }

  function sourceCard(title, source, tone, detailSource) {
    if (!source) return '';
    if (source.status) return `<article class="mp-source mp-${esc(tone)}"><header><div><h4>${esc(title)}</h4><p>${esc(source.message || '等待数据口径确认')}</p></div></header></article>`;
    const summary = source.summary || {}, coverage = source.coverage || {}, rows = Array.isArray(source.rows) ? source.rows : [];
    const unmatched = source.unmatchedSummary || {};
    const sales = source.sales || {};
    const warning = Number(coverage.unmatchedRows || 0) + Number(coverage.ambiguousRows || 0);
    const salesConnected = Number(sales.sourceGroups || 0) > 0;
    const salesKnown = Number(sales.pairedUnits || 0);
    const salesUnresolved = Number(sales.unmatchedOrderLines || 0) + Number(sales.ambiguousOrderLines || 0);
    const salesNote = salesConnected ? `近${amount(sales.windowDays || 30)}天 · 截至 ${date(sales.windowEnd)}` : '销量源暂不可用';
    return `<article class="mp-source mp-${esc(tone)}">
      <header><div><h4><button type="button" class="mp-source-open" data-iw-source="${esc(detailSource)}">${esc(title)}</button></h4><p>${esc(source.quantitySemantics || '领星接口当前快照 · 已按内部 SKU 汇总')}</p></div><div class="mp-source-stamp"><b>领星实时</b><span>${esc(date(source.updatedAt))}</span></div></header>
      <dl class="mp-metrics">${metric('可售（件）', summary.sellable)}${metric('在途（件）', summary.inTransit)}${metric('不可售（件）', summary.unfulfillable)}${metric('预留（件）', summary.reserved)}${metric('近30天有效销量（件）', salesConnected ? salesKnown : '—', salesNote)}${metric('已配对销售 SKU 数', salesConnected ? sales.pairedSkuCount : '—', salesConnected ? `${amount(sales.pairedOrderLines || 0)} 条订单行` : '销量源不可用')}</dl>
      <div class="mp-meta"><span>已配对 SKU 数：${amount(rows.length)} 个</span><span>来源记录 ${amount(coverage.sourceRows)} 条</span>${warning ? `<b>待配对/歧义 ${amount(warning)} 条</b>` : '<b class="is-ok">全部来源记录已唯一配对</b>'}</div>
      <p class="mp-sales-note">${esc(sales.quantitySemantics || '')}${salesConnected && salesUnresolved ? `；另有 ${amount(salesUnresolved)} 条订单行因未配对或一对多配对，未计入 SKU 覆盖天数` : ''}</p>
      <details class="mp-details"><summary>查看 SKU 汇总（${amount(rows.length)} 个）</summary>
        ${rows.length ? `<div class="mp-table-wrap"><table><thead><tr><th>内部 SKU</th><th>可售（件）</th><th>在途（件）</th><th>近30天销量（件）</th><th>可售覆盖</th><th>风险</th><th>平台仓</th></tr></thead><tbody>${rows.slice(0, 40).map(row => { const [riskText, riskTone] = risk(row.stockRisk); return `<tr><td>${esc(row.sku)}</td><td>${amount(row.sellable)}</td><td>${amount(row.inTransit)}</td><td>${amount(row.sales30d)}</td><td>${days(row.sellableCoverageDays)}${row.withInboundCoverageDays !== null && row.withInboundCoverageDays !== undefined ? `<small>含在途 ${days(row.withInboundCoverageDays)}</small>` : ''}</td><td><span class="mp-risk mp-risk-${esc(riskTone)}">${esc(riskText)}</span></td><td title="${esc((row.warehouses || []).join('、'))}">${esc((row.warehouses || []).join('、') || '—')}</td></tr>`; }).join('')}</tbody></table></div>${rows.length > 40 ? `<p>仅展示前 40 个 SKU；实际共 ${amount(rows.length)} 个。</p>` : ''}` : '<p>暂无成功配对的 SKU。</p>'}
        ${warning ? `<p class="mp-warning">未配对库存不会计入以上 SKU 汇总：可售 ${amount(unmatched.sellable)}，在途 ${amount(unmatched.inTransit)}。</p>` : ''}
      </details>
    </article>`;
  }

  function render(container, data) {
    container.dataset.marketplaceInventoryMounted = '1';
    container.innerHTML = `<section class="mp-inventory" aria-label="实时平台仓库存"><div class="mp-heading"><div><h3>领星 · 实时平台仓库存</h3><p>按内部 SKU 汇总。可售、在途、不可售分开统计，不与 Excel 月度账面库存相加。</p></div><span>当前接口快照</span></div><div class="mp-grid">${sourceCard('沃尔玛 · 美国 WFS', data.walmartUs, 'walmart', 'walmart-live')}${sourceCard('TikTok · 美国 FBT', data.tikTokUs, 'tiktok', 'tiktok-live')}${sourceCard('TEMU · 全托管仓', data.temu, 'temu', 'temu-live')}</div><p class="mp-help">点击卡片名称可进入对应实时明细。沃尔玛加拿大仍按指定五条 Excel 明细计算；Excel 其余海外仓仍保持原有月度数据来源。</p></section>`;
  }

  function mount(container) {
    // Mark synchronously before changing child nodes. The page-wide observer
    // also observes this loading markup; without this guard it remounts the
    // same placeholder indefinitely before the fetch resolves.
    container.dataset.marketplaceInventoryMounted = 'loading';
    container.innerHTML = '<section class="mp-inventory"><div class="mp-loading">正在读取实时平台仓库存…</div></section>';
    load().then(data => { if (container.isConnected) render(container, data || {}); })
      .catch(error => { if (container.isConnected) { container.dataset.marketplaceInventoryMounted = 'error'; container.innerHTML = `<section class="mp-inventory"><div class="mp-error">实时平台仓库存暂未读取：${esc(error.message)}</div></section>`; } });
  }

  function scan() {
    document.querySelectorAll('[data-marketplace-inventory]').forEach(container => {
      if (!container.dataset.marketplaceInventoryMounted) mount(container);
    });
  }

  window.MarketplaceInventory = {load, mount};
  new MutationObserver(scan).observe(document.documentElement, {childList: true, subtree: true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, {once: true});
  else scan();
})();
