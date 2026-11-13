(function () {
  "use strict";

  const embedded = window.parent !== window.self;
  const parentOrigin = window.location.origin;
  const analyticsBaseUrl = String(window.SALES_ANALYTICS_API_BASE || "/prod-api/business/analytics").replace(/\/$/, "");
  const logisticsBaseUrl = String(window.LOGISTICS_API_BASE || "/prod-api/business/logistics").replace(/\/$/, "");
  const dingTalkBaseUrl = String(window.DINGTALK_API_BASE || "/prod-api/business/alerts/dingtalk").replace(/\/$/, "");
  const fundsBaseUrl = String(window.DINGTALK_FUNDS_API_BASE || "/prod-api/business/funds/dingtalk").replace(/\/$/, "");
  const metricsBaseUrl = String(window.SALES_METRICS_API_BASE || "/prod-api/operation/metrics").replace(/\/$/, "");
  const exchangeRateBaseUrl = String(window.EXCHANGE_RATE_API_BASE || "/prod-api/business/exchange-rates").replace(/\/$/, "");
  const overseasBaseUrl = "/prod-api/business/inventory/overseas";
  let token = readCookie("Admin-Token");
  let authGeneration = 0;
  let resolveAuth;
  let authReady = new Promise(resolve => { resolveAuth = resolve; });
  const responseCache = new Map();
  const pendingRequests = new Map();
  const cacheVersions = new Map();
  const DEFAULT_CACHE_TTL = 60 * 1000;
  const REQUEST_TIMEOUT_MS = 25 * 1000;

  if (token) resolveAuth(token);

  window.addEventListener("message", event => {
    if (!embedded || event.origin !== parentOrigin || event.source !== window.parent || !event.data) return;
    if (event.data.type === "RUOYI_AUTH" && typeof event.data.token === "string") {
      setToken(event.data.token.trim());
      if (token) resolveAuth(token);
    }
  });

  if (embedded) window.parent.postMessage({ type: "RUOYI_AUTH_REQUEST" }, parentOrigin);

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const row = document.cookie.split("; ").find(item => item.startsWith(prefix));
    return row ? decodeURIComponent(row.slice(prefix.length)) : "";
  }

  async function getAuthSnapshot() {
    if (!embedded) setToken(readCookie("Admin-Token"));
    if (!token && embedded) await Promise.race([
      authReady,
      new Promise(resolve => window.setTimeout(resolve, 5000))
    ]);
    return { token, generation: authGeneration };
  }

  function setToken(value) {
    if (value === token) return;
    token = value;
    authGeneration += 1;
    if (!token) authReady = new Promise(resolve => { resolveAuth = resolve; });
    responseCache.clear();
    pendingRequests.clear();
    window.dispatchEvent(new CustomEvent("analytics-auth-changed", { detail: { generation: authGeneration } }));
  }

  function queryString(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, value);
    });
    const value = query.toString();
    return value ? `?${value}` : "";
  }

  function clonePayload(value) {
    if (value === undefined || value === null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (ignore) { return value; }
  }

  function invalidateCache(baseUrl) {
    cacheVersions.set(baseUrl, (cacheVersions.get(baseUrl) || 0) + 1);
    for (const key of responseCache.keys()) if (key.startsWith(`${baseUrl}|`)) responseCache.delete(key);
  }

  async function request(baseUrl, path, params, options = {}) {
    const auth = await getAuthSnapshot();
    const currentToken = auth.token;
    const headers = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json;charset=UTF-8";
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    const method = options.method || "GET";
    const url = `${baseUrl}${path}${method === "GET" ? queryString(params) : ""}`;
    const cacheable = method === "GET" && options.cache !== false;
    const requestGeneration = auth.generation;
    const cacheVersion = cacheVersions.get(baseUrl) || 0;
    const cacheKey = `${baseUrl}|${requestGeneration}|${cacheVersion}|${url}`;
    if (cacheable) {
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return clonePayload(cached.value);
      if (cached && cached.staleUntil > Date.now() && typeof options.onCached === "function"
          && requestGeneration === authGeneration && cacheVersion === (cacheVersions.get(baseUrl) || 0)
          && !options.signal?.aborted) {
        options.onCached(clonePayload(cached.value), { stale: true, cachedAt: cached.cachedAt });
      } else if (cached) responseCache.delete(cacheKey);
      const pending = pendingRequests.get(cacheKey);
      if (pending?.abortSignal?.aborted) pendingRequests.delete(cacheKey);
      else if (pending) return clonePayload(await pending);
    }
    const task = (async () => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (options.signal?.aborted) controller.abort();
      else options.signal?.addEventListener("abort", cancel, { once: true });
      const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method, headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          credentials: "same-origin", signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) {
          if (requestGeneration === authGeneration) {
            if (embedded) window.parent.postMessage({ type: "RUOYI_AUTH_FAILED", status: response.status }, parentOrigin);
            invalidateCache(baseUrl);
          }
          const error = new Error(response.status === 401 ? "登录状态已失效" : "当前账号没有访问权限");
          error.status = response.status; error.code = response.status; error.authFailure = true;
          throw error;
        }
        let payload;
        try { payload = await response.json(); }
        catch (error) {
          if (error?.name === "AbortError" || controller.signal.aborted) throw error;
          if (response.ok) throw new Error("接口响应格式异常，请稍后重试。");
          payload = {};
        }
        if (payload === null || payload === undefined) {
          if (response.ok) throw new Error("接口响应为空，请稍后重试。");
          payload = {};
        }
        const payloadCode = payload.code === undefined ? undefined : Number(payload.code);
        if (!response.ok || (payloadCode !== undefined && payloadCode !== 200)) {
          const error = new Error(payload.msg || payload.message || `接口请求失败（${response.status}）`);
          error.status = payloadCode === 401 || payloadCode === 403 ? payloadCode : response.status;
          error.code = payloadCode;
          error.authFailure = error.status === 401 || error.status === 403;
          if (error.authFailure && requestGeneration === authGeneration) {
            invalidateCache(baseUrl);
            if (embedded) window.parent.postMessage({ type: "RUOYI_AUTH_FAILED", status: error.status }, parentOrigin);
          }
          throw error;
        }
        return payload.data === undefined ? payload : payload.data;
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) {
          if (options.signal?.aborted) {
            const cancelled = new Error("请求已取消"); cancelled.name = "AbortError"; throw cancelled;
          }
          throw new Error(`接口响应超时（${Math.round((options.timeoutMs || REQUEST_TIMEOUT_MS) / 1000)} 秒）：${path}`);
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
        options.signal?.removeEventListener("abort", cancel);
      }
    })();
    task.abortSignal = options.signal;
    if (cacheable) pendingRequests.set(cacheKey, task);
    try {
      const value = await task;
      if (cacheable && requestGeneration === authGeneration && cacheVersion === (cacheVersions.get(baseUrl) || 0)) {
        for (const [key, cached] of responseCache) if ((cached.staleUntil || cached.expiresAt) <= Date.now()) responseCache.delete(key);
        if (responseCache.size >= 128) responseCache.delete(responseCache.keys().next().value);
        const cachedAt = Date.now(), expiresAt = cachedAt + (options.cacheTtl || DEFAULT_CACHE_TTL);
        responseCache.set(cacheKey, { value: clonePayload(value), cachedAt, expiresAt,
          staleUntil: expiresAt + Math.max(0, Number(options.staleTtl) || 0) });
      }
      if (method !== "GET") invalidateCache(baseUrl);
      return clonePayload(value);
    } finally {
      if (cacheable && pendingRequests.get(cacheKey) === task) pendingRequests.delete(cacheKey);
    }
  }

  const number = value => {
    if (value === undefined || value === null || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };

  const nullableNumber = value => {
    if (value === undefined || value === null || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };

  const pick = (source, ...keys) => {
    for (const key of keys) {
      if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
    }
    return undefined;
  };

  const trafficAliases = {
    sessions: {
      total: ["sessions_total", "sessionsTotal", "session_total", "sessionTotal", "totalSessions"],
      browser: ["sessionsBrowser", "sessionBrowser", "sessions_browser", "session_browser", "browserSessions"],
      mobile: ["sessionsMobile", "sessionMobile", "sessions_mobile", "session_mobile", "mobileSessions"],
      canonical: ["sessions", "session"]
    },
    pageViews: {
      total: ["page_views_total", "pageViewsTotal", "pageviews_total", "pageViewTotal", "totalPageViews"],
      browser: ["pageViewsBrowser", "pageViewBrowser", "page_views_browser", "browserPageViews", "page_views"],
      mobile: ["pageViewsMobile", "pageViewMobile", "page_views_mobile", "mobilePageViews"],
      canonical: ["pageViews", "pageView", "pageviews", "pv"]
    }
  };

  function trafficMetric(source, aliases) {
    const read = (keys, preferPositive = false) => {
      let first = { key: "", value: null };
      for (const key of keys) {
        const value = nullableNumber(source?.[key]);
        if (value !== null && value >= 0) {
          if (!preferPositive || value > 0) return { key, value };
          if (!first.key) first = { key, value };
        }
      }
      return first;
    };
    const total = read(aliases.total, true), canonical = read(aliases.canonical);
    let browser = read(aliases.browser);
    const mobile = read(aliases.mobile);
    // Camel-case Browser accompanies an already aggregated effective metric.
    // Keep that effective value: summing raw Browser/Mobile across mixed daily
    // Total/fallback rows can differ from the correct per-row aggregation.
    if (canonical.value > 0 && browser.key && !browser.key.includes("_")) {
      return { value: canonical.value, source: canonical.key, total, browser, mobile };
    }
    // A raw legacy sessions/session field is Browser when a total or Mobile
    // field accompanies it. Explicit Browser aliases take precedence so a
    // canonical effective sessions value is never added to Mobile again.
    if (browser.value === null && (total.key || mobile.key)) browser = canonical;
    const componentSum = (browser.value ?? 0) + (mobile.value ?? 0);
    if (total.value > 0) return { value: total.value, source: total.key, total, browser, mobile };
    if (componentSum > 0) return { value: componentSum, source: "browser+mobile", total, browser, mobile };
    if (canonical.value !== null) return { value: canonical.value, source: canonical.key, total, browser, mobile };
    if (total.value !== null) return { value: total.value, source: total.key, total, browser, mobile };
    if (browser.value !== null || mobile.value !== null) {
      return { value: componentSum, source: "browser+mobile", total, browser, mobile };
    }
    return { value: null, source: "unavailable", total, browser, mobile };
  }

  function adaptTraffic(source) {
    const sessions = trafficMetric(source, trafficAliases.sessions);
    const pageViews = trafficMetric(source, trafficAliases.pageViews);
    const raw = { ...(source?.trafficRaw || {}) };
    const canonicalBuyBox = nullableNumber(source?.buyBoxPercentage);
    const rawBuyBox = nullableNumber(source?.buy_box_percentage);
    for (const aliases of Object.values(trafficAliases)) {
      for (const key of [...aliases.total, ...aliases.browser, ...aliases.mobile, ...aliases.canonical]) {
        if (source?.[key] !== undefined && !Object.prototype.hasOwnProperty.call(raw, key)) raw[key] = source[key];
      }
    }
    if (source?.buy_box_percentage !== undefined) raw.buy_box_percentage = source.buy_box_percentage;
    return {
      sessions: sessions.value, pageViews: pageViews.value,
      sessionsBrowser: sessions.browser.value, sessionsMobile: sessions.mobile.value,
      pageViewsBrowser: pageViews.browser.value, pageViewsMobile: pageViews.mobile.value,
      sessionsTotalRaw: sessions.total.value, pageViewsTotalRaw: pageViews.total.value,
      unitConversionRateRaw: nullableNumber(source?.unitConversionRateRaw ?? source?.unitConversionRate),
      unitConversionRate: metricRatio({}, "unitConversionRate", pick(source, "volume", "salesVolume"), sessions.value),
      buyBoxPercentage: canonicalBuyBox ?? (rawBuyBox === null ? null : rawBuyBox / 100),
      buyBoxPercentageRaw: rawBuyBox,
      trafficRaw: raw,
      trafficMapping: { sessions: sessions.source, pageViews: pageViews.source, buyBox: canonicalBuyBox !== null ? "buyBoxPercentage" : rawBuyBox !== null ? "buy_box_percentage/100" : "unavailable" }
    };
  }

  const metricRatio = (source, key, numerator, denominator) => {
    const top = nullableNumber(numerator), bottom = nullableNumber(denominator);
    if (bottom === 0) return null;
    if (top !== null && bottom !== null) return top / bottom;
    return nullableNumber(source?.[key]);
  };

  function salesSummary(source) {
    const salesAmount = number(pick(source, "revenue", "salesAmount"));
    const orderCount = nullableNumber(pick(source, "orders", "orderCount"));
    const salesVolume = number(pick(source, "volume", "salesVolume"));
    const traffic = adaptTraffic(source);
    return {
      ...source,
      volume: salesVolume,
      orders: orderCount,
      revenue: salesAmount,
      adSales: number(pick(source, "adSales", "adSalesAmount")),
      adOrders: nullableNumber(source?.adOrders),
      adSalesVolume: nullableNumber(source?.adSalesVolume),
      averageOrderValue: metricRatio(source, "averageOrderValue", salesAmount, orderCount),
      unitsPerOrder: metricRatio(source, "unitsPerOrder", salesVolume, orderCount),
      netRevenue: pick(source, "netRevenue") ?? null,
      grossProfit: pick(source, "grossProfit") ?? null,
      grossMargin: pick(source, "grossMargin") ?? null,
      refundAmount: pick(source, "refundAmount") ?? null,
      refundRate: pick(source, "refundRate") ?? null,
      ...traffic,
      impressions: nullableNumber(source?.impressions),
      clicks: nullableNumber(source?.clicks),
      currencyCode: source?.currencyCode || ""
    };
  }

  function advertisingSummary(source) {
    const spend = number(pick(source, "spend", "adSpend"));
    const adSales = number(pick(source, "adSales", "adSalesAmount"));
    return {
      ...source,
      spend,
      adSales,
      roas: metricRatio(source, "roas", adSales, spend),
      acos: metricRatio(source, "acos", spend, adSales),
      impressions: nullableNumber(source?.impressions),
      clicks: nullableNumber(source?.clicks),
      ctr: metricRatio(source, "ctr", source?.clicks, source?.impressions),
      cpc: metricRatio(source, "cpc", spend, source?.clicks),
      adOrders: nullableNumber(source?.adOrders),
      adSalesVolume: nullableNumber(source?.adSalesVolume),
      adConversionRate: metricRatio({ ...source, adConversionRate: pick(source, "adConversionRate", "cvr") }, "adConversionRate", source?.adOrders, source?.clicks),
      currencyCode: source?.currencyCode || ""
    };
  }

  function adaptChange(source, mode) {
    if (mode === "sales") {
      return {
        volume: pick(source, "volume", "salesVolume"),
        orders: pick(source, "orders", "orderCount"),
        revenue: pick(source, "revenue", "salesAmount"),
        adSales: pick(source, "adSales", "adSalesAmount")
      };
    }
    return {
      spend: pick(source, "spend", "adSpend"),
      adSales: pick(source, "adSales", "adSalesAmount"),
      roas: source?.roas,
      acos: source?.acos,
      impressions: source?.impressions,
      clicks: source?.clicks,
      adOrders: source?.adOrders
    };
  }

  function adaptOptions(payload) {
    const primary = Array.isArray(payload?.sitesAndStores) ? payload.sitesAndStores : [];
    const supplemental = Array.isArray(payload?.supplementItems)
      ? payload.supplementItems
      : (Array.isArray(payload?.items) ? payload.items : []);
    const primaryByShopName = new Map(primary.map(row => [String(row.sellerName || "").trim().toUpperCase(), row]));
    const mappedSupplement = supplemental.map(row => {
      const shopName = row.shopName || row.shopId || "";
      const match = primaryByShopName.get(String(shopName).trim().toUpperCase());
      return {
        country: match?.country || row.site || "",
        mid: match?.mid,
        sid: match?.sid ?? shopName,
        sellerName: match?.sellerName || shopName || "未命名店铺",
        spu: row.spu || "",
        asin: row.asin || "",
        optionSource: "supplement"
      };
    });
    return {
      ...payload,
      latestMetricDate: payload?.latestStatsDate || payload?.latestMetricDate,
      sitesAndStores: [...primary.map(row => ({ ...row, spu: row.localSku || row.spu || "", asin: row.asin || "", optionSource: "primary" })), ...mappedSupplement]
    };
  }

  function adaptSales(payload) {
    const items = Array.isArray(payload?.products) ? payload.products : (Array.isArray(payload?.items) ? payload.items : []);
    const shopMix = Array.isArray(payload?.siteMix) ? payload.siteMix : (Array.isArray(payload?.shopMix) ? payload.shopMix : []);
    return {
      ...payload,
      summary: salesSummary(payload?.summary),
      previousSummary: salesSummary(payload?.previousSummary),
      change: adaptChange(payload?.change, "sales"),
      trend: (payload?.trend || []).map(row => ({
        ...row,
        statsDate: row.statsDate || row.metricDate,
        volume: number(pick(row, "volume", "salesVolume")),
        orders: nullableNumber(pick(row, "orders", "orderCount")),
        revenue: nullableNumber(pick(row, "revenue", "salesAmount")),
        adSales: nullableNumber(pick(row, "adSales", "adSalesAmount")),
        ...adaptTraffic(row),
        sourceMode: row.sourceMode || "primary"
      })),
      siteMix: shopMix.map(row => ({
        ...row,
        country: row.country || "",
        sellerName: row.sellerName || row.shopName || "未命名店铺",
        sid: row.sid ?? row.shopName ?? "",
        revenue: number(pick(row, "revenue", "salesAmount"))
      })),
      products: items.map(row => ({
        ...row,
        ...adaptTraffic(row),
        statsDate: row.statsDate || row.metricDate,
        localSku: row.localSku || row.spu || "",
        asin: row.asin || "",
        parentAsin: row.parentAsin || row.parentAsinCode || row.parent_asin || row.asin || "",
        dailySales: Array.isArray(row.dailySales) ? row.dailySales : null,
        productName: row.productName || (row.localSku || row.spu ? `SPU ${row.localSku || row.spu}` : "商品"),
        country: row.country || row.site || "",
        sid: row.sid ?? row.shopName ?? row.shopId ?? "",
        sellerName: row.sellerName || row.shopName || row.shopId || "未命名店铺",
        volume: number(pick(row, "volume", "salesVolume")),
        orders: nullableNumber(pick(row, "orders", "orderCount")),
        revenue: number(pick(row, "revenue", "salesAmount")),
        adVolume: number(pick(row, "adVolume", "adSalesVolume")),
        adOrders: nullableNumber(row.adOrders),
        adSales: number(pick(row, "adSales", "adSalesAmount")),
        netRevenue: pick(row, "netRevenue") ?? null,
        grossProfit: pick(row, "grossProfit") ?? null,
        sourceMode: row.sourceMode || "primary",
        currencyCode: row.currencyCode || payload?.summary?.currencyCode || "",
        source: row.source || (row.sourceMode === "supplement" ? "lingxing_profit_report_asin" : "amazon_product_stats")
      })),
      performanceProducts: (payload?.performanceProducts || []).map(row => {
        const traffic = adaptTraffic(row);
        return {
        ...row,
        ...traffic,
        localSku: row.localSku || "",
        asin: row.asin || "",
        productName: row.productName || "商品",
        sellerName: row.sellerName || "未命名店铺",
        country: row.country || "",
        volume: number(pick(row, "volume", "salesVolume")),
        orders: number(pick(row, "orders", "orderCount")),
        impressions: number(row.impressions),
        clicks: number(row.clicks),
        conversionRate: traffic.unitConversionRate,
        conversionRateRaw: nullableNumber(row.conversionRateRaw ?? row.conversionRate),
        reviewsCount: nullableNumber(row.reviewsCount),
        averageStar: nullableNumber(row.averageStar),
        bestRank: nullableNumber(row.bestRank)
        };
      })
    };
  }

  function adaptInventory(payload) {
    const numericKeys = new Set([
      "productCount", "fbaSellable", "fbmAvailable", "unsellable", "reserved", "inbound", "stockUp",
      "averageAvailableDays", "lowStockCount", "overstockCount", "availableDays", "fbmAvailableDays",
      "skuCount", "totalStock", "validStock", "badStock", "qcStock", "lockedStock", "receiving", "onway",
      "averageAge", "stockCostTotal", "averageDailySales30d", "sales30d", "salesObservedDays30d"
    ]);
    const adaptNumbers = source => Object.fromEntries(
      Object.entries(source || {}).map(([key, value]) => [key, numericKeys.has(key) ? nullableNumber(value) : value])
    );
    const amazon = payload?.amazonSnapshot || {};
    const warehouse = payload?.warehouseSnapshot || {};
    return {
      ...payload,
      amazonSnapshot: {
        ...amazon,
        summary: adaptNumbers(amazon.summary),
        products: (amazon.products || []).map(row => adaptNumbers(row))
      },
      warehouseSnapshot: {
        ...warehouse,
        summary: adaptNumbers(warehouse.summary),
        products: (warehouse.products || []).map(row => adaptNumbers(row))
      }
    };
  }

  function adaptAdvertising(payload) {
    const items = Array.isArray(payload?.products) ? payload.products : (Array.isArray(payload?.items) ? payload.items : []);
    return {
      ...payload,
      summary: advertisingSummary(payload?.summary),
      previousSummary: advertisingSummary(payload?.previousSummary),
      change: adaptChange(payload?.change, "advertising"),
      trend: (payload?.trend || []).map(row => ({
        ...row,
        statsDate: row.statsDate || row.metricDate,
        spend: nullableNumber(pick(row, "spend", "adSpend")),
        adSales: nullableNumber(pick(row, "adSales", "adSalesAmount")),
        impressions: nullableNumber(row.impressions),
        clicks: nullableNumber(row.clicks),
        adOrders: nullableNumber(row.adOrders)
      })),
      products: items.map(row => ({
        ...row,
        asin: row.asin || "",
        localSku: row.localSku || row.spu || "",
        productName: row.productName || (row.localSku || row.spu ? `SPU ${row.localSku || row.spu}` : "商品"),
        country: row.country || row.site || "",
        sid: row.sid ?? row.shopName ?? row.shopId ?? "",
        sellerName: row.sellerName || row.shopName || row.shopId || "未命名店铺",
        spend: number(pick(row, "spend", "adSpend")),
        adOrders: nullableNumber(row.adOrders),
        adVolume: number(pick(row, "adVolume", "adSalesVolume")),
        adSales: number(pick(row, "adSales", "adSalesAmount")),
        impressions: nullableNumber(row.impressions),
        clicks: nullableNumber(row.clicks),
        acos: metricRatio(row, "acos", pick(row, "spend", "adSpend"), pick(row, "adSales", "adSalesAmount")),
        roas: metricRatio(row, "roas", pick(row, "adSales", "adSalesAmount"), pick(row, "spend", "adSpend")),
        asoas: metricRatio(row, "asoas", pick(row, "adSales", "adSalesAmount"), pick(row, "revenue", "salesAmount")),
        sourceMode: row.sourceMode || "primary",
        currencyCode: row.currencyCode || payload?.summary?.currencyCode || "",
        source: row.source || (row.sourceMode === "supplement" ? "lingxing_profit_report_asin" : "amazon_product_stats")
      }))
    };
  }

  function adaptPeriods(payload, mode) {
    const periods = {};
    Object.entries(payload?.periods || {}).forEach(([key, value]) => {
      periods[key] = mode === "sales" ? salesSummary(value) : advertisingSummary(value);
    });
    return { ...payload, periods };
  }

  function adaptSeasonality(payload) {
    const source = payload && !Array.isArray(payload) ? payload : {};
    const adaptHistory = (row, index) => ({
      ...row,
      id: String(row.id ?? index),
      country: row.country ?? row.site ?? "",
      site: row.site ?? row.country ?? "",
      localSku: row.localSku ?? row.code ?? "",
      code: row.code ?? row.localSku ?? "",
      name: row.name ?? row.productName ?? row.localSku ?? row.asin ?? "",
      month: Number(row.month ?? 0),
      coverageMonths: nullableNumber(row.coverageMonths),
      baseline: nullableNumber(row.baseline),
      peak: nullableNumber(row.peak),
      peakValue: nullableNumber(row.peakValue),
      insufficient: row.insufficient === true || String(row.signal || "").includes("不足"),
      start: row.start ?? row.startDate ?? "",
      urgent: Boolean(row.urgent),
      trend: Array.isArray(row.trend) ? row.trend.map(nullableNumber) : [],
      trendLabels: Array.isArray(row.trendLabels) ? row.trendLabels : []
    });
    return {
      ...source,
      updatedAt: source.updatedAt || source.latestUpdatedAt || source.dataUpdatedAt || "",
      items: (Array.isArray(source.items) ? source.items : []).map(adaptHistory),
      histories: (Array.isArray(source.histories) ? source.histories : []).map(adaptHistory)
    };
  }

  const analyticsRequest = (path, params, options) => request(analyticsBaseUrl, path, params, {
    cacheTtl: path === '/seasonality' ? 30 * 60 * 1000 : 3 * 60 * 1000,
    staleTtl: 10 * 60 * 1000,
    ...options
  });
  const logisticsRequest = (path, params, options) => request(logisticsBaseUrl, path, params, { staleTtl: 10 * 60 * 1000, ...options });
  const dingTalkRequest = (path, params, options) => request(dingTalkBaseUrl, path, params, options);
  const exchangeRateRequest = (path, params, options) => request(exchangeRateBaseUrl, path, params, options);

  function adaptLogisticsOverview(payload) {
    const source = payload || {};
    return { ...source, summary: source.summary || source.overview || {} };
  }

  function adaptLogisticsTrend(payload) {
    const rows = Array.isArray(payload?.trend) ? payload.trend : (Array.isArray(payload?.rows) ? payload.rows : (Array.isArray(payload) ? payload : []));
    return { ...((payload && !Array.isArray(payload)) ? payload : {}), trend: rows.map(row => ({
      ...row,
      date: row.date || row.shipDate || row.statsDate || row.metricDate,
      shipmentRows: number(pick(row, "shipmentRows", "rows", "count")),
      cartons: number(row.cartons),
      actualWeight: number(row.actualWeight),
      volumetricWeight: number(row.volumetricWeight),
      chargeableWeight: number(row.chargeableWeight),
      estimatedCost: number(row.estimatedCost)
    })) };
  }

  function adaptLogisticsBreakdown(payload) {
    const source = payload || {};
    return {
      ...source,
      providerRows: Array.isArray(source.providerRows) ? source.providerRows : [],
      countryRows: Array.isArray(source.countryRows) ? source.countryRows : [],
      channelRows: Array.isArray(source.channelRows) ? source.channelRows : []
    };
  }

  function adaptLogisticsItems(payload) {
    const source = payload || {};
    const items = Array.isArray(source.items) ? source.items : (Array.isArray(source.rows) ? source.rows : (Array.isArray(source) ? source : []));
    return { ...((source && !Array.isArray(source)) ? source : {}), items: items.map(row => ({ ...row,
      cartons: number(row.cartons), actualWeight: number(row.actualWeight), volumetricWeight: number(row.volumetricWeight),
      cubicVolume: number(row.cubicVolume), totalWarehouseWeight: number(row.totalWarehouseWeight), chargeableWeight: number(row.chargeableWeight),
      unitPrice: nullableNumber(row.unitPrice)
    })) };
  }

  function adaptLogisticsAnomalies(payload) {
    const source = payload || {};
    return { ...((source && !Array.isArray(source)) ? source : {}), anomalies: Array.isArray(source.anomalies) ? source.anomalies : (Array.isArray(source.rows) ? source.rows : (Array.isArray(source) ? source : [])) };
  }

  function adaptedRequest(send, path, params, options, adapt) {
    const onCached = options?.onCached;
    return send(path, params, { ...options,
      ...(typeof onCached === "function" ? { onCached: (value, metadata) => onCached(adapt(value), metadata) } : {})
    }).then(adapt);
  }

  function overseasQueryString(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      // Empty identity fields must remain explicit for exact monthly history lookup.
      if (value !== undefined && value !== null) query.set(key, String(value));
    });
    return query.toString() ? `?${query.toString()}` : '';
  }

  // Imports and downloads share the iframe authentication snapshot used by analytics.
  async function overseasRequest(path, params, options = {}) {
    const auth = await getAuthSnapshot();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = window.setTimeout(cancel, options.timeoutMs || 60000);
    try {
      const headers = { Accept: options.download ? 'text/csv,application/json' : 'application/json' };
      if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
      const multipart = options.body instanceof FormData;
      if (options.body !== undefined && !multipart) headers['Content-Type'] = 'application/json;charset=UTF-8';
      const response = await fetch(`${overseasBaseUrl}${path}${overseasQueryString(params)}`, {
        method: options.method || 'GET', headers, credentials: 'same-origin', signal: controller.signal,
        ...(options.body === undefined ? {} : { body: multipart ? options.body : JSON.stringify(options.body) })
      });
      if (auth.generation !== authGeneration) { const error = new Error('登录身份已变更，请重新读取'); error.name = 'AbortError'; throw error; }
      const isJson = (response.headers.get('Content-Type') || '').includes('json');
      if (options.download && response.ok && !isJson) return await response.blob();
      const payload = await response.json().catch(() => ({}));
      const code = Number(payload.code ?? response.status);
      if (!response.ok || code !== 200 || options.download) {
        if ((code === 401 || code === 403) && embedded) window.parent.postMessage({ type: 'RUOYI_AUTH_FAILED', status: code }, parentOrigin);
        const error = new Error(payload.msg || payload.message || (code === 403 ? '当前账号没有海外仓访问权限' : code === 401 ? '登录状态已失效' : options.download ? '导出未返回文件，请重试' : `请求失败（${response.status}）`));
        error.status = code; throw error;
      }
      return payload.data === undefined ? payload : payload.data;
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) throw new Error('海外仓请求超时，请重试');
      throw error;
    } finally { window.clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); }
  }

  window.AnalyticsApi = {
    warehouseInventory: () => overseasRequest('/warehouse-inventory'),
    warehouseImport: files => { const body = new FormData(); Object.entries(files).forEach(([key, file]) => body.append(key, file)); return overseasRequest('/warehouse-imports', undefined, { method: 'POST', body, timeoutMs: 120000 }); },
    warehouseCommit: id => overseasRequest(`/warehouse-imports/${encodeURIComponent(id)}/commit`, undefined, { method: 'POST' }),
    overseasStatus: () => overseasRequest('/status'),
    overseasInventory: params => overseasRequest('/inventory', params),
    overseasHistory: params => overseasRequest('/history', params),
    overseasImport: (file, settings) => { const body = new FormData(); body.append('file', file); body.append('settings', JSON.stringify(settings)); return overseasRequest('/imports', undefined, { method: 'POST', body, timeoutMs: 120000 }); },
    overseasJob: id => overseasRequest(`/imports/${encodeURIComponent(id)}`),
    overseasReconfigure: (id, settings) => overseasRequest(`/imports/${encodeURIComponent(id)}/reconfigure`, undefined, { method: 'POST', body: settings }),
    overseasCommit: (id, acknowledgement) => overseasRequest(`/imports/${encodeURIComponent(id)}/commit`, undefined, { method: 'POST', body: acknowledgement }),
    overseasExport: params => overseasRequest('/export', params, { download: true, timeoutMs: 120000 }),
    baseUrl: analyticsBaseUrl,
    logisticsBaseUrl,
    dingTalkBaseUrl,
    fundsBaseUrl,
    authScopeVersion: () => {
      if (!embedded) setToken(readCookie("Admin-Token"));
      return authGeneration;
    },
    metricsBaseUrl,
    exchangeRateBaseUrl,
    status: () => analyticsRequest("/status"),
    options: () => analyticsRequest("/options").then(adaptOptions),
    sales: params => analyticsRequest("/sales", params).then(adaptSales),
    multiplatformSales: (params, options = {}) => analyticsRequest("/multiplatform-sales", params, { timeoutMs: 120000, ...options }),
    salesSummary: (params, options) => adaptedRequest(analyticsRequest, "/sales/summary", params, options, adaptSales),
    salesDetails: (params, options) => adaptedRequest(analyticsRequest, "/sales/details", params, options, adaptSales),
    seasonality: (params, options) => analyticsRequest("/seasonality", params, options).then(adaptSeasonality),
    salesPeriods: params => analyticsRequest("/sales/periods", params).then(payload => adaptPeriods(payload, "sales")),
    advertising: params => analyticsRequest("/advertising", params).then(adaptAdvertising),
    advertisingSummary: (params, options) => adaptedRequest(analyticsRequest, "/advertising/summary", params, options, adaptAdvertising),
    advertisingDetails: (params, options) => adaptedRequest(analyticsRequest, "/advertising/details", params, options, adaptAdvertising),
    clearAnalyticsCache: () => invalidateCache(analyticsBaseUrl),
    advertisingPeriods: params => analyticsRequest("/advertising/periods", params).then(payload => adaptPeriods(payload, "advertising")),
    inventory: (params, options) => adaptedRequest(analyticsRequest, "/inventory", params, options, adaptInventory),
    cashflowStatus: () => request(fundsBaseUrl, "/status", undefined, { cacheTtl: 30000 }),
    cashflowSheets: params => request(fundsBaseUrl, "/sheets", params, { cache: false }),
    cashflowFields: params => request(fundsBaseUrl, "/fields", params, { cache: false }),
    cashflowRecords: params => request(fundsBaseUrl, "/records", params, { cache: false, timeoutMs: 60000 }),
    asin: (asin, params) => analyticsRequest(`/asin/${encodeURIComponent(asin)}`, params),
    report: params => analyticsRequest("/report", params),
    changes: params => analyticsRequest("/changes", params),
    logisticsStatus: () => logisticsRequest("/status", undefined, { cache: false }),
    logisticsSync: () => logisticsRequest("/sync", undefined, { method: "POST" }),
    clearLogisticsCache: () => invalidateCache(logisticsBaseUrl),
    logisticsOverview: (params, options) => adaptedRequest(logisticsRequest, "/overview", params, options, adaptLogisticsOverview),
    logisticsTrend: (params, options) => adaptedRequest(logisticsRequest, "/trend", params, options, adaptLogisticsTrend),
    logisticsBreakdown: (params, options) => adaptedRequest(logisticsRequest, "/breakdown", params, options, adaptLogisticsBreakdown),
    logisticsItems: (params, options) => adaptedRequest(logisticsRequest, "/items", params, options, adaptLogisticsItems),
    logisticsAnomalies: (params, options) => adaptedRequest(logisticsRequest, "/anomalies", params, options, adaptLogisticsAnomalies),
    dingTalkStatus: () => dingTalkRequest("/status"),
    dingTalkTest: content => dingTalkRequest("/test", undefined, { method: "POST", body: { content } }),
    dingTalkRunRules: () => dingTalkRequest("/rules/run", undefined, { method: "POST" }),
    dingTalkRuleMetrics: () => dingTalkRequest("/rules/metrics")
    ,exchangeRateStatus: () => exchangeRateRequest("/status")
    ,exchangeRateRefresh: () => exchangeRateRequest("/refresh", undefined, { method: "POST" }).then(value => { invalidateCache(analyticsBaseUrl); return value; })
  };
})();


