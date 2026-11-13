(function(){
  'use strict';

  const liveData = {
    multiplatform: null,
    status: null,
    options: null,
    sales: null,
    advertising: null,
    inventory: null,
    logisticsStatus: null,
    logisticsOverview: null,
    logisticsTrend: null,
    logisticsBreakdown: null,
    logisticsItems: null,
    logisticsAnomalies: null,
    seasonality: null,
    exchangeRate: null
  };

  const loadState = {
    multiplatform: {phase:'idle', error:''},
    sales: {phase:'idle', error:''},
    advertising: {phase:'idle', error:''},
    inventory: {phase:'idle', error:''},
    seasonality: {phase:'idle', error:''},
    logistics: {phase:'idle', error:''}
  };
  const demoModules = new Set();
  const demoReasons = {};

  const viewLoaders = {overview:['multiplatform'],sales:['multiplatform'],'amazon-profit':['sales'],products:['sales'],ads:['advertising','sales'],inventory:['inventory']};
  const periodKeys = ['today','week','month','lastMonth','last30','last90'];
  let salesToken = 0;
  let multiplatformToken = 0;
  let advertisingToken = 0;
  let inventoryToken = 0;
  let dataReadController = new AbortController();
  let logisticsReadController = null;
  const loadedModuleScopes = {};
  const pendingModuleScopes = {};
  const loadedModuleAt = {};
  const moduleAttemptAt = {};
  const logisticsPartState = {};
  let progressivePaintFrame = null;
  let pendingDataPaint = null;
  let seasonalityToken = 0;
  let logisticsToken = 0;
  let logisticsStatusToken = 0;
  let logisticsLoadedScope = '';
  let logisticsDrawerGeneration = 0;
  let logisticsAllDates = false;
  const logisticsSyncState={initiating:false,running:false,uncertain:false,paused:false,checking:false,refreshing:false,error:'',message:'',jobId:'',attemptKey:'',observedRunning:false,failures:0,polls:0,timer:null,generation:0,inFlight:false,completedJobs:new Set()};
  const inventorySeason={open:false,query:'',selectedKey:'',selectedProduct:null,scopeKey:'',month:null};
  const seasonProductFields=['country','mid','sid','sellerName','localSku','asin'];
  let bootstrapDone = false;
  let scopeTouched = false;
  let dataScopeVersion = 0;
  // 销售、广告和利润统一显示人民币；原币种只在明细抽屉中保留。
  const unifiedAmountUnit = 'CNY';

  const routeNames = {
    'amazon-profit':'Amazon 利润明细',
    overview:'经营驾驶舱',sales:'销售与利润',products:'流量与转化',ads:'广告投放',inventory:'库存与备货',
    fulfillment:'仓储发货',cashflow:'回款与资金',data:'数据状态',replenishment:'采购与补货建议'
  };

  const metricFormulas = {
    '历史平均运输天数':'当前物流商与国家范围内，全部历史签收天数正值合计 ÷ 历史签收样本数，不受顶部日期筛选限制。优先使用公式数值结果；缺失且为同一行K−A日期减法时回算。每条来源记录等权计算，不按箱数加权。负数、0、点号及空值不参与均值；建议在同国家、同渠道比较，不代表承诺时效',
    '平均运输天数':'当前物流商与国家范围内，全部历史签收天数正值合计 ÷ 历史签收样本数，不受顶部日期筛选限制。优先使用公式数值结果；缺失且为同一行K−A日期减法时回算。每条来源记录等权计算，不按箱数加权。负数、0、点号及空值不参与均值；建议在同国家、同渠道比较，不代表承诺时效',
    '近30天日均销量':'截至库存快照日的近30个自然日内，销量合计 ÷ 有销量记录的实际天数；零销量记录计入，缺失日期不补零',
    '销售额':'优先汇总「销售额」；回算时为 FBA销售额 + FBM销售额 + 买家运费 − 促销折扣 − 销售退款额 − 运费退款额',
    '商品销售额':'按 MSKU 汇总「销售额」',
    '实际销售数量':'销量 − 退货量（可售）− 退货量（不可售）',
    '退款率':'退款量 ÷ 销量 × 100%',
    '退货率':'（退货量（可售）+ 退货量（不可售））÷ 销量 × 100%',
    '广告费':'SP广告 + SD广告 + SB广告 + SBV广告',
    '广告花费':'SP广告 + SD广告 + SB广告 + SBV广告',
    '广告销售额':'SP广告销售额 + SD广告销售额 + SB广告销售额 + SBV广告销售额',
    '广告销量':'SP广告销量 + SD广告销量 + SB广告销量 + SBV广告销量',
    '实际毛利润':'平台收入 − 平台费 − 发货费 − 广告费 − 推广费 − 仓储费 − 平台其他费 − 其他订单费用 − 调整费用 − 税费 − 产品测评费用 − 店铺费用 − 商品及物流成本',
    '毛利额':'汇总「实际毛利润」',
    '毛利率':'实际毛利润 ÷ 销售额 × 100%',
    'ROI':'实际毛利润 ÷ 合计成本 × 100%',
    'ACOS':'广告费 ÷ 广告销售额 × 100%',
    'TACOS':'广告费 ÷ 销售额 × 100%',
    '广告 TACOS':'广告费 ÷ 销售额 × 100%',
    'ROAS':'广告销售额 ÷ 广告费',
    '广告预算使用率':'实际广告花费 ÷ 广告预算 × 100%',
    '建议补货量':'日均销量 ×（补货周期 + 安全库存天数）− 在库 − 在途',
    '可售天数':'当前可售库存 ÷ 近 30 日日均销量',
    '可售天数 DOH':'当前可售库存 ÷ 近 30 日日均销量',
    '回款率':'已实际到账净额 ÷ 应收净额 × 100%',
    '订单数':'汇总 amazon_product_stats.order_items',
    '商品转化率':'销量 ÷ Sessions × 100%',
    'Buy Box':'所选范围内 buy_box_percentage 的平均值',
    '客单价':'销售额 ÷ 订单数',
    '净收入':'平台结算净收入合计',
    '退款金额':'销售退款额 + 运费退款额',
    '广告销量':'SP + SD + SB + SBV 广告销量合计',
    '广告订单数':'SP + SD + SB + SBV 广告订单数合计',
    '曝光量':'广告曝光次数合计',
    '展示量':'当前范围每日 impressions 合计，仅包含已提供的日记录，不代表商品全部访问次数',
    '点击量':'广告点击次数合计',
    '点击率 CTR':'点击量 ÷ 展示量 × 100%；日字段不完整或展示量为 0 时不计算',
    'CTR':'点击量 ÷ 曝光量 × 100%',
    'CPC':'广告花费 ÷ 点击量',
    '广告转化率':'广告订单数 ÷ 点击量 × 100%',
    '广告花费占比':'广告花费 ÷ 销售额 × 100%',
    '广告销售额占比':'广告销售额 ÷ 销售额 × 100%'
  };

  const sourceFields = [
    ['日期 / 月份','时间维度','P0','amazon_product_stats','支持自选日期、日趋势与月度汇总','已接入','ok'],
    ['MSKU / ASIN','商品维度','P0','amazon_product_stats','ASIN 为主粒度；同一 ASIN 的店铺汇总不重复拆分','已接入','ok'],
    ['金额口径','金额口径','P0','exchange_rate','所有经营金额按最新人民币汇率动态换算，原始金额保留在明细','已接入','ok'],
    ['店铺 / 国家','经营维度','P0','sids / store_name / country_code','单店铺行可筛选；多店铺行显示为汇总','部分接入','warn'],
    ['销量 / 销售额','销售规模','P0','total_sales_quantity / total_sales_amount','销售规模、趋势与上期对比','已接入','ok'],
    ['退款量 / 退款金额 / 退款率','售后质量','P0','refunds_quantity / total_sales_refunds','按汇总量重新计算退款率','已接入','ok'],
    ['广告花费 / 广告销售额 / 广告销量','广告产出','P0','amazon_product_stats','计算 ACOS、TACOS 与 ROAS','已接入','ok'],
    ['实际毛利润 / 毛利率','利润结果','P0','gross_profit / total_sales_amount','毛利率按汇总毛利除以汇总销售额','已接入','ok'],
    ['订单数 / Session / 曝光 / 点击','产品与广告流量','P0','amazon_product_stats','用于产品表现、转化率与广告流量分析','已接入','ok'],
    ['父ASIN / Listing负责人 / 开发负责人','责任维度','P1','利润表未返回','暂不能进行父子体及负责人分析','待接入','warn'],
    ['Amazon库存 / 在途 / 预测可售天数','供应链','P0','lingxing_amazon_fba_inventory_v2 + amazon_product_stats','领星 FBA v2 最新完整库存快照；预测天数另结合近30天销量','已接入','ok'],
    ['转账申请 / 原币金额 / 运行状态','资金维度','P0','钉钉 AI 表格','按授权工作表展示真实记录；转账申请金额不等同于已到账','已接入','ok']
  ];

  const $ = (selector,root=document)=>root.querySelector(selector);
  const $$ = (selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const app = $('#app');
  let currentView = 'overview';
  let selectedStores = new Set();
  let selectedDateRange = {start:'',end:''};
  let pendingPageChrome = {title:'经营总览',subtitle:'',export:false};
  let toastTimer;
  let chartSequence = 0;

  function demoDates(count=14){
    const end=anchorDate();
    return Array.from({length:count},(_,index)=>shiftIso(end,-(count-index-1)));
  }
  function demoSalesPayload(){
    const dates=demoDates(14);
    const names=['防滑链 8 件套','便携式取暖器','车载保温箱','露营折叠椅','车载应急电源','户外折叠桌','宠物安全座椅','旅行收纳箱'];
    const products=names.map((name,index)=>({statsDate:dates[dates.length-1],localSku:`DEMO-${String(index+1).padStart(3,'0')}`,asin:`B0DEMO${String(index+1).padStart(4,'0')}`,productName:name,country:index%3===0?'CA':'US',sid:`DEMO-S${index+1}`,sellerName:index%2?'美国旗舰店':'加拿大站店铺',volume:37-index*2,orders:28-index,revenue:1680-index*91,adVolume:7-index%3,adSales:410-index*21,netRevenue:1520-index*80,grossProfit:420-index*26,currencyCode:'USD',dailySales:dates.map((_,day)=>Math.max(0,1+((day+index*2)%7)+Math.floor(index/3)))}));
    const trend=dates.map((date,index)=>({statsDate:date,volume:165+index*7+(index%3)*9,orders:118+index*4,revenue:6800+index*320,adSales:1420+index*85,sourceMode:'demo'}));
    return {period:{startDate:dates[0],endDate:dates[dates.length-1]},summary:{volume:products.reduce((sum,row)=>sum+row.volume,0),orders:products.reduce((sum,row)=>sum+row.orders,0),revenue:products.reduce((sum,row)=>sum+row.revenue,0),adSales:products.reduce((sum,row)=>sum+row.adSales,0),grossProfit:products.reduce((sum,row)=>sum+row.grossProfit,0),refundAmount:86,refundRate:.012,sessions:7170,pageViews:9986,unitConversionRate:.1781},previousSummary:{volume:228,orders:180,revenue:22500,adSales:4700,grossProfit:5200},change:{volume:.12,revenue:.086,adSales:.14},trend,siteMix:[{country:'US',sellerName:'美国旗舰店',sid:'DEMO-S1',revenue:26800},{country:'CA',sellerName:'加拿大站店铺',sid:'DEMO-S2',revenue:12500}],products,performanceProducts:products.map(row=>({...row,sessions:640+row.volume*9,pageViews:980+row.volume*11,conversionRate:.1781,buyBoxPercentage:.92,reviewsCount:128,averageStar:4.7,bestRank:12}))};
  }
  function demoAdvertisingPayload(){
    const dates=demoDates(14);
    const products=['防滑链 8 件套','便携式取暖器','车载保温箱','露营折叠椅','车载应急电源'].map((name,index)=>({asin:`B0DEMO${String(index+1).padStart(4,'0')}`,localSku:`DEMO-${String(index+1).padStart(3,'0')}`,productName:name,country:'US',sellerName:'美国旗舰店',spend:220-index*18,adSales:980-index*70,adOrders:19-index,adVolume:22-index,impressions:6000-index*380,clicks:94-index*7,acos:.224+index*.018,roas:4.4-index*.35,asoas:.18}));
    const trend=dates.map((date,index)=>({statsDate:date,spend:280+index*9,adSales:1120+index*42,impressions:6000+index*140,clicks:92+index*3,adOrders:14+index}));
    return {summary:{spend:products.reduce((sum,row)=>sum+row.spend,0),adSales:products.reduce((sum,row)=>sum+row.adSales,0),adOrders:products.reduce((sum,row)=>sum+row.adOrders,0),impressions:products.reduce((sum,row)=>sum+row.impressions,0),clicks:products.reduce((sum,row)=>sum+row.clicks,0),roas:4.2,acos:.238},previousSummary:{spend:920,adSales:4100,adOrders:72},change:{spend:.08,adSales:.16,roas:.07,acos:-.03},trend,products};
  }
  function demoInventoryPayload(){
    const products=demoSalesPayload().products.map((row,index)=>({...row,fbaSellable:613-index*48,fbmAvailable:45-index*3,inbound:21+index*4,reserved:6+index,unsellable:index,availableDays:46-index*4}));
    return {amazonSnapshot:{dataDate:anchorDate(),summary:{productCount:products.length,fbaSellable:3831,fbmAvailable:776,totalStock:7433,inbound:157,reserved:89,unsellable:10,averageAvailableDays:89,lowStockCount:2,overstockCount:3},products}};
  }
  function demoOptionsPayload(){
    return {latestStatsDate:anchorDate(),latestProductStatsDate:anchorDate(),latestInventoryDate:anchorDate(),platforms:['Amazon'],currencies:['USD','CAD'],defaultCurrencyCode:'USD',sitesAndStores:[{country:'US',mid:'DEMO-M1',sid:'DEMO-S1',sellerName:'美国旗舰店',localSku:'DEMO-001',asin:'B0DEMO0001'},{country:'CA',mid:'DEMO-M2',sid:'DEMO-S2',sellerName:'加拿大站店铺',localSku:'DEMO-002',asin:'B0DEMO0002'}]};
  }
  function useDemoData(module,reason){
    demoModules.add(module); demoReasons[module]=reason||'接口暂未返回数据';
    if(module==='sales')liveData.sales=demoSalesPayload();
    if(module==='advertising')liveData.advertising=demoAdvertisingPayload();
    if(module==='inventory')liveData.inventory=demoInventoryPayload();
    loadState[module]={phase:'ready',error:''};
  }
  function isEmptyPayload(value){return !value || (Array.isArray(value)?value.length===0:Object.keys(value).length===0);}
  function demoNotice(){
    const modules=viewLoaders[currentView]||[];
    const module=modules.find(name=>demoModules.has(name));
    return module?`<div class="demo-data-notice"><b>演示数据</b><span>当前接口暂无可用数据，页面使用虚拟数据展示布局与交互。</span><small>${escapeAttr(demoReasons[module]||'等待真实数据接入')}</small></div>`:'';
  }

  function todayIso(){
    const now=new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  function shiftIso(value,days){
    const date=new Date(`${value}T00:00:00Z`);
    if(Number.isNaN(date.valueOf()))return value;
    date.setUTCDate(date.getUTCDate()+days);
    return date.toISOString().slice(0,10);
  }
  function anchorDate(){
    const latest=String(liveData.options?.latestStatsDate||liveData.options?.latestMetricDate||'').slice(0,10);
    return isIsoDate(latest)?latest:todayIso();
  }
  function periodRange(period,anchor=anchorDate()){
    const iso=anchor;
    if(period==='today')return {start:iso,end:iso};
    if(period==='week'){const weekday=new Date(`${iso}T00:00:00Z`).getUTCDay();const start=shiftIso(iso,-((weekday+6)%7));return {start,end:iso};}
    if(period==='month')return {start:`${iso.slice(0,7)}-01`,end:iso};
    if(period==='lastMonth'){const lastEnd=shiftIso(`${iso.slice(0,7)}-01`,-1);return {start:`${lastEnd.slice(0,7)}-01`,end:lastEnd};}
    if(period==='last30')return {start:shiftIso(iso,-29),end:iso};
    if(period==='last90')return {start:shiftIso(iso,-89),end:iso};
    return null;
  }

  function liveStores(){
    const rows=liveData.options?.sitesAndStores;
    if(!Array.isArray(rows))return [];
    const seen=new Map();
    rows.forEach(row=>{
      const name=String(row?.sellerName||'').trim();
      if(!name||seen.has(name))return;
      seen.set(name,{name,country:String(row?.country||'').trim(),mid:row?.mid??'',sid:row?.sid??''});
    });
    return [...seen.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  }
  function activeStore(){
    const picked=liveStores().filter(item=>selectedStores.has(item.name));
    return picked.length===1?picked[0]:null;
  }
  function scopeParams(){
    const store=activeStore();
    const params={limit:0};
    if(selectedDateRange.start)params.startDate=selectedDateRange.start;
    if(selectedDateRange.end)params.endDate=selectedDateRange.end;
    if(store)params.sellerName=store.name;
    if(store?.country)params.country=store.country;
    return params;
  }
  function inventoryScopeParams(){
    // Inventory owns platform/store/warehouse filters. Read all existing sources for this snapshot.
    const params={limit:0};
    if(selectedDateRange.start)params.startDate=selectedDateRange.start;
    if(selectedDateRange.end)params.endDate=selectedDateRange.end;
    return params;
  }
  function logisticsScopeParams(){
    const params=scopeParams();
    if(logisticsAllDates){delete params.startDate;delete params.endDate;params.allDates=true;}
    return params;
  }
  function logisticsDateRangeText(){
    const dates=logisticsAllDates?'全部发货日期':dateRangeText(),country=logisticsScopeParams().country;
    return `${dates} · ${country?`国家 / 地区：${country}`:'全部国家 / 地区'}`;
  }
  function scopeText(){
    const store=activeStore();
    if(store)return `${store.name}${store.country?` · ${store.country}`:''} · 统一本位币`;
    const total=liveStores().length;
    return `${total?`全部店铺（${total} 个）`:'全部店铺'} · CNY`;
  }
  function syncCurrencyOptions(){
    // 保留函数名兼容旧页面，但不再提供币种切换。
  }
  function updateStoreButton(){
    const stores=liveStores();
    const store=activeStore();
    if(selectedStores.size&&stores.length&&!store)selectedStores=new Set();
    $('#platformButton span').textContent=store?store.name:'全部店铺';
    $('#platformButton small').textContent=stores.length?(store?(store.country||'国家未标注'):`${stores.length} 个店铺`):'店铺待加载';
  }
  function syncDataState(){
    const node=$('#syncState');
    if(!node)return;
    const modules=currentView==='seasonality'?['seasonality']:(viewLoaders[currentView]||['sales','advertising','inventory']);
    const phases=modules.map(name=>loadState[name].phase);
    const loading=phases.includes('loading');
    const failed=phases.includes('error')&&!loading;
    const idle=phases.every(phase=>phase==='idle');
    const demo=modules.some(name=>demoModules.has(name));
    node.classList.toggle('error',failed);
    node.classList.toggle('demo',demo);
    node.innerHTML=`<i></i>${loading?'数据加载中':failed?'数据不可用':idle?'数据待加载':demo?'演示数据':'真实数据'}`;
  }

  function renderExchangeRateChrome(){
    const node=$('#exchangeRateState');
    const button=$('#exchangeRateRefresh');
    if(!node)return;
    const data=liveData.exchangeRate||{};
    const stale=Boolean(data.stale||data.lastFailureMessage);
    const database=data.database||{};
    const fetched=data.lastSuccessAt||database.lastSuccessAt||database.lastFetchedAt||'';
    const label=stale?'汇率已过期':(fetched?'汇率已更新':'汇率待同步');
    node.textContent=label;
    node.className=`exchange-rate-state ${stale?'stale':fetched?'ready':'pending'}`;
    node.title=stale
      ? `继续使用上次成功汇率；${data.lastFailureMessage||'请检查汇率同步状态'}`
      : fetched ? `最新汇率更新时间：${fetched}` : '尚未获取汇率';
    if(button)button.title=stale?'重新抓取汇率':'立即抓取最新汇率';
  }

  function moduleScopeKey(name){return `${window.AnalyticsApi?.authScopeVersion?.()??0}|${JSON.stringify(name==='logistics'?logisticsScopeParams():['inventory','multiplatform'].includes(name)?inventoryScopeParams():scopeParams())}`;}
  function cancelScopeReads(){dataReadController.abort();dataReadController=new AbortController();logisticsReadController?.abort();}
  function controlKey(control,index){
    if(control.id)return `id:${control.id}`;
    const table=control.closest('[data-table-section]')?.querySelector('table');
    const attributes=[...control.attributes].filter(attribute=>attribute.name.startsWith('data-')||attribute.name==='name').map(attribute=>`${attribute.name}=${attribute.value}`).join('|');
    return `${table?.dataset.tableTitle||''}|${control.tagName}|${attributes||`${control.type||''}:${index}`}`;
  }
  function captureViewState(){
    const controls=$$('input,select,textarea',app).filter(control=>!control.closest('.iw-workspace,.sc-workspace')),active=document.activeElement;
    const fields=controls.map((control,index)=>({key:controlKey(control,index),value:control.value,checked:control.checked}));
    const tables=$$('.data-table',app).map(table=>({key:table.dataset.tableTitle,sortColumn:table.dataset.sortColumn,sortDirection:table.dataset.sortDirection,page:table.dataset.page,scrollTop:table.closest('.table-wrap')?.scrollTop||0,scrollLeft:table.closest('.table-wrap')?.scrollLeft||0}));
    const details=$$('details',app).filter(element=>element.open&&!element.closest('.iw-workspace')).map((element,index)=>element.dataset.providerKey?`provider:${element.dataset.providerKey}`:`details:${element.className}`);
    const provider=$('.logistics-combined-panel',app);
    return {fields,tables,details,provider:provider?{page:provider.dataset.providerPage,sortColumn:provider.dataset.sortColumn,sortDirection:provider.dataset.sortDirection}:null,scrollX:window.scrollX,scrollY:window.scrollY,focus:controls.includes(active)?controlKey(active,controls.indexOf(active)):null,selectionStart:active?.selectionStart,selectionEnd:active?.selectionEnd};
  }
  function restoreViewState(snapshot){
    const controls=$$('input,select,textarea',app).filter(control=>!control.closest('.iw-workspace,.sc-workspace')),fieldMap=new Map(snapshot.fields.map(field=>[field.key,field]));
    controls.forEach((control,index)=>{const field=fieldMap.get(controlKey(control,index));if(field){control.value=field.value;if(typeof field.checked==='boolean')control.checked=field.checked;}});
    filterSalesDetails();
    $$('.data-table',app).forEach(table=>{
      const saved=snapshot.tables.find(item=>item.key===table.dataset.tableTitle);if(!saved)return;
      const section=table.closest('[data-table-section]'),search=$('[data-table-search]',section)?.value?.trim().toLowerCase();
      if(search!==undefined)$$('tbody tr',table).forEach(row=>row.dataset.filterExcluded=String(!row.innerText.toLowerCase().includes(search)));
      if(saved.sortColumn!==undefined)sortTable(table,Number(saved.sortColumn),saved.sortDirection||'asc');
      table.dataset.page=saved.page||'1';updateTablePage(table);
      const wrap=table.closest('.table-wrap');if(wrap){wrap.scrollTop=saved.scrollTop;wrap.scrollLeft=saved.scrollLeft;}
    });
    const provider=$('.logistics-combined-panel',app);
    if(provider&&snapshot.provider){
      const column=snapshot.provider.sortColumn,button=column===undefined?null:$(`[data-provider-sort="${column}"]`,provider);
      if(button){button.click();if(provider.dataset.sortDirection!==snapshot.provider.sortDirection)button.click();}
      $('[data-provider-search-input]',provider)?.dispatchEvent(new Event('input'));provider._setProviderPage?.(Number(snapshot.provider.page)||1);
    }
    $$('details',app).filter(element=>!element.closest('.iw-workspace')).forEach(element=>{const key=element.dataset.providerKey?`provider:${element.dataset.providerKey}`:`details:${element.className}`;if(snapshot.details.includes(key))element.open=true;});
    const focus=snapshot.focus?controls.find((control,index)=>controlKey(control,index)===snapshot.focus):null;
    if(focus){focus.focus({preventScroll:true});try{if(snapshot.selectionStart!==null&&snapshot.selectionStart!==undefined)focus.setSelectionRange(snapshot.selectionStart,snapshot.selectionEnd);}catch(ignore){}}
    window.scrollTo({left:snapshot.scrollX,top:snapshot.scrollY,behavior:'auto'});
  }
  function queueProgressivePaint(){
    pendingDataPaint={view:currentView,scope:dataScopeVersion,auth:window.AnalyticsApi?.authScopeVersion?.()??0};
    if(progressivePaintFrame!==null)return;
    progressivePaintFrame=requestAnimationFrame(()=>{
      progressivePaintFrame=null;const context=pendingDataPaint;
      if(!context||context.view!==currentView||context.scope!==dataScopeVersion||context.auth!==(window.AnalyticsApi?.authScopeVersion?.()??0)){pendingDataPaint=null;return;}
      if($('.drill-backdrop'))return;
      pendingDataPaint=null;const snapshot=captureViewState();renderView(currentView);restoreViewState(snapshot);
    });
  }
  function refreshPhasedView(module){
    syncDataState();
    if((viewLoaders[currentView]||[]).includes(module)||module==='logistics'&&currentView==='fulfillment')queueProgressivePaint();
  }
  function phasedDetailsNotice(){
    const modules=currentView==='fulfillment'?['logistics']:(viewLoaders[currentView]||[]);
    if(modules.some(name=>loadState[name]?.refreshing))return '<div class="analytics-load-note" role="status">正在更新，继续显示本范围上次成功读取的数据。</div>';
    const loading=modules.filter(name=>loadState[name]?.detailsLoading||loadState[name]?.phase==='loading');
    const errors=modules.filter(name=>loadState[name]?.detailsError);
    if(loading.length)return '<div class="analytics-load-note" role="status">已返回的汇总先显示，其余数据正在读取…</div>';
    if(errors.length)return `<div class="analytics-load-note error" role="status">汇总已加载；部分明细暂未完成：${escapeAttr(loadState[errors[0]].detailsError)} <button type="button" data-action="retry-data">重试</button></div>`;
    const metadata=modules.map(name=>name==='logistics'?liveData.logisticsBreakdown?.transport?.cache:liveData[name]?.cache).find(value=>Number(value?.generatedAtEpochMs)>0);
    return metadata?`<div class="analytics-cache-note">统计生成于 ${escapeAttr(new Date(Number(metadata.generatedAtEpochMs)).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))}${metadata.hit?' · 缓存复用':''}</div>`:'';
  }
  async function loadBusinessModule(name,{preserveData=false,bypassCache=false}={}){
    const advertising=name==='advertising',token=advertising?++advertisingToken:++salesToken,params=scopeParams(),generation=dataScopeVersion,auth=window.AnalyticsApi?.authScopeVersion?.()??0,scope=moduleScopeKey(name),signal=dataReadController.signal;
    const valid=()=>token===(advertising?advertisingToken:salesToken)&&generation===dataScopeVersion&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0);
    const previous=preserveData&&loadedModuleScopes[name]===scope?liveData[name]:null;
    const summaryApi=advertising?'advertisingSummary':'salesSummary',detailsApi=advertising?'advertisingDetails':'salesDetails';let summary=null,cachedDetails=null;
    const acceptSummary=(payload,stale=false)=>{
      if(!valid())return;summary=payload;demoModules.delete(name);liveData[name]=previous?{...payload,...previous,summary:payload.summary,previousSummary:payload.previousSummary,change:payload.change,period:payload.period}:payload;
      loadedModuleScopes[name]=scope;if(!stale)loadedModuleAt[name]=Date.now();loadState[name]={phase:'ready',error:'',detailsLoading:true,retainedDetails:Boolean(previous),refreshing:stale};refreshPhasedView(name);
    };
    const acceptDetails=(payload,stale=false)=>{
      if(!valid())return;cachedDetails=payload;liveData[name]={...summary,...payload,summary:summary.summary,previousSummary:summary.previousSummary,change:summary.change};
      loadedModuleScopes[name]=scope;if(!stale)loadedModuleAt[name]=Date.now();loadState[name]={phase:'ready',error:'',detailsLoading:stale,retainedDetails:stale,refreshing:stale};refreshPhasedView(name);
    };
    try{
      const freshSummary=await window.AnalyticsApi[summaryApi](params,{cache:!bypassCache,signal,onCached:payload=>acceptSummary(payload,true)});
      if(!valid())return;acceptSummary(freshSummary);
      const details=await window.AnalyticsApi[detailsApi](params,{cache:!bypassCache,signal,onCached:payload=>acceptDetails(payload,true)});
      if(!valid())return;acceptDetails(details);
    }catch(error){
      if(!valid()||error?.name==='AbortError')return;demoModules.delete(name);
      if(summary||previous){liveData[name]=cachedDetails?liveData[name]:previous&&summary?{...summary,...previous,summary:summary.summary,previousSummary:summary.previousSummary,change:summary.change,period:summary.period}:summary||previous;loadState[name]={phase:'ready',error:'',detailsLoading:false,retainedDetails:Boolean(previous||cachedDetails),refreshing:false,detailsError:error?.message||'明细更新失败'};}
      else{liveData[name]=null;loadState[name]={phase:'error',error:error?.message||'汇总读取失败'};}
      refreshPhasedView(name);
    }
  }
  function loadSalesData(options){return loadBusinessModule('sales',options);}
  function loadAdvertisingData(options){return loadBusinessModule('advertising',options);}
  async function loadInventoryData({preserveData=false,bypassCache=false}={}){
    const generation=dataScopeVersion,token=++inventoryToken,auth=window.AnalyticsApi?.authScopeVersion?.()??0,scope=moduleScopeKey('inventory'),previous=preserveData&&loadedModuleScopes.inventory===scope?liveData.inventory:null;
    const valid=()=>generation===dataScopeVersion&&token===inventoryToken&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0);
    let lastAccepted=previous;
    const accept=(payload,stale=false)=>{if(!valid())return;lastAccepted=payload;demoModules.delete('inventory');liveData.inventory=payload;loadedModuleScopes.inventory=scope;if(!stale)loadedModuleAt.inventory=Date.now();loadState.inventory={phase:'ready',error:'',refreshing:stale};refreshPhasedView('inventory');};
    try{const payload=await window.AnalyticsApi.inventory({...inventoryScopeParams(),...(bypassCache?{refresh:true}:{})},{cache:!bypassCache,signal:dataReadController.signal,onCached:payload=>accept(payload,true)});if(valid())accept(payload);}
    catch(error){if(!valid()||error?.name==='AbortError')return;demoModules.delete('inventory');liveData.inventory=lastAccepted;loadState.inventory={phase:lastAccepted?'ready':'error',refreshing:false,error:lastAccepted?'':error?.message||'库存读取失败',detailsError:lastAccepted?'库存更新未完成，继续显示本范围上次成功结果：'+(error?.message||'请稍后重试'):''};refreshPhasedView('inventory');}
  }
  async function loadSeasonalityData({refresh=false}={}){
    synchronizeInventorySeasonScope();
    const product=inventorySeason.selectedProduct;
    if(!product||!completeInventoryProduct(product))return;
    if(loadState.seasonality.phase==='loading')return;
    const selectedKey=inventorySeason.selectedKey,scopeKey=inventorySeason.scopeKey;
    const requestToken=++seasonalityToken,generation=dataScopeVersion;
    const params={...inventoryScopeParams(),...inventoryProductIdentity(product)};
    loadState.seasonality={phase:'loading',error:''};liveData.seasonality=null;paintInventorySeasonality();
    try{
      const payload=await window.AnalyticsApi.seasonality(params,{cache:!refresh,signal:dataReadController.signal});
      if(requestToken!==seasonalityToken||generation!==dataScopeVersion||selectedKey!==inventorySeason.selectedKey||scopeKey!==inventorySeasonScopeKey())return;
      if(payload?.source!=='salesVolume'||payload?.metricLabel!=='周均销量')throw new Error('销量历史口径尚未更新，请确认后端版本后重试。');
      const returned=[...(payload.histories||[]),...(payload.items||[])];
      if(returned.some(row=>inventoryProductKey(row)!==selectedKey))throw new Error('返回的商品范围与当前选择不一致，请重新选择商品。');
      demoModules.delete('seasonality');
      liveData.seasonality=payload;
      inventorySeason.month=(payload.items||[]).find(row=>!row.insufficient&&Number(row.month)>0)?.month||new Date().getMonth()+1;
      loadState.seasonality={phase:'ready',error:''};
    }catch(error){
      if(requestToken!==seasonalityToken||generation!==dataScopeVersion||selectedKey!==inventorySeason.selectedKey||scopeKey!==inventorySeasonScopeKey())return;
      liveData.seasonality=null;
      demoModules.delete('seasonality');
      loadState.seasonality={phase:'error',error:error?.message||'季节性接口暂时不可用'};
    }
    if(requestToken===seasonalityToken)paintInventorySeasonality();
  }
  function logisticsTaskRunning(sync){return sync?.syncRunning===true||String(sync?.lastRunStatus||'').toUpperCase()==='RUNNING';}
  function logisticsSyncContext(){return {generation:logisticsSyncState.generation,scope:dataScopeVersion,auth:window.AnalyticsApi?.authScopeVersion?.()??0};}
  function logisticsSyncContextCurrent(context){return currentView==='fulfillment'&&context.generation===logisticsSyncState.generation&&context.scope===dataScopeVersion&&context.auth===(window.AnalyticsApi?.authScopeVersion?.()??0);}
  function stopLogisticsPolling(reset=false){
    window.clearTimeout(logisticsSyncState.timer);logisticsSyncState.timer=null;logisticsSyncState.generation++;logisticsSyncState.inFlight=false;logisticsSyncState.refreshing=false;
    if(reset){Object.assign(logisticsSyncState,{initiating:false,running:false,uncertain:false,paused:false,checking:false,refreshing:false,error:'',message:'',jobId:'',attemptKey:'',observedRunning:false,failures:0,polls:0});logisticsSyncState.completedJobs.clear();}
  }
  function scheduleLogisticsStatusCheck(){
    if(currentView!=='fulfillment'||logisticsSyncState.timer||logisticsSyncState.inFlight||logisticsSyncState.initiating||logisticsSyncState.paused||(!logisticsSyncState.running&&!logisticsSyncState.uncertain))return;
    const context=logisticsSyncContext();
    logisticsSyncState.timer=window.setTimeout(()=>{logisticsSyncState.timer=null;if(logisticsSyncContextCurrent(context))void checkLogisticsSyncStatus();},logisticsSyncState.polls<3?5000:10000);
  }
  function paintLogisticsSync(){
    if(currentView!=='fulfillment')return;
    const display=logisticsSyncDisplay(liveData.logisticsStatus||{},loadState.logistics.phase==='loading');
    $$('[data-logistics-sync-label]',app).forEach(node=>{node.textContent=display.label;node.className=`status-pill ${display.tone}`;});
    $$('[data-action="logistics-sync"]',app).forEach(button=>{button.disabled=display.disabled;button.textContent=display.button;});
    const feedback=$('#logisticsSyncFeedback',app);if(feedback)feedback.innerHTML=logisticsSyncFeedback();
    const latest=$('#logisticsLatestResult',app);if(latest){latest.textContent=shortMessage(liveData.logisticsStatus?.lastRunMessage||'尚未执行同步',72);latest.title=liveData.logisticsStatus?.lastRunMessage||'';}
    $('[data-action="logistics-check-status"]',feedback||app)?.addEventListener('click',()=>{if(logisticsSyncState.inFlight)return;logisticsSyncState.failures=0;logisticsSyncState.paused=false;void checkLogisticsSyncStatus({manual:true});});
  }
  async function refreshLogisticsAfterSync(context,jobKey,{uncertain=false}={}){
    if(!logisticsSyncContextCurrent(context)||logisticsSyncState.completedJobs.has(jobKey))return;
    logisticsSyncState.completedJobs.add(jobKey);
    if(logisticsSyncState.completedJobs.size>20)logisticsSyncState.completedJobs.delete(logisticsSyncState.completedJobs.values().next().value);
    window.AnalyticsApi?.clearLogisticsCache?.();
    logisticsSyncState.refreshing=true;
    logisticsSyncState.message=uncertain?'当前无运行任务，正在刷新已保存数据；本次提交结果未确认。':'同步已结束，正在更新当前范围报表。';paintLogisticsSync();
    await loadLogisticsStatus({preserveData:true,requiredView:true,bypassCache:true});
    if(!logisticsSyncContextCurrent(context))return;
    logisticsSyncState.refreshing=false;
    logisticsSyncState.message=uncertain?'当前无运行任务，已尝试刷新已保存数据；请核对最近同步结果。':'';paintLogisticsSync();queueProgressivePaint();
  }
  function settleLogisticsStatusPart(){
    const previous=logisticsPartState.status;if(!previous)return;
    const phase=liveData.logisticsStatus?'ready':'idle',changed=previous.phase!==phase||previous.pending||previous.error;
    logisticsPartState.status={phase,pending:false,error:''};
    updateLogisticsReadState(Boolean(loadState.logistics.retainedData||loadState.logistics.refreshing));
    if(changed)refreshPhasedView('logistics');
  }
  function acceptLogisticsSyncStatus(sync,context,{fromLoad=false}={}){
    liveData.logisticsStatus=sync;settleLogisticsStatusPart();
    const previousRunning=logisticsSyncState.observedRunning;
    const running=logisticsTaskRunning(sync);
    const jobId=String(sync?.jobId||'');
    logisticsSyncState.failures=0;logisticsSyncState.checking=false;
    if(running){
      logisticsSyncState.running=true;logisticsSyncState.uncertain=false;logisticsSyncState.paused=false;logisticsSyncState.error='';logisticsSyncState.message='';logisticsSyncState.observedRunning=true;
      if(jobId)logisticsSyncState.jobId=jobId;
      scheduleLogisticsStatusCheck();
    }else{
      logisticsSyncState.running=false;
      if(logisticsSyncState.uncertain&&typeof sync?.syncRunning!=='boolean'){
        logisticsSyncState.paused=true;
        logisticsSyncState.error='同步接口未返回任务状态，请更新后端至 R35 后再确认；当前报表已保留。';
      }else{
        const uncertain=logisticsSyncState.uncertain;
        logisticsSyncState.uncertain=false;logisticsSyncState.paused=false;logisticsSyncState.error='';
        if(uncertain&&!previousRunning)logisticsSyncState.message='当前未检测到运行中的同步任务；本次提交结果未确认，请核对最近同步结果。';
        if(previousRunning){
          logisticsSyncState.observedRunning=false;
          const completedKey=jobId||logisticsSyncState.jobId||logisticsSyncState.attemptKey;
          if(completedKey&&logisticsSyncContextCurrent(context))void refreshLogisticsAfterSync(context,completedKey);
        }else if(uncertain&&logisticsSyncContextCurrent(context))void refreshLogisticsAfterSync(context,jobId||logisticsSyncState.attemptKey||`status-${Date.now()}`,{uncertain:true});
      }
    }
    if(!fromLoad)paintLogisticsSync();
  }
  async function checkLogisticsSyncStatus({manual=false}={}){
    if(currentView!=='fulfillment'||logisticsSyncState.inFlight||logisticsSyncState.initiating)return;
    window.clearTimeout(logisticsSyncState.timer);logisticsSyncState.timer=null;
    const context=logisticsSyncContext(),statusToken=++logisticsStatusToken;
    logisticsSyncState.inFlight=true;logisticsSyncState.checking=true;
    if(manual){logisticsSyncState.error='正在查询后台任务状态。';paintLogisticsSync();}
    try{
      const sync=await window.AnalyticsApi.logisticsStatus();
      if(!logisticsSyncContextCurrent(context)||statusToken!==logisticsStatusToken)return;
      logisticsSyncState.polls++;
      acceptLogisticsSyncStatus(sync,context);
    }catch(error){
      if(!logisticsSyncContextCurrent(context)||statusToken!==logisticsStatusToken)return;
      logisticsSyncState.failures++;logisticsSyncState.checking=false;
      if(error?.authFailure||logisticsSyncState.failures>=3){
        logisticsSyncState.uncertain=true;logisticsSyncState.paused=true;
        logisticsSyncState.error=error?.authFailure?'登录状态或访问权限已变化，请重新登录后查询同步状态。':'连续3次无法读取同步状态，已暂停自动检查；当前报表仍可查看。';
      }else{
        logisticsSyncState.error='暂未读到同步进度，稍后自动重试查询。';
      }
      paintLogisticsSync();
    }finally{
      if(logisticsSyncContextCurrent(context)){
        logisticsSyncState.inFlight=false;logisticsSyncState.checking=false;
        scheduleLogisticsStatusCheck();
      }
    }
  }
  async function startLogisticsSync(){
    if(logisticsSyncState.initiating||logisticsSyncState.running||logisticsSyncState.uncertain||logisticsSyncState.checking||logisticsSyncState.refreshing)return;
    const context=logisticsSyncContext();
    logisticsSyncState.initiating=true;logisticsSyncState.paused=false;logisticsSyncState.error='';logisticsSyncState.message='';logisticsSyncState.polls=0;logisticsSyncState.failures=0;logisticsSyncState.attemptKey=`request-${Date.now()}`;
    paintLogisticsSync();
    let needsCheck=false;
    try{
      const result=await window.AnalyticsApi.logisticsSync();
      if(!logisticsSyncContextCurrent(context))return;
      logisticsStatusToken++;
      if(result?.jobId)logisticsSyncState.jobId=String(result.jobId);
      acceptLogisticsSyncStatus(result,context);
      if(logisticsTaskRunning(result))showToast(result.alreadyRunning?'后台已有同步任务，正在查看进度':'同步任务已提交，报表继续显示');
      else if(typeof result?.syncRunning==='boolean'){
        const jobKey=String(result.jobId||logisticsSyncState.attemptKey);void refreshLogisticsAfterSync(context,jobKey);
      }else{logisticsSyncState.uncertain=true;logisticsSyncState.error=result?.accepted===true?'任务已提交，正在确认后台状态。':'正在确认同步结果；异步进度需要后端 R35。';needsCheck=true;}
    }catch(error){
      if(!logisticsSyncContextCurrent(context))return;
      logisticsSyncState.uncertain=true;
      logisticsSyncState.paused=Boolean(error?.authFailure);
      logisticsSyncState.error=`同步请求结果未确认：${shortMessage(error?.message||'请求未完成',100)}。正在查询后台状态。`;
      needsCheck=!error?.authFailure;
    }finally{
      if(context.auth===(window.AnalyticsApi?.authScopeVersion?.()??0))logisticsSyncState.initiating=false;
      if(logisticsSyncContextCurrent(context)){
        paintLogisticsSync();
        if(needsCheck)void checkLogisticsSyncStatus();else scheduleLogisticsStatusCheck();
      }else if(currentView==='fulfillment'&&context.auth===(window.AnalyticsApi?.authScopeVersion?.()??0))void checkLogisticsSyncStatus();
    }
  }
  function logisticsPartPending(part){return logisticsPartState[part]?.pending===true;}
  function logisticsPartPlaceholder(part,label){
    if(logisticsPartPending(part))return `<div class="logistics-section-state" role="status"><i></i><b>${escapeAttr(label)}正在读取</b><span>其他已加载内容可继续查看。</span></div>`;
    const error=logisticsPartState[part]?.error;
    return error?`<div class="logistics-section-state error"><b>${escapeAttr(label)}暂未读取</b><span>${escapeAttr(shortMessage(error,140))}</span><button type="button" class="text-button" data-action="${part==='anomalies'?'logistics-retry-anomalies':'retry-data'}">重新读取</button></div>`:'';
  }
  function updateLogisticsReadState(preserve=false){
    const names=['status','overview','trend','breakdown','items'],data=names.slice(1),failed=names.filter(name=>logisticsPartState[name]?.error),pending=names.filter(name=>logisticsPartPending(name)),ready=data.some(name=>logisticsPartState[name]?.phase==='ready');
    loadState.logistics={phase:ready?(failed.length?'partial':'ready'):pending.length?'loading':preserve?'partial':'error',refreshing:pending.length>0&&preserve,pendingParts:pending,failedParts:failed,retainedData:preserve&&failed.length>0,error:failed.map(name=>logisticsPartState[name].error).join('；')};
  }
  async function loadLogisticsStatus({preserveData=false,requiredView=false,bypassCache=false}={}){
    logisticsReadController?.abort();const controller=new AbortController();logisticsReadController=controller;
    const generation=dataScopeVersion,token=++logisticsToken,statusToken=++logisticsStatusToken,auth=window.AnalyticsApi?.authScopeVersion?.()??0,scope=JSON.stringify(logisticsScopeParams()),moduleScope=moduleScopeKey('logistics');
    const preserve=preserveData&&scope===logisticsLoadedScope&&loadedModuleScopes.logistics===moduleScope;
    const valid=()=>generation===dataScopeVersion&&token===logisticsToken&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0)&&!controller.signal.aborted&&(!requiredView||currentView==='fulfillment');
    const parts=[['status','logisticsStatus'],['overview','logisticsOverview'],['trend','logisticsTrend'],['items','logisticsItems'],['breakdown','logisticsBreakdown']];
    parts.forEach(([part,key])=>{logisticsPartState[part]={phase:preserve&&liveData[key]?'ready':'loading',pending:true,error:''};if(!preserve&&part!=='status')liveData[key]=null;});
    logisticsPartState.anomalies={phase:'idle',pending:false,error:''};liveData.logisticsAnomalies=null;
    updateLogisticsReadState(preserve);refreshPhasedView('logistics');
    const params={...logisticsScopeParams(),limit:50,offset:0,...(bypassCache?{refresh:true}:{})};
    await Promise.allSettled(parts.map(async([part,key])=>{
      let cached=false;
      const accept=(payload,stale=false)=>{
        if(!valid())return;
        if(part==='status'&&statusToken!==logisticsStatusToken){settleLogisticsStatusPart();return;}
        if(params.allDates&&part!=='status'&&payload?.dateRange?.allDates!==true)throw new Error('全部发货日期需要后端 R37 及以上版本，请完整更新后重试。');
        liveData[key]=payload;cached=cached||stale;logisticsPartState[part]={phase:'ready',pending:stale,error:''};
        if(part!=='status'){logisticsLoadedScope=scope;loadedModuleScopes.logistics=moduleScope;if(!stale)loadedModuleAt.logistics=Date.now();}
        updateLogisticsReadState(preserve||cached);refreshPhasedView('logistics');
        if(part==='status'&&currentView==='fulfillment')acceptLogisticsSyncStatus(payload,logisticsSyncContext(),{fromLoad:true});
      };
      try{const payload=part==='status'?await window.AnalyticsApi[key]():await window.AnalyticsApi[key](params,{cache:!bypassCache,signal:controller.signal,onCached:value=>accept(value,true)});if(valid())accept(payload);}
      catch(error){if(!valid())return;if(part==='status'&&statusToken!==logisticsStatusToken){settleLogisticsStatusPart();return;}if(error?.name==='AbortError')return;if(!preserve&&!cached&&part!=='status')liveData[key]=null;logisticsPartState[part]={phase:preserve||cached?'ready':'error',pending:false,error:error?.message||'物流数据读取失败'};updateLogisticsReadState(preserve||cached);refreshPhasedView('logistics');}
    }));
  }
  async function loadLogisticsAnomalies({bypassCache=false}={}){
    if(logisticsPartPending('anomalies'))return;
    if(!logisticsReadController||logisticsReadController.signal.aborted)logisticsReadController=new AbortController();
    const generation=dataScopeVersion,token=logisticsToken,auth=window.AnalyticsApi?.authScopeVersion?.()??0,scope=moduleScopeKey('logistics'),signal=logisticsReadController?.signal||dataReadController.signal;
    const valid=()=>generation===dataScopeVersion&&token===logisticsToken&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0)&&scope===moduleScopeKey('logistics')&&!signal.aborted;
    const attempt={phase:'loading',pending:true,error:''};logisticsPartState.anomalies=attempt;refreshPhasedView('logistics');
    try{const payload=await window.AnalyticsApi.logisticsAnomalies({...logisticsScopeParams(),...(bypassCache?{refresh:true}:{})},{cache:!bypassCache,signal});if(!valid())return;liveData.logisticsAnomalies=payload;logisticsPartState.anomalies={phase:'ready',pending:false,error:''};}
    catch(error){if(!valid()||error?.name==='AbortError')return;logisticsPartState.anomalies={phase:'error',pending:false,error:error?.message||'质量检查读取失败'};}
    finally{if(logisticsPartState.anomalies===attempt)logisticsPartState.anomalies={phase:'idle',pending:false,error:''};}
    if(valid()&&currentView==='fulfillment')refreshPhasedView('logistics');
  }
  async function loadMultiplatformData({preserveData=false,bypassCache=false}={}){
    const token=++multiplatformToken,generation=dataScopeVersion,auth=window.AnalyticsApi?.authScopeVersion?.()??0;
    const scope=moduleScopeKey('multiplatform'),signal=dataReadController.signal;
    const valid=()=>token===multiplatformToken&&generation===dataScopeVersion&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0);
    try{
      const payload=await window.AnalyticsApi.multiplatformSales(inventoryScopeParams(),{cache:!bypassCache,signal});
      if(!valid())return;
      liveData.multiplatform=payload;loadedModuleScopes.multiplatform=scope;loadedModuleAt.multiplatform=Date.now();
      loadState.multiplatform={phase:payload?.platforms?.some(p=>p.status==='error')?'partial':'ready',error:''};
    }catch(error){
      if(!valid()||error?.name==='AbortError')return;
      // A failed refresh must never relabel an older result as the new period.
      if(!preserveData)liveData.multiplatform=null;
      const retained=preserveData&&liveData.multiplatform&&loadedModuleScopes.multiplatform===scope;
      loadState.multiplatform={phase:retained?'ready':'error',refreshing:false,error:retained?'':error?.message||'多平台销量读取失败',refreshError:retained?(error?.message||'多平台销量读取失败'):''};
    }
    if(valid()){syncDataState();refreshPhasedView('multiplatform');}
  }

  function salesCockpitContext(){
    return {data:liveData.multiplatform,phase:loadState.multiplatform.phase==='partial'?'ready':loadState.multiplatform.phase==='idle'?'loading':loadState.multiplatform.phase,error:loadState.multiplatform.error,
      refreshing:loadState.multiplatform.refreshing,refreshError:loadState.multiplatform.refreshError,
      startDate:selectedDateRange.start,endDate:selectedDateRange.end,
      onNavigate:view=>navigate(view==='cockpit'?'overview':view),onRetry:()=>reloadCurrentView(),
      onOpenAmazonProfit:()=>navigate('amazon-profit')};
  }
  function salesCockpitTemplate(){
    const title=currentView==='overview'?'经营驾驶舱':'销售与利润';
    pendingPageChrome={title,subtitle:dateRangeText(),export:false};
    return window.SalesCockpit?window.SalesCockpit.render(currentView,salesCockpitContext()):dataStateBlock({title:'销量页面文件未加载',message:'请确认 sales-cockpit.js 已上传并刷新页面。',tone:'error'});
  }
  function amazonProfitTemplate(){
    return '<div class="sales-cockpit-return"><button type="button" class="text-button" data-route="sales">← 返回多平台销售与利润</button></div>'+salesTemplate({title:'Amazon 利润明细',subtitle:'沿用现有 Amazon 销量、费用和利润口径'});
  }
  function loadModule(name,options={}){
    if(name==='multiplatform')return loadMultiplatformData(options);
    if(name==='sales')return loadSalesData(options);
    if(name==='advertising')return loadAdvertisingData(options);
    if(name==='seasonality')return loadSeasonalityData();
    if(name==='logistics')return loadLogisticsStatus(options);
    return loadInventoryData(options);
  }

  async function refreshData(modules,{force=false,bypassCache=false}={}){
    const names=(modules||[]).filter(name=>force||!['ready','loading'].includes(loadState[name].phase));if(!names.length)return;
    const view=currentView,generation=dataScopeVersion,auth=window.AnalyticsApi?.authScopeVersion?.()??0;
    const options=new Map(names.map(name=>{moduleAttemptAt[name]=Date.now();pendingModuleScopes[name]=moduleScopeKey(name);const preserveData=loadedModuleScopes[name]===moduleScopeKey(name)&&Boolean(name==='logistics'?liveData.logisticsOverview:liveData[name]);if(!preserveData&&name!=='logistics')liveData[name]=null;loadState[name]=preserveData?{...loadState[name],refreshing:true,error:''}:{phase:'loading',error:''};return [name,{preserveData,bypassCache}];}));
    syncDataState();queueProgressivePaint();
    await Promise.allSettled(names.map(name=>loadModule(name,options.get(name))));
    if(currentView===view&&generation===dataScopeVersion&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0))queueProgressivePaint();
  }
  function ensureViewData(){
    if(!bootstrapDone)return;
    const modules=currentView==='fulfillment'?['logistics']:viewLoaders[currentView];
    if(!modules)return;
    const pending=modules.filter(name=>loadState[name].phase==='idle');
    if(pending.length)void refreshData(pending);
    const stale=modules.filter(name=>['ready','partial'].includes(loadState[name].phase)&&!loadState[name].refreshing&&!loadState[name].detailsLoading&&Date.now()-Math.max(loadedModuleAt[name]||0,moduleAttemptAt[name]||0)>60000);
    if(stale.length)void refreshData(stale,{force:true});
  }
  function reloadCurrentView({bypassCache=true}={}){
    if(!bootstrapDone)return;
    const requested=currentView==='fulfillment'?['logistics']:(viewLoaders[currentView]||[]);
    if(requested.length&&requested.every(name=>(loadState[name].phase==='loading'||loadState[name].refreshing)&&pendingModuleScopes[name]===moduleScopeKey(name)))return;
    cancelScopeReads();dataScopeVersion++;
    logisticsToken++;stopLogisticsPolling();
    if(bypassCache){window.AnalyticsApi?.clearLogisticsCache?.();window.AnalyticsApi?.clearAnalyticsCache?.();}
    resetInventorySeasonality();
    let scopeChanged=false;
    ['sales','advertising','inventory','multiplatform'].forEach(name=>{if(loadedModuleScopes[name]&&loadedModuleScopes[name]!==moduleScopeKey(name)){scopeChanged=true;liveData[name]=null;delete loadedModuleScopes[name];delete loadedModuleAt[name];delete moduleAttemptAt[name];loadState[name]={phase:'idle',error:''};}});
    if(loadedModuleScopes.logistics&&loadedModuleScopes.logistics!==moduleScopeKey('logistics')){
      scopeChanged=true;liveData.logisticsOverview=null;liveData.logisticsTrend=null;liveData.logisticsBreakdown=null;liveData.logisticsItems=null;liveData.logisticsAnomalies=null;logisticsLoadedScope='';
      delete loadedModuleScopes.logistics;delete loadedModuleAt.logistics;delete moduleAttemptAt.logistics;Object.keys(logisticsPartState).forEach(name=>delete logisticsPartState[name]);loadState.logistics={phase:'idle',error:''};
    }
    if(scopeChanged){pendingDataPaint=null;closeDrilldown();}
    const active=currentView==='fulfillment'?['logistics']:(viewLoaders[currentView]||[]);
    Object.keys(loadState).forEach(name=>{if(!active.includes(name))loadState[name]={phase:'idle',error:''}});
    return refreshData(active,{force:true,bypassCache});
  }

  async function bootstrapData(){
    syncDataState();
    if(!window.AnalyticsApi){
      const message='未加载 analytics-api.js，请确认该文件位于 app.js 之前';
      loadState.sales={phase:'error',error:message};
      loadState.multiplatform={phase:'error',error:message};
      loadState.advertising={phase:'error',error:message};
      loadState.inventory={phase:'error',error:message};
      loadState.seasonality={phase:'error',error:message};
      bootstrapDone=true;
      syncDataState();
      renderView(currentView);
      return;
    }
    const bootstrapAuth=window.AnalyticsApi?.authScopeVersion?.()??0;
    const initialPeriod=['overview','sales'].includes(currentView)?'last30':'week';
    // Status and exchange rates must not delay the date anchor or the first data read.
    void window.AnalyticsApi.status().then(value=>{if(bootstrapAuth===(window.AnalyticsApi?.authScopeVersion?.()??0)){liveData.status=value;queueProgressivePaint();}}).catch(()=>{});
    void window.AnalyticsApi.exchangeRateStatus().then(value=>{if(bootstrapAuth!==(window.AnalyticsApi?.authScopeVersion?.()??0))return;liveData.exchangeRate=value;renderExchangeRateChrome();}).catch(()=>{});
    liveData.options={latestStatsDate:todayIso(),sitesAndStores:[]};
    if(!scopeTouched){selectedDateRange=periodRange(initialPeriod);syncDateControls(initialPeriod);}
    try{
      const options=await window.AnalyticsApi.options();
      if(bootstrapAuth!==(window.AnalyticsApi?.authScopeVersion?.()??0))return;
      if(isEmptyPayload(options))throw new Error('筛选选项接口返回空数据');
      liveData.options=options;demoModules.delete('options');delete demoReasons.options;
    }catch(error){
      if(bootstrapAuth!==(window.AnalyticsApi?.authScopeVersion?.()??0))return;
      demoReasons.options=error?.message||'筛选选项读取失败';
    }
    syncCurrencyOptions();updateStoreButton();
    if(!scopeTouched){selectedDateRange=periodRange(initialPeriod);syncDateControls(initialPeriod);}
    bootstrapDone=true;renderExchangeRateChrome();
    // Navigation and explicit date changes while options load remain authoritative.
    renderView(currentView);
  }

  function dataStateBlock({title,message,retry='',tone='loading'}){
    const icon=tone==='error'?'!':tone==='empty'?'∅':'◌';
    return `<section class="section-grid"><article class="panel span-12"><div class="data-state ${tone}"><span class="state-icon">${icon}</span><b>${escapeAttr(title)}</b><p>${escapeAttr(message||'')}</p>${retry?`<button type="button" class="primary-button" data-action="retry-data">重新加载</button>`:''}</div></article></section>`;
  }
  function emptyStateBlock(message){
    if((viewLoaders[currentView]||[]).some(name=>loadState[name]?.detailsLoading))return '<div class="data-state loading"><span class="state-icon">◌</span><b>明细正在加载</b><p>汇总数据已就绪，趋势与商品明细继续读取。</p></div>';
    return `<div class="data-state empty"><span class="state-icon">∅</span><b>暂无数据</b><p>${escapeAttr(message)}</p></div>`;
  }
  function trendEmptyState(module,message='当前日期范围未返回日记录'){
    const state=loadState[module]||{};
    const loading=state.detailsLoading||['idle','loading'].includes(state.phase);
    const error=state.detailsError||state.error;
    const title=loading?'日趋势正在加载':error?'日趋势读取失败':'当前范围暂无日趋势';
    const detail=loading?'汇总已加载，正在读取每日记录。':error||message;
    return `<div class="trend-empty" role="status"><b>${title}</b><span>${escapeAttr(detail)}</span>${loading?'':`<div><button type="button" class="text-button" data-trend-period="last30">查看近30天</button>${error?'<button type="button" class="text-button" data-action="retry-data">重试</button>':''}</div>`}</div>`;
  }
  function singleDayNote(trend){
    return trend.length===1?`<div class="trend-coverage">仅 ${escapeAttr(String(trend[0].statsDate).slice(0,10))} 1 天记录，显示当日数值</div>`:'';
  }
  function isIsoDate(value){ if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T00:00:00Z`);return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value; }
  function shortDate(value){ const [,month,day]=value.split('-');return `${month}/${day}`; }
  function dateRangeText(){ return `${selectedDateRange.start} 至 ${selectedDateRange.end}`; }
  function activePeriodLabel(){ return $('#periodSwitch button.active')?.textContent.trim()||'自选日期'; }
  function syncDateControls(period=null){
    const label=`${shortDate(selectedDateRange.start)} — ${shortDate(selectedDateRange.end)}`;
    $('#dateButton small').textContent=label;$('#dateButton').setAttribute('aria-label',`选择自定义日期范围，当前 ${label}`);
    $('#dateStart').value=selectedDateRange.start;$('#dateEnd').value=selectedDateRange.end;
    $$('#periodSwitch button').forEach(button=>button.classList.toggle('active',button.dataset.period===period));
  }
  function setDateRange(start,end,period=null){ selectedDateRange={start,end};syncDateControls(period); }

  function status(text,tone='ok'){ return `<span class="status-pill ${tone}">${text}</span>`; }
  function delta(text,tone='neutral'){ return `<span class="delta ${tone}">${text}</span>`; }
  function currencySymbol(){return '¥';}
  function amountUnit(){return unifiedAmountUnit;}
  function cny(amount){ const n=toNumber(amount); return `${currencySymbol()}${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(Math.round(n||0))} ${amountUnit()}`; }
  function toNumber(value){
    if(value===null||value===undefined||value==='')return null;
    const result=Number(value);
    return Number.isFinite(result)?result:null;
  }
  function intText(value){ const result=toNumber(value); return result===null?'—':new Intl.NumberFormat('zh-CN').format(Math.round(result)); }
  function moneyText(value,digits=0){ const result=toNumber(value); return result===null?'—':`${currencySymbol()}${new Intl.NumberFormat('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(result)} ${amountUnit()}`; }
  function originalMoneyText(value,currency,digits=2){ const result=toNumber(value); return result===null?'—':`${new Intl.NumberFormat('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(result)} ${currency||'原币'}`; }
  // 物流表没有统一币种字段；这里不复用销售分析的“本位币”标签，避免把原始报价误认为已换算金额。
  function logisticsMoneyText(value,digits=0){ const result=toNumber(value); return result===null?'—':`${new Intl.NumberFormat('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(result)} 原始报价单位`; }
  function positiveMoneyText(value,digits=0){ const result=toNumber(value); return result===null?'—':`${currencySymbol()}${new Intl.NumberFormat('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Math.abs(result))} ${amountUnit()}`; }
  function decimalText(value,digits=1){ const result=toNumber(value); return result===null?'—':result.toFixed(digits); }
  function apiRatio(value){ const result=toNumber(value); return result===null?null:result*100; }
  function sharePercent(part,total){ const left=toNumber(part),right=toNumber(total); if(left===null||right===null||!right)return null; return left/right*100; }
  function grossMarginPercent(summary){ return sharePercent(summary?.grossProfit,summary?.revenue); }
  function fixedPercent(value,digits=1){ const result=toNumber(value); return result===null?'—':`${result.toFixed(digits)}%`; }
  function deltaText(value,positiveIsGood=true,digits=1){
    const result=apiRatio(value);
    if(result===null)return '—';
    const tone=result===0?'':((positiveIsGood?result>0:result<0)?'good':'bad');
    return delta(`${result>0?'+':''}${result.toFixed(digits)}%`,tone);
  }
  function deltaBadge(value,positiveIsGood=true){
    const result=apiRatio(value);
    if(result===null||result===0)return null;
    return {text:`${result>0?'+':''}${result.toFixed(1)}%`,tone:(positiveIsGood?result>0:result<0)?'good':'bad'};
  }
  function metric(label,value,{unit='',change=null,context='',accent=''}={}){
    return {label,value,unit,change:change?.text||'',tone:change?.tone||'',context,accent};
  }
  function percentCard(label,value,{change=null,context='',accent=''}={}){
    const result=apiRatio(value);
    return metric(label,result===null?'—':result.toFixed(1),{unit:result===null?'':'%',change,context,accent});
  }
  function multipleCard(label,value,{change=null,context=''}={}){
    const result=toNumber(value);
    return metric(label,result===null?'—':result.toFixed(2),{unit:result===null?'':'×',change,context});
  }
  function plainText(value){ return String(value?.html??value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
  function escapeAttr(value){ return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
  function shortMessage(value,max=120){ const text=plainText(value||''); return text.length>max?`${text.slice(0,max)}…`:text; }
  function metricHelp(label){
    const formula=metricFormulas[label];
    if(!formula)return '';
    return `<button type="button" class="metric-help" data-formula-help aria-label="${escapeAttr(label)}计算口径：${escapeAttr(formula)}" data-tip="${escapeAttr(formula)}">?</button>`;
  }
  function animatedNumber(value){
    const text=String(value),amount=text.match(/^(.*\d)\s([A-Z]{3})$/);
    return amount?`${escapeAttr(amount[1])} <small class="amount-currency">${escapeAttr(amount[2])}</small>`:escapeAttr(text);
  }

  function animateCounts(root){
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    $$('[data-count]',root).forEach(node=>{
      const target=Number(node.dataset.count),decimals=Number(node.dataset.decimals||0),prefix=node.dataset.prefix||'',suffix=node.dataset.suffix||'';
      const formatter=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});let started;
      const step=time=>{started??=time;const progress=Math.min(1,(time-started)/900),eased=1-Math.pow(1-progress,3);node.textContent=`${prefix}${formatter.format(target*eased)}${suffix}`;if(progress<1)requestAnimationFrame(step)};
      requestAnimationFrame(step);
    });
  }

  const relatedAnalysis={
    overview:[['sales','销售与利润','看收入、成本和毛利'],['products','流量与转化','查看展示、点击与 CTR'],['ads','广告效率','核查广告费用效率']],
    sales:[['products','流量与转化','查看展示、点击与 CTR'],['ads','广告效率','核查广告费用效率']],
    products:[['ads','广告效率','核查商品投放效率'],['sales','销售与利润','查看成本与毛利明细']],
    ads:[['products','流量与转化','查看展示、点击与 CTR'],['sales','销售与利润','评估广告对毛利的影响']],
    inventory:[['products','流量与转化','结合销量判断库存风险'],['fulfillment','仓储发货','核对发货箱数与跟踪记录']],
    data:[['overview','经营总览','查看已接入指标'],['sales','销售与利润','核对字段在报表中的应用']],
  };

  function relatedAnalysisNav(view=currentView){
    const links=relatedAnalysis[view]||[];
    if(!links.length)return '';
    const labels={sales:'利润',products:'流量',ads:'广告',inventory:'库存',fulfillment:'发货',overview:'总览'};
    return `<nav class="related-analysis related-cards" aria-label="关联分析"><div class="related-label"><strong>关联分析</strong><small>继续查看</small></div><div class="related-links">${links.map(item=>`<button type="button" data-route="${item[0]}"><b>${labels[item[0]]||'分析'}</b><span><strong>${escapeAttr(item[1])}</strong><small>${escapeAttr(item[2]||'')}</small></span><i aria-hidden="true">→</i></button>`).join('')}</div></nav>`;
  }

  function pageChrome(title,subtitle,options={}){
    pendingPageChrome={title,subtitle,export:Boolean(options.export)};
    const backend=liveData.status;
    const versionNote=backend?.enabled&&!['20261014-r32','20261014-r33','20261014-r34','20261014-r35','20261014-r36','20261014-r37','20261014-r38','20261014-r39'].includes(backend.analysisVersion)?'<div class="analytics-load-note error">后端版本尚未确认，库存日均销量与备货参考可能未生效。<button type="button" data-route="data">查看版本</button></div>':'';
    return (options.related===false?'':relatedAnalysisNav(currentView))+versionNote+demoNotice()+phasedDetailsNotice();
  }

  function metricGrid(items,variant=''){
    return `<section class="metric-grid ${variant}">${items.map(item=>`<article class="metric-card" style="--accent:${item.accent||'var(--blue)'}">
      <button type="button" class="metric-open" data-metric="${escapeAttr(item.label)}" data-display-value="${escapeAttr(`${item.value}${item.unit||''}`)}" aria-label="查看${escapeAttr(item.label)}明细"><span class="sr-only">查看${escapeAttr(item.label)}明细</span></button>
      <div class="label"><span>${item.label}</span>${item.change?`<em class="${item.tone==='bad'?'bad':''}">${item.change}</em>`:''}</div>
      <div class="metric-value-row"><div class="value">${animatedNumber(item.value)}<small>${item.unit||''}</small></div>${metricHelp(item.label)}</div>
      <div class="context">${item.context||''}</div>
      <button type="button" class="drill-hint" data-metric="${escapeAttr(item.label)}" data-display-value="${escapeAttr(`${item.value}${item.unit||''}`)}">查看明细 ↗</button>
    </article>`).join('')}</section>`;
  }

  function dataTable(headers,rows,options={}){
    const head=headers.map((item,index)=>{
      const help=String(item).match(/<button\b[\s\S]*?<\/button>/g)||[];
      const label=String(item).replace(/<button\b[\s\S]*?<\/button>/g,'');
      return `<th scope="col" aria-sort="none" class="${index===0?'align-left':''}"><span class="table-heading"><button type="button" data-sort-column="${index}" aria-label="按${escapeAttr(plainText(label))}排序">${label}<i aria-hidden="true">↕</i></button>${help.join('')}</span></th>`;
    }).join('');
    const body=rows.map((row,rowIndex)=>{
      const record=row.record||plainText(row.cells[0]);
      const meta=Object.entries(row.meta||{}).map(([key,value])=>`data-${key}="${escapeAttr(value)}"`).join(' ');
      return `<tr ${options.clickable?`class="clickable" tabindex="0" data-record="${escapeAttr(record)}"`:''} data-original-index="${rowIndex}" ${row.priority?`data-priority="${row.priority}"`:''} ${meta}>${row.cells.map((cell,index)=>`<td class="${index===0?'align-left':''} ${cell?.className||''}" ${row.sortValues?`data-sort-value="${escapeAttr(row.sortValues[index]??'')}"`:''}>${cell?.html??cell}</td>`).join('')}</tr>`;
    }).join('');
    const controls=options.paginated!==false&&(options.searchable||rows.length>10||options.className?.includes('sales-detail-table')||options.className?.includes('warehouse-table'));
    return `<div class="table-section" data-table-section><div class="table-wrap"><table class="data-table ${options.className||''}" data-table-title="${escapeAttr(options.title||'明细')}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${controls?`<div class="table-pagination"><span class="table-range" aria-live="polite"></span>${options.searchable?`<input type="search" data-table-search aria-label="搜索${escapeAttr(options.title||'明细')}" placeholder="${escapeAttr(options.searchPlaceholder||'搜索 SKU / 品名')}">`:""}<label>显示 <select data-page-size aria-label="${escapeAttr(options.title||'明细')}显示条数"><option value="50">50 条</option><option value="100">100 条</option><option value="200">200 条</option><option value="0">全部</option></select></label><button type="button" data-table-prev aria-label="${escapeAttr(options.title||'明细')}上一页">‹</button><span data-table-page></span><button type="button" data-table-next aria-label="${escapeAttr(options.title||'明细')}下一页">›</button></div>`:''}</div>${options.footnote?`<div class="table-footnote">${options.footnote}</div>`:''}`;
  }

  function tableCellValue(cell,index){
    const raw=cell?.dataset.sortValue??cell?.innerText??'';
    const text=raw.trim().replaceAll(',','').replaceAll('−','-');
    if(!text||text==='—'||text==='--')return null;
    if(index===0||/^\d{4}-\d{2}/.test(text))return text;
    const number=text.replace(/^[¥￥$€£]\s*/,'').match(/^([+-]?\d+(?:\.\d+)?)(?=\s|[%×天件单条]|$)/);
    return number?Number(number[1]):text;
  }

  function sortTable(table,column,direction){
    const rows=$$('tbody tr',table),multiplier=direction==='asc'?1:-1;
    rows.sort((left,right)=>{
      const a=tableCellValue(left.cells[column],column),b=tableCellValue(right.cells[column],column);
      if(a===null&&b===null)return Number(left.dataset.originalIndex)-Number(right.dataset.originalIndex);
      if(a===null)return 1;if(b===null)return -1;
      const value=typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b),'zh-CN',{numeric:true});
      return value*multiplier||Number(left.dataset.originalIndex)-Number(right.dataset.originalIndex);
    }).forEach(row=>$('tbody',table).appendChild(row));
    table.dataset.sortColumn=column;table.dataset.sortDirection=direction;
    $$('thead th',table).forEach((th,index)=>{th.setAttribute('aria-sort',index===column?(direction==='asc'?'ascending':'descending'):'none');const icon=$('[data-sort-column] i',th);if(icon)icon.textContent=index===column?(direction==='asc'?'↑':'↓'):'↕';});
  }

  function updateTablePage(table,reset=false){
    const section=table.closest('[data-table-section]');if(!section)return;
    const rows=$$('tbody tr',table),matches=rows.filter(row=>row.dataset.filterExcluded!=='true');
    const size=Number($('[data-page-size]',section)?.value??0),pages=size?Math.max(1,Math.ceil(matches.length/size)):1;
    const page=reset?1:Math.max(1,Math.min(pages,Number(table.dataset.page)||1));table.dataset.page=page;
    rows.forEach(row=>row.hidden=true);
    const start=size?(page-1)*size:0,end=size?Math.min(start+size,matches.length):matches.length;
    matches.slice(start,end).forEach(row=>row.hidden=false);
    const range=$('.table-range',section);if(range)range.textContent=`共 ${matches.length.toLocaleString()} 条${matches.length===rows.length?'':`（全部 ${rows.length.toLocaleString()} 条）`} · ${matches.length?start+1:0}–${end}`;
    const indicator=$('[data-table-page]',section);if(indicator)indicator.textContent=`${page} / ${pages}`;
    const prev=$('[data-table-prev]',section),next=$('[data-table-next]',section);
    if(prev)prev.disabled=page===1;if(next)next.disabled=page===pages;
    const count=$('#salesResultCount',table.closest('article'));if(count)count.textContent=matches.length.toLocaleString();
    return matches.length;
  }

  function bindDataTables(root=app){
    $$('.data-table',root).forEach(table=>{
      const section=table.closest('[data-table-section]');
      $$('[data-sort-column]',table).forEach(button=>button.addEventListener('click',()=>{
        const column=Number(button.dataset.sortColumn),direction=table.dataset.sortColumn===String(column)&&table.dataset.sortDirection==='asc'?'desc':'asc';
        sortTable(table,column,direction);updateTablePage(table,true);
        if(table.classList.contains('sales-detail-table')){const select=$('#salesSort',app);if(select)select.value='';}
      }));
      $('[data-table-search]',section)?.addEventListener('input',event=>{const term=event.target.value.trim().toLowerCase();$$('tbody tr',table).forEach(row=>row.dataset.filterExcluded=String(!row.innerText.toLowerCase().includes(term)));updateTablePage(table,true);});
      $('[data-page-size]',section)?.addEventListener('change',()=>updateTablePage(table,true));
      $('[data-table-prev]',section)?.addEventListener('click',()=>{table.dataset.page=Number(table.dataset.page)-1;updateTablePage(table);$('.table-wrap',section).scrollTop=0;});
      $('[data-table-next]',section)?.addEventListener('click',()=>{table.dataset.page=Number(table.dataset.page)+1;updateTablePage(table);$('.table-wrap',section).scrollTop=0;});
      updateTablePage(table,true);
    });
  }

  function lineChart(series,labels,options={}){
    const fullWidth=options.fullWidth||window.innerWidth<=1180;
    const width=options.width||Math.max(320,Math.round((app.clientWidth-56)*(fullWidth?1:2/3))),height=220,pad={l:options.wideAxis?104:48,r:18,t:20,b:34};
    const labelStep=Math.max(1,Math.ceil(labels.length/Math.max(2,Math.min(8,Math.floor((width-pad.l-pad.r)/80)))));
    const all=series.flatMap(item=>item.values).filter(value=>value!==null&&value!==undefined&&Number.isFinite(value));
    if(!all.length)return trendEmptyState(currentView==='ads'?'advertising':'sales','当前日期范围未返回对应指标的日记录');
    const lowest=Math.min(...all),highest=Math.max(...all),span=highest-lowest||Math.abs(highest)||1;
    const min=options.min??lowest-span*.1,max=options.max??highest+span*.1;
    const single=labels.length===1;
    const x=index=>single?(pad.l+width-pad.r)/2:pad.l+index*(width-pad.l-pad.r)/Math.max(1,labels.length-1);
    const y=value=>pad.t+(max-value)*(height-pad.t-pad.b)/(max-min||1);
    const path=values=>{let active=false;return values.map((value,index)=>{if(value===null||value===undefined||!Number.isFinite(value)){active=false;return ''}const segment=`${active?'L':'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;active=true;return segment;}).join(' ');};
    const ticks=[0,1,2,3,4]; const fmt=options.format||((value)=>Math.round(value));
    const area=`${path(series[0].values)} L${x(labels.length-1)} ${height-pad.b} L${x(0)} ${height-pad.b} Z`;
    const gradientId=`surfaceArea-${++chartSequence}`;
    const points=series.map((item,seriesIndex)=>item.values.map((value,index)=>{
      if(value===null||value===undefined||!Number.isFinite(value))return '';
      const isolated=!Number.isFinite(item.values[index-1])&&!Number.isFinite(item.values[index+1]);
      const displayValue=item.displayValues?.[index]??value;
      const display=(item.format||fmt)(displayValue);
      const label=labels[index]||`第 ${index+1} 期`;
      const color=item.className==='series-orange'?'var(--orange)':item.className==='series-teal'?'var(--teal)':item.className==='series-green'?'var(--green)':'var(--blue)';
      return `<g class="chart-point ${single||isolated?'single-point':''}" style="--point-color:${color}" tabindex="0" role="button" aria-label="${escapeAttr(`${label}，${item.name||`指标 ${seriesIndex+1}`} ${display}`)}" data-chart-x="${x(index)}" data-chart-date="${escapeAttr(label)}" data-chart-series="${escapeAttr(item.name||`指标 ${seriesIndex+1}`)}" data-chart-value="${escapeAttr(display)}"><circle class="chart-hit" cx="${x(index)}" cy="${y(value)}" r="12"/><circle class="chart-focus-dot" cx="${x(index)}" cy="${y(value)}" r="4"/>${single?`<text class="chart-single-value" x="${x(index)+10}" y="${y(value)+(seriesIndex%2?18:-10)}">${escapeAttr(`${item.name} ${display}`)}</text>`:''}</g>`;
    }).join('')).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${options.label||'趋势图'}">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a8cff" stop-opacity=".24"/><stop offset="1" stop-color="#4a8cff" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map(t=>{const value=min+(max-min)*t/4;const yy=y(value);return `<line class="axis-line" x1="${pad.l}" y1="${yy}" x2="${width-pad.r}" y2="${yy}"/>${options.hideYAxis?'':`<text class="axis-label" x="${pad.l-9}" y="${yy+4}" text-anchor="end">${fmt(value)}</text>`}`}).join('')}
      ${options.area===false||single||series[0].values.some(value=>value===null||value===undefined)?'':`<path class="surface-area" fill="url(#${gradientId})" d="${area}"/>`}
      ${series.map(item=>`<path class="${item.className}" d="${path(item.values)}"/>`).join('')}
      <line class="chart-guide-line" x1="0" y1="${pad.t}" x2="0" y2="${height-pad.b}" aria-hidden="true"/>
      ${labels.map((label,index)=>index%labelStep===0||index===labels.length-1?`<text class="axis-label" x="${x(index)}" y="${height-8}" text-anchor="middle">${label}</text>`:'').join('')}
      ${points}
    </svg>`;
  }

  function renderMiniLineChart(values,labels){
    const width=620,height=160,pad={l:14,r:14,t:18,b:25};
    const min=Math.min(...values),max=Math.max(...values),span=(max-min)||Math.abs(max)||1;
    const lower=min-span*.35,upper=max+span*.35;
    const single=values.length===1;
    const x=index=>single?width/2:pad.l+index*(width-pad.l-pad.r)/Math.max(1,values.length-1);
    const y=value=>pad.t+(upper-value)*(height-pad.t-pad.b)/(upper-lower||1);
    const path=data=>data.map((value,index)=>`${index?'L':'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    const area=`${path(values)} L${x(values.length-1)} ${height-pad.b} L${x(0)} ${height-pad.b} Z`;
    const points=values.map((value,index)=>`<g class="chart-point ${single?'single-point':''}" tabindex="0" role="button" aria-label="${escapeAttr(`${labels[index]||`第 ${index+1} 期`}，销售额 ${cny(value)}`)}" data-chart-x="${x(index)}" data-chart-date="${escapeAttr(labels[index]||`第 ${index+1} 期`)}" data-chart-series="销售额" data-chart-value="${escapeAttr(cny(value))}"><circle class="chart-hit" cx="${x(index)}" cy="${y(value)}" r="11"/><circle class="chart-focus-dot" cx="${x(index)}" cy="${y(value)}" r="3.5"/>${single?`<text class="chart-single-value" x="${x(index)}" y="${y(value)-12}" text-anchor="middle">${escapeAttr(cny(value))}</text>`:''}</g>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="销售额走势"><defs><linearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d99ff" stop-opacity=".32"/><stop offset="1" stop-color="#5d99ff" stop-opacity="0"/></linearGradient></defs>
      ${[0,1,2,3].map(i=>`<line class="grid-line" x1="${pad.l}" y1="${pad.t+i*35}" x2="${width-pad.r}" y2="${pad.t+i*35}"/>`).join('')}<path class="area-fill" d="${area}"/><path class="sales-line" d="${path(values)}"/><line class="chart-guide-line" x1="0" y1="${pad.t}" x2="0" y2="${height-pad.b}" aria-hidden="true"/>${labels.map((label,index)=>label?`<text class="chart-label" x="${x(index)}" y="${height-5}" text-anchor="middle">${escapeAttr(label)}</text>`:'').join('')}${points}</svg>`;
  }

  function modulePhases(modules){
    if(modules.every(name=>['idle','loading'].includes(loadState[name].phase)))return 'loading';
    if(modules.some(name=>['idle','loading'].includes(loadState[name].phase)))return 'partial';
    const failed=modules.filter(name=>loadState[name].phase==='error');
    if(failed.length===modules.length)return 'error';
    return failed.length?'partial':'ready';
  }
  function failedModulesText(modules){
    return modules.filter(name=>loadState[name].phase==='error').map(name=>name==='sales'?'销售':'广告').join('、');
  }

  function groupProductRows(products,keyOf){
    const groups=new Map();
    products.forEach(row=>{
      const key=String(keyOf(row)||'').trim()||'未标注';
      const item=groups.get(key)||{key,count:0,volume:0,orders:0,revenue:0,adSales:0,adVolume:0,netRevenue:0,grossProfit:0,hasProfit:false,sellers:new Set(),countries:new Set()};
      item.count+=1;
      item.volume+=toNumber(row.volume)||0;
      item.orders+=toNumber(row.orders)||0;
      item.revenue+=toNumber(row.revenue)||0;
      item.adSales+=toNumber(row.adSales)||0;
      item.adVolume+=toNumber(row.adVolume)||0;
      const net=toNumber(row.netRevenue),profit=toNumber(row.grossProfit);
      if(net!==null)item.netRevenue+=net;
      if(profit!==null){item.grossProfit+=profit;item.hasProfit=true}
      if(row.sellerName)item.sellers.add(row.sellerName);
      if(row.country)item.countries.add(row.country);
      groups.set(key,item);
    });
    return [...groups.values()];
  }

  function productIdentityCell(row,sku=row.localSku||row.asin||'未标注'){
    const asin=row.asin||'—',name=row.productName||'—';
    return {html:`<div class="product-identity-top"><b title="${escapeAttr(sku)}">${escapeAttr(sku)}</b><small class="product-asin">${escapeAttr(asin)}</small><span class="product-open" aria-hidden="true">↗</span></div><small class="product-name" title="${escapeAttr(name)}">${escapeAttr(name)}</small>`,className:'product-cell product-identity-cell'};
  }

  function productStoreCell(row){
    const store=row.sellerName||'未命名店铺',country=row.country||'—';
    return {html:`<span class="product-store-name" title="${escapeAttr(store)}">${escapeAttr(store)}</span><small class="product-country">${escapeAttr(country)}</small>`,className:'product-store-cell'};
  }

  function productFocusFlags(row,kind='sales'){
    const fields=kind==='ads'?['spend','adSales','adOrders']:kind==='traffic'?['impressions','clicks']:['revenue','volume','grossProfit','adOrders'];
    const values=fields.map(key=>toNumber(row[key]));
    const flags=[];
    if(values.some(value=>value===null))flags.push('missing');
    if(kind==='traffic'&&(toNumber(row.impressions)>0||toNumber(row.clicks)>0))flags.push('hasActivity');
    if(values.every(value=>value!==null&&value===0))flags.push('allZero');
    if(toNumber(row.grossProfit)!==null&&toNumber(row.grossProfit)<0)flags.push('loss');
    if(toNumber(row.spend)>0&&toNumber(row.adSales)===0)flags.push('adNoSales');
    return flags;
  }

  function productRowMeta(row,kind='sales'){
    const meta={source:row.source||(row.sourceMode==='supplement'?'lingxing_profit_report_asin':'amazon_product_stats'),store:row.sellerName||'未命名店铺',country:row.country||'',focus:productFocusFlags(row,kind).join(' '),
      search:[row.localSku,row.asin,row.productName,row.sellerName,row.country].filter(Boolean).join(' ').toLowerCase()};
    ['revenue','adSales','volume','grossProfit','spend','roas','sessions','conversionRate','impressions','clicks','ctr','bestRank'].forEach(key=>{meta[`sort-${key.toLowerCase()}`]=toNumber(row[key])??'';});
    return meta;
  }

  function productFilters(products,kind='sales',options={}){
    const stores=[...new Set(products.map(row=>row.sellerName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const countries=[...new Set(products.map(row=>row.country).filter(Boolean))].sort();
    const sorts=kind==='ads'?[['spend:desc','广告花费最高'],['roas:asc','ROAS 最低'],['adsales:desc','广告销售额最高']]:kind==='traffic'?[['impressions:desc','展示量最高'],['clicks:desc','点击量最高'],['ctr:desc','CTR 最高'],['volume:desc','销量最高'],...(products.some(row=>toNumber(row.bestRank)>0)?[['bestrank:asc','区间最佳排名']]:[])]:[['revenue:desc','销售额最高'],['grossprofit:asc','毛利润最低'],['volume:desc','销量最高']];
    const initialFocus=options.initialFocus??(kind==='traffic'?'hasActivity':'');
    return `<div class="sales-filter-bar clarity-filters"><input id="salesSearch" type="search" aria-label="搜索商品" placeholder="MSKU / ASIN / 品名" autocomplete="off"><select data-sales-filter="store" aria-label="筛选店铺">${optionList(stores,'全部店铺')}</select><select data-sales-filter="country" aria-label="筛选站点">${optionList(countries,'全部站点')}</select><select id="salesFocus" aria-label="筛选关注项" data-default-focus="${escapeAttr(initialFocus)}">${kind==='traffic'?`<option value="hasActivity" ${initialFocus==='hasActivity'?'selected':''}>有展示或点击</option>`:''}<option value="" ${initialFocus===''?'selected':''}>全部商品</option>${kind==='sales'?'<option value="loss">毛利为负</option>':''}${kind!=='traffic'?'<option value="adNoSales">有广告花费、无广告销售</option>':''}<option value="missing">${kind==='traffic'?'展示或点击缺字段':'关键字段缺失'}</option><option value="allZero">${kind==='traffic'?'展示与点击均为 0':'核心值均为 0'}</option></select><select id="salesSort" aria-label="商品排序"><option value="">表头排序</option>${sorts.map(([value,label],index)=>`<option value="${value}" ${kind==='traffic'&&index===0?'selected':''}>${label}</option>`).join('')}</select><button id="resetSalesFilters" type="button">重置</button></div>`;
  }

  function productTablePanel(products,{title='商品销售明细',footnote=''}){
    const rows=salesProductRows(products);
    return `<div class="panel-head"><h2>${escapeAttr(title)}</h2><span class="result-count">匹配 <b id="salesResultCount">${rows.length}</b> 条</span></div>${productFilters(products)}${rows.length?dataTable(['MSKU / ASIN / 品名','店铺 / 站点','销量',`销售额${metricHelp('销售额')}`,'广告订单',`广告销售额${metricHelp('广告销售额')}`,`毛利润${metricHelp('实际毛利润')}`,`毛利率${metricHelp('毛利率')}`],rows,{clickable:true,title,className:'sales-detail-table',footnote:footnote||'按所选日期范围汇总。搜索、筛选与排序作用于已返回的所有记录；点击商品查看完整字段。'}):emptyStateBlock('当前范围没有商品记录')}<div id="salesNoResults" class="filter-empty" hidden>没有匹配的商品，请调整筛选或重置。</div>`;
  }

  function dataQualityStrip(data,module='sales'){
    const summary=data?.summary||{},trend=Array.isArray(data?.trend)?data.trend:[],products=Array.isArray(data?.products)?data.products:[];
    const days=toNumber(summary.dataDays)??new Set(trend.map(row=>row.statsDate).filter(Boolean)).size;
    const end=summary.latestStatsDate||trend.map(row=>String(row.statsDate||'').slice(0,10)).sort().at(-1)||'';
    const kind=module==='advertising'?'ads':module==='traffic'?'traffic':'sales';
    const missing=products.filter(row=>productFocusFlags(row,kind).includes('missing')).length;
    const trafficCheck=products.filter(row=>productFocusFlags(row,kind).includes('trafficCheck')).length;
    const total=toNumber(module==='traffic'?data?.performanceTotal:data?.total);
    const listWarning=total!==null&&total>products.length?`<span class="quality-warn">已返回 ${products.length} / ${intText(total)} 条，请确认完整列表版本</span>`:'';
    const counts=[['销售额','revenueCount'],['销量','volumeCount'],['订单','ordersCount'],['毛利润','grossProfitCount'],['广告花费','spendCount'],['广告销售额','adSalesCount'],['访问次数','sessionsCount']].filter(([,key])=>summary[key]!==undefined);
    return `<section class="data-quality-strip" aria-label="数据完整性"><span class="quality-source">${days?`${days} 天有记录`:'日记录待核对'}${end?` · 数据截至 ${escapeAttr(String(end).slice(0,10))}`:''}</span><span class="quality-legend">— 未提供或不可计算 · 0 为源字段值</span>${listWarning}${trafficCheck?`<span class="quality-warn">${trafficCheck} 条有订单、访问为 0 · 待核对源字段</span>`:''}${missing?`<span class="quality-warn">${missing} 条缺关键字段</span>`:''}<details><summary>数据检查</summary><div class="quality-popover"><b>当前范围的数据覆盖</b>${counts.length?counts.map(([name,key])=>`<div><span>${name}</span><strong>${intText(summary[key])} 条非空记录</strong></div>`).join(''):'<p>当前接口未提供字段覆盖数，不能仅凭 0 判断同步完整性。</p>'}${[['Sessions Total 原列非零','sessionsNonZeroCount'],['PV Total 原列非零','pageViewsNonZeroCount'],['Buy Box 非零','buyBoxNonZeroCount'],['访问由分项合计','sessionsRebuiltFromComponentsCount']].filter(([,key])=>summary[key]!==undefined).map(([name,key])=>`<div><span>${name}</span><strong>${intText(summary[key])} 条记录</strong></div>`).join('')}<p>非空不代表已采集（数据库默认值也可能是 0）。缺字段为空，分母为零不计算比率。${products.length?`当前已加载 ${products.length} 条商品。`:''}</p></div></details></section>`;
  }

  function attentionPanel(data,kind='sales'){
    const products=Array.isArray(data?.products)?data.products:[];
    const loss=products.filter(row=>productFocusFlags(row,kind).includes('loss'));
    const noAdSales=products.filter(row=>productFocusFlags(row,kind).includes('adNoSales'));
    const missing=products.filter(row=>productFocusFlags(row,kind).includes('missing'));
    const zero=products.filter(row=>productFocusFlags(row,kind).includes('allZero'));
    const items=[...(kind==='sales'?[['loss','毛利为负',loss.length,'核对价格、成本和广告投入']]:[]),...(kind!=='traffic'?[['adNoSales','有广告花费、无广告销售',noAdSales.length,'核对转化和广告归因周期']]:[]),['missing','关键字段缺失',missing.length,'先核对同步和数据来源'],['allZero','核心值均为 0',zero.length,'可能真实无业务，需结合同步记录判断']];
    return `<article class="panel span-4 attention-panel"><div class="panel-head"><h2>当前列表 · 需要核对</h2><small>${products.length} 条商品</small></div><div class="attention-list">${items.map(([key,title,count,note])=>`<button type="button" data-focus-filter="${key}" ${count?'':'disabled'}><span><b>${title}</b><small>${note}</small></span><strong class="${count?'has-count':''}">${count}</strong></button>`).join('')}</div><div class="panel-footnote">仅统计当前已加载商品，不替代全部店铺的汇总。</div></article>`;
  }

  function dailyTrendPanel(data,module='sales',span='span-8'){
    const ad=module==='advertising';
    const trend=(Array.isArray(data?.trend)?data.trend:[]).filter(row=>row.statsDate).slice().sort((a,b)=>String(a.statsDate).localeCompare(String(b.statsDate)));
    const title=ad?'广告花费与广告销售额':'销售额与广告销售额';
    const series=[{name:ad?'广告销售额':'销售额',values:trend.map(row=>toNumber(row[ad?'adSales':'revenue'])),format:cny,className:'series-blue'},{name:ad?'广告花费':'广告销售额',values:trend.map(row=>toNumber(row[ad?'spend':'adSales'])),format:cny,className:'series-orange'}];
    return `<article class="panel ${span}"><div class="panel-head"><h2>${title}</h2><div class="chart-legend-light"><span>${series[0].name}</span><span style="--legend:var(--orange)">${series[1].name}</span></div></div>${trend.length?`<div class="panel-body chart-canvas">${lineChart(series,trend.map(row=>shortDate(String(row.statsDate).slice(0,10))),{label:title+'趋势',wideAxis:true,format:cny})}</div>${singleDayNote(trend)}`:trendEmptyState(module)}</article>`;
  }

  function collapsibleComparison(title,rows){
    return `<details class="panel secondary-details"><summary>${title}<span>展开</span></summary>${dataTable(['指标','本期','上期','变化'],rows,{title})}</details>`;
  }

  function overviewAlerts(){
    const summary=liveData.sales?.summary||{};
    const advertising=liveData.advertising?.summary||{};
    const products=Array.isArray(liveData.sales?.products)?liveData.sales.products:[];
    const revenue=toNumber(summary.revenue);
    const items=[];
    const negative=products.filter(row=>toNumber(row.grossProfit)<0);
    if(negative.length){
      items.push({route:'products',label:`${negative.length} 个商品毛利润为负`,detail:`合计毛利润 ${moneyText(negative.reduce((sum,row)=>sum+(toNumber(row.grossProfit)||0),0))}，点击定位具体 SKU`});
    }
    if(toNumber(summary.refundAmount)&&revenue){
      items.push({route:'sales',label:`退款金额 ${positiveMoneyText(summary.refundAmount)}`,detail:`占销售额 ${fixedPercent(sharePercent(summary.refundAmount,revenue))}，退款率 ${apiRatio(summary.refundRate)===null?'—':fixedPercent(apiRatio(summary.refundRate))}`});
    }
    if(toNumber(advertising.spend)&&revenue){
      items.push({route:'ads',label:`广告花费占销售额 ${fixedPercent(sharePercent(advertising.spend,revenue))}`,detail:`ACOS ${apiRatio(advertising.acos)===null?'—':fixedPercent(apiRatio(advertising.acos))} · ROAS ${decimalText(advertising.roas,2)}`});
    }
    const mix=(Array.isArray(liveData.sales?.siteMix)?liveData.sales.siteMix:[]).filter(row=>toNumber(row.revenue)>0).sort((left,right)=>toNumber(right.revenue)-toNumber(left.revenue));
    if(mix.length){
      const total=mix.reduce((sum,row)=>sum+(toNumber(row.revenue)||0),0);
      items.push({route:'sales',label:`${mix[0].sellerName||'未命名店铺'} 占销售额 ${fixedPercent(sharePercent(mix[0].revenue,total))}`,detail:`共 ${mix.length} 个店铺有销售额，点击查看店铺构成`});
    }
    return items.slice(0,4);
  }

  function overviewPulse(){
    const summary=liveData.sales?.summary||{};
    const change=liveData.sales?.change||{};
    const previous=liveData.sales?.previousSummary||{};
    const revenue=toNumber(summary.revenue);
    const adShare=sharePercent(summary.adSales,revenue);
    const trend=(Array.isArray(liveData.sales?.trend)?liveData.sales.trend:[]).filter(row=>row.statsDate&&toNumber(row.revenue)!==null).slice().sort((left,right)=>String(left.statsDate).localeCompare(String(right.statsDate))).slice(-12);
    const values=trend.map(row=>toNumber(row.revenue)||0);
    const labels=trend.map((row,index)=>index%2===0||index===trend.length-1?shortDate(String(row.statsDate).slice(0,10)):'');
    const dayAverage=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
    const badge=deltaBadge(change.revenue);
    const alerts=overviewAlerts();
    return `<section class="pulse-board" aria-label="经营脉搏">
      <div class="pulse-lead"><div class="eyebrow"><i></i>本期经营脉搏</div>
        <div class="pulse-value">${animatedNumber(moneyText(summary.revenue).replace(/ CNY$/,''))}<small> CNY</small></div>
        <div class="pulse-caption">销售额环比 <b>${badge?badge.text:'—'}</b> · 上期 ${moneyText(previous.revenue)} · 日均 ${moneyText(dayAverage)}</div>
        <div class="goal-track"><i style="width:${adShare===null?0:Math.min(100,adShare).toFixed(1)}%"></i></div>
        <div class="goal-line"><span>广告销售额占比</span><b>${adShare===null?'—':fixedPercent(adShare)}</b></div></div>
      <div class="pulse-chart"><div class="chart-head"><strong>销售额走势</strong><div class="chart-legend"><span>销售额</span></div></div><div class="line-chart">${values.length?renderMiniLineChart(values,labels):trendEmptyState('sales')}${singleDayNote(trend)}</div></div>
      <div class="pulse-alerts"><div class="alert-title"><strong>重点关注</strong><span>${alerts.length} 项</span></div>${alerts.length?alerts.map((item,index)=>`<button class="alert-item" data-route="${item.route}"><span>${String(index+1).padStart(2,'0')}</span><div><b>${escapeAttr(item.label)}</b><small>${escapeAttr(item.detail)}</small></div></button>`).join(''):'<div class="note-box">本期没有需要特别关注的指标</div>'}</div>
    </section>`;
  }

  function overviewCards(){
    const summary=liveData.sales?.summary||{};
    const change=liveData.sales?.change||{};
    const advertising=liveData.advertising?.summary||{};
    const revenue=toNumber(summary.revenue);
    const tacos=revenue?sharePercent(advertising.spend,revenue):null;
    const refundRate=apiRatio(summary.refundRate);
    const grossMargin=grossMarginPercent(summary);
    return [
      metric('销售额',moneyText(summary.revenue),{change:deltaBadge(change.revenue),context:`实际销售数量 ${intText(summary.volume)} 件`}),
      metric('实际毛利润',moneyText(summary.grossProfit),{accent:'var(--green)'}),
      metric('毛利率',grossMargin===null?'—':grossMargin.toFixed(1),{unit:grossMargin===null?'':'%',context:`实际毛利润 ${moneyText(summary.grossProfit)}`,accent:'var(--green)'}),
      tacos===null?metric('广告 TACOS','—',{context:'需要同期销售与广告数据'}):metric('广告 TACOS',tacos.toFixed(2),{unit:'%',context:`广告花费 ${moneyText(advertising.spend)}`,accent:'var(--orange)'}),
      refundRate===null?metric('退款率','—',{context:'接口未返回退款率'}):metric('退款率',refundRate.toFixed(1),{unit:'%',context:`退款金额 ${positiveMoneyText(summary.refundAmount)}`,accent:'var(--orange)'})
    ];
  }

  function overviewComparisonRows(){
    const salesSummary=liveData.sales?.summary||{};
    const salesPrevious=liveData.sales?.previousSummary||{};
    const salesChange=liveData.sales?.change||{};
    const adSummary=liveData.advertising?.summary||{};
    const adPrevious=liveData.advertising?.previousSummary||{};
    const adChange=liveData.advertising?.change||{};
    const acosNow=apiRatio(adSummary.acos),acosPrevious=apiRatio(adPrevious.acos);
    const items=[
      ['销售额',moneyText(salesSummary.revenue),moneyText(salesPrevious.revenue),salesChange.revenue,true],
      ['实际销售数量',intText(salesSummary.volume),intText(salesPrevious.volume),salesChange.volume,true],
      ['广告销售额',moneyText(salesSummary.adSales),moneyText(salesPrevious.adSales),salesChange.adSales,true],
      ['广告花费',moneyText(adSummary.spend),moneyText(adPrevious.spend),adChange.spend,false],
      ['ROAS',decimalText(adSummary.roas,2),decimalText(adPrevious.roas,2),adChange.roas,true],
      ['ACOS',acosNow===null?'—':fixedPercent(acosNow),acosPrevious===null?'—':fixedPercent(acosPrevious),adChange.acos,false]
    ];
    return items.map(item=>({record:item[0],cells:[item[0],item[1],item[2],deltaText(item[3],item[4])]}));
  }

  function overviewTemplate(){
    const modules=viewLoaders.overview;
    const phase=modulePhases(modules);
    const head=pageChrome('经营驾驶舱',`${dateRangeText()} · ${scopeText()} · 指标全部来自接口`,{export:true});
    if(phase==='loading'||loadState.sales.phase==='loading'||loadState.sales.phase==='idle')return `${head}${dataStateBlock({title:'正在加载经营数据…',message:`正在按 ${dateRangeText()} · ${scopeText()} 请求销售与广告接口。`,tone:'loading'})}`;
    if(phase==='error')return `${head}${dataStateBlock({title:'经营数据加载失败',message:`${loadState.sales.error||loadState.advertising.error||'接口未返回数据'}。已按 ${dateRangeText()} · ${scopeText()} 请求，可点击重试。`,tone:'error',retry:'overview'})}`;
    const summary=liveData.sales?.summary||{};
    const products=Array.isArray(liveData.sales?.products)?liveData.sales.products:[];
    const trend=Array.isArray(liveData.sales?.trend)?liveData.sales.trend:[];
    if(loadState.sales.phase==='error'){
      return `${head}${dataStateBlock({title:'销售数据加载失败',message:`${loadState.sales.error||'接口未返回数据'}。经营驾驶舱依赖销售数据，请重新加载。`,tone:'error',retry:'overview'})}`;
    }
    if(!toNumber(summary.revenue)&&!products.length&&!trend.length){
      return `${head}${dataStateBlock({title:'当前范围没有经营数据',message:`${dateRangeText()} · ${scopeText()} 下接口未返回销售数据，请调整日期或店铺范围后重试。`,tone:'empty',retry:'overview'})}`;
    }
    const warning=phase==='partial'&&modules.some(name=>loadState[name].phase==='error')?`<div class="note-box warn" style="margin-bottom:16px">${failedModulesText(modules)}数据加载失败：${escapeAttr(modules.map(name=>loadState[name].error).filter(Boolean)[0]||'接口未返回数据')}，相关指标显示为空。</div>`:'';
    return `${head}${warning}${dataQualityStrip(liveData.sales)}${overviewPulse()}${metricGrid(overviewCards(),'five')}
      <section class="section-grid"><article class="panel span-8"><div class="panel-head"><div><h2>核心指标 · 与上期对比</h2><p>本期与接口返回的上一周期同口径对比，点击行可下钻</p></div></div>${dataTable(['指标','本期','上期','变化'],overviewComparisonRows(),{clickable:true,title:'核心指标对比'})}</article>
      ${salesSiteMixPanel(liveData.sales||{})}</section>`;
  }

  function salesPageHead(title='销售与利润',subtitle=`${dateRangeText()} · ${scopeText()} · 金额取接口返回值`){
    return pageChrome(title,subtitle,{export:true});
  }

  function salesMetrics(data){
    const summary=data.summary||{};
    const change=data.change||{};
    const grossMargin=grossMarginPercent(summary);
    return [
      metric('销售额',moneyText(summary.revenue),{change:deltaBadge(change.revenue)}),
      metric('实际销售数量',intText(summary.volume),{unit:'件',change:deltaBadge(change.volume)}),
      metric('广告销售额',moneyText(summary.adSales),{change:deltaBadge(change.adSales),context:sharePercent(summary.adSales,summary.revenue)===null?'':`占销售额 ${fixedPercent(sharePercent(summary.adSales,summary.revenue))}`}),
      percentCard('退款率',summary.refundRate,{context:`退款金额 ${positiveMoneyText(summary.refundAmount)}`,accent:'var(--orange)'}),
      metric('退款金额',positiveMoneyText(summary.refundAmount),{context:sharePercent(summary.refundAmount,summary.revenue)===null?'':`占销售额 ${fixedPercent(sharePercent(summary.refundAmount,summary.revenue))}`,accent:'var(--orange)'}),
      metric('实际毛利润',moneyText(summary.grossProfit),{accent:'var(--green)'}),
      metric('毛利率',grossMargin===null?'—':grossMargin.toFixed(1),{unit:grossMargin===null?'':'%',context:`实际毛利润 ${moneyText(summary.grossProfit)}`,accent:'var(--green)'})
    ];
  }

  function salesProfitFlow(data){
    const summary=data.summary||{};
    const margin=grossMarginPercent(summary);
    const cells=[
      ['销售额',moneyText(summary.revenue),'100%'],
      ['广告销售额',moneyText(summary.adSales),fixedPercent(sharePercent(summary.adSales,summary.revenue))],
      ['实际毛利润',moneyText(summary.grossProfit),fixedPercent(sharePercent(summary.grossProfit,summary.revenue))],
      ['毛利率',margin===null?'—':fixedPercent(margin),'实际毛利润 ÷ 销售额'],
      ['退款金额',positiveMoneyText(summary.refundAmount),fixedPercent(sharePercent(summary.refundAmount,summary.revenue))]
    ];
    return cells.map(cell=>`<button data-metric="${escapeAttr(cell[0])}"><span>${escapeAttr(cell[0])}</span><b>${cell[1]}</b><small>${cell[2]}</small></button>`).join('');
  }

  function salesMonthlyRows(trend){
    const buckets=new Map();
    trend.forEach(row=>{
      const key=String(row.statsDate||'').slice(0,7);
      if(!key)return;
      const item=buckets.get(key)||{revenue:0,volume:0,adSales:0};
      item.revenue+=toNumber(row.revenue)||0;
      item.volume+=toNumber(row.volume)||0;
      item.adSales+=toNumber(row.adSales)||0;
      buckets.set(key,item);
    });
    const months=[...buckets.entries()].sort((left,right)=>left[0].localeCompare(right[0]));
    const rows=months.map(([key,item])=>({record:`${key} 汇总`,cells:[key,moneyText(item.revenue),intText(item.volume),moneyText(item.adSales),fixedPercent(sharePercent(item.adSales,item.revenue))]}));
    const total=months.reduce((acc,[,item])=>({revenue:acc.revenue+item.revenue,volume:acc.volume+item.volume,adSales:acc.adSales+item.adSales}),{revenue:0,volume:0,adSales:0});
    if(rows.length>1)rows.push({record:'合计',cells:[{html:'<b>合计</b>'},moneyText(total.revenue),intText(total.volume),moneyText(total.adSales),fixedPercent(sharePercent(total.adSales,total.revenue))]});
    return rows;
  }

  function salesSiteMixPanel(data){
    const mix=(Array.isArray(data.siteMix)?data.siteMix:[]).filter(row=>toNumber(row.revenue)>0).sort((left,right)=>toNumber(right.revenue)-toNumber(left.revenue));
    const head=`<div class="panel-head"><div><h2>店铺销售构成</h2><p>按接口返回的店铺销售额占比</p></div></div>`;
    if(!mix.length)return `<article class="panel span-4">${head}${emptyStateBlock('接口未返回 siteMix 店铺销售额数据')}</article>`;
    const total=mix.reduce((sum,row)=>sum+(toNumber(row.revenue)||0),0);
    const top=mix.slice(0,8);
    const leader=top[0];
    return `<article class="panel span-4">${head}<div class="rank-list product-rank">${top.map((row,index)=>{
      const share=sharePercent(row.revenue,total)||0;
      const name=row.sellerName||'未命名店铺';
      return `<button class="rank-row" data-metric="${escapeAttr(name)}"><i>${index+1}</i><span>${escapeAttr(name)}<small>${escapeAttr(row.country||'国家未标注')}</small></span><div class="bar-track"><i style="width:${share.toFixed(1)}%"></i></div><b>${share.toFixed(1)}%</b></button>`;
    }).join('')}</div><div class="panel-body compact"><div class="note-box"><strong>${escapeAttr(leader.sellerName||'未命名店铺')}</strong> 销售额占比最高，为 ${fixedPercent(sharePercent(leader.revenue,total))}；共 ${mix.length} 个店铺有销售额。</div></div></article>`;
  }

  function salesProductRows(products){
    return products.map(row=>{
      const sku=row.localSku||row.asin||'未标注';
      const margin=sharePercent(row.grossProfit,row.revenue);
      return {
        record:`${sku} / ${row.asin||'—'}`,
        sortValues:[sku,row.sellerName,row.volume,row.revenue,row.adOrders,row.adSales,row.grossProfit,margin],
        meta:{
          ...productRowMeta(row,'sales'),
          fields:JSON.stringify([
            ['MSKU / ASIN',`${sku} / ${row.asin||'—'}`],
            ['店铺 / 国家',`${row.sellerName||'未命名店铺'} / ${row.country||'—'}`],
            ['销售额（人民币）',moneyText(row.revenue,2)],
            ['原始销售额',originalMoneyText(row.originalAmount,row.currencyCode)],
            ['原始币种',row.currencyCode||'未标注'],
            ['换算汇率',row.sourceRate?`1 ${row.currencyCode||'原币'} = ${row.sourceRate} CNY`:'—'],
            ['广告销售额（人民币）',moneyText(row.adSales,2)],
            ['原始广告销售额',originalMoneyText(row.originalAdSales,row.currencyCode)],
            ['实际毛利润（人民币）',moneyText(row.grossProfit,2)],
            ['原始实际毛利润',originalMoneyText(row.originalGrossProfit,row.currencyCode)]
          ]),
          search:[sku,row.asin,row.productName,row.sellerName,row.country].filter(Boolean).join(' ').toLowerCase()
        },
        cells:[
          productIdentityCell(row,sku),
          productStoreCell(row),
          intText(row.volume),
          moneyText(row.revenue),
          intText(row.adOrders),
          moneyText(row.adSales),
          moneyText(row.grossProfit),
          margin===null?'—':fixedPercent(margin)
        ]
      };
    });
  }

  function optionList(values,label){
    return `<option value="">${label}</option>${values.map(value=>`<option value="${escapeAttr(value)}">${escapeAttr(value)}</option>`).join('')}`;
  }

  function salesTemplate(options={}){
    const state=loadState.sales;
    const head=()=>salesPageHead(options.title,options.subtitle);
    if(state.phase==='error')return `${head()}${dataStateBlock({title:'销售数据加载失败',message:`${state.error||'接口未返回数据'}。已按 ${dateRangeText()} · ${scopeText()} 请求，可点击重试。`,tone:'error',retry:'sales'})}`;
    if(state.phase!=='ready')return `${head()}${dataStateBlock({title:'正在加载销售数据…',message:`正在按 ${dateRangeText()} · ${scopeText()} 请求销售接口。`,tone:'loading'})}`;

    const data=liveData.sales||{};
    const summary=data.summary||{};
    const products=Array.isArray(data.products)?data.products:[];
    const trend=(Array.isArray(data.trend)?data.trend:[]).filter(row=>row.statsDate).slice().sort((left,right)=>String(left.statsDate).localeCompare(String(right.statsDate)));
    if(!products.length&&!trend.length&&!Number(summary.revenue)){
      return `${head()}${dataStateBlock({title:'当前范围没有销售数据',message:`${dateRangeText()} · ${scopeText()} 下接口未返回销售汇总、商品与趋势数据，请调整日期或店铺范围后重试。`,tone:'empty',retry:'sales'})}`;
    }

    const monthRows=salesMonthlyRows(trend);
    const labels=trend.map(row=>shortDate(String(row.statsDate).slice(0,10)));
    const revenueSeries=trend.map(row=>toNumber(row.revenue));
    const adSalesSeries=trend.map(row=>toNumber(row.adSales));
    const lastRevenue=revenueSeries[revenueSeries.length-1]??null;
    const previousRevenue=revenueSeries[revenueSeries.length-2]??null;
    const periodRevenue=revenueSeries.some(value=>value!==null)?revenueSeries.reduce((sum,value)=>sum+(value??0),0):null;
    const dayChange=lastRevenue!==null&&previousRevenue!==null?sharePercent(lastRevenue-previousRevenue,previousRevenue):null;

    return `${head()}${dataQualityStrip(data)}${metricGrid(salesMetrics(data),'four')}
      <section class="section-grid"><article class="panel span-12 profit-ledger"><div class="panel-head"><div><h2>销售额与实际毛利润</h2><p>按领星利润报表字段汇总，点击任一项可下钻查看明细</p></div></div><div class="profit-flow" aria-label="销售额汇总结构">${salesProfitFlow(data)}</div></article>
      <article class="panel span-12"><div class="panel-head"><div><h2>月度汇总</h2><p>由接口日趋势按自然月聚合</p></div></div>${monthRows.length?dataTable(['月份','销售额','销量','广告销售额','广告占比'],monthRows,{clickable:true,title:'月度汇总'}):emptyStateBlock('接口未返回日趋势数据，无法聚合月度汇总')}</article>
      <article class="panel span-8"><div class="panel-head"><div><h2>销售额与广告销售额趋势</h2><p>${dateRangeText()}</p></div><div class="chart-legend-light"><span>销售额</span><span style="--legend:var(--orange)">广告销售额</span></div></div>${trend.length?`<div class="panel-body chart-canvas">${lineChart([{name:'销售额',values:revenueSeries,format:cny,className:'series-blue'},{name:'广告销售额',values:adSalesSeries,format:cny,className:'series-orange'}],labels,{label:'销售额与广告销售额趋势',wideAxis:true,format:cny})}</div>${singleDayNote(trend)}<div class="chart-summary"><div><span>区间销售额</span><b>${moneyText(periodRevenue)}</b></div><div><span>最后一日销售额</span><b>${moneyText(lastRevenue)}</b></div><div><span>最后一日环比</span><b>${dayChange===null?'—':fixedPercent(dayChange)}</b></div></div>`:trendEmptyState('sales')}</article>
      ${salesSiteMixPanel(data)}
      <article class="panel span-12 sales-detail-panel">${productTablePanel(products,{title:'销售明细',subtitle:'按接口返回的商品行展示，支持页面内搜索与筛选',footnote:`数据来源：销售分析接口（${scopeText()}）。毛利率按实际毛利润 ÷ 销售额计算。`})}</article></section>`;
  }

  function productsTemplate(){
    const state=loadState.sales,head=pageChrome('展示与点击',`${dateRangeText()} · ${scopeText()}`,{export:true});
    if(state.phase==='error')return `${head}${dataStateBlock({title:'展示与点击读取失败',message:state.error,tone:'error',retry:'products'})}`;
    if(state.phase!=='ready'||state.detailsLoading&&!state.retainedDetails)return `${head}${dataStateBlock({title:'正在读取展示与点击',tone:'loading'})}`;
    if(state.detailsError&&!state.retainedDetails)return `${head}${dataStateBlock({title:'展示与点击明细尚未加载',message:state.detailsError,tone:'error',retry:'products'})}`;
    const data=liveData.sales||{},summary=data.summary||{},products=Array.isArray(data.performanceProducts)?data.performanceProducts:[];
    const trend=(Array.isArray(data.trend)?data.trend:[]).filter(row=>row.statsDate).slice().sort((a,b)=>String(a.statsDate).localeCompare(String(b.statsDate)));
    const hasActivity=row=>toNumber(row.impressions)>0||toNumber(row.clicks)>0;
    const hasRank=products.some(row=>toNumber(row.bestRank)>0);
    const headers=['MSKU / ASIN / 品名','店铺 / 站点',`展示量${metricHelp('展示量')}`,`点击量${metricHelp('点击量')}`,`CTR${metricHelp('点击率 CTR')}`,'销量',...(hasRank?['区间最佳排名']:[])];
    const rows=products.map(row=>{
      const ctr=sharePercent(row.clicks,row.impressions),rank=toNumber(row.bestRank)>0?toNumber(row.bestRank):null;
      return {record:`${row.localSku||row.asin||'未标注'} / ${row.sellerName||''}`,meta:productRowMeta({...row,ctr,bestRank:rank},'traffic'),sortValues:[row.localSku||row.asin,row.sellerName,row.impressions,row.clicks,ctr,row.volume,...(hasRank?[rank]:[])],cells:[productIdentityCell(row),productStoreCell(row),intText(row.impressions),intText(row.clicks),fixedPercent(ctr),intText(row.volume),...(hasRank?[rank===null?'—':`#${intText(rank)}`]:[])]};
    });
    const detailsTable=activityOnly=>`<article class="panel sales-detail-panel traffic-details"><div class="panel-head"><h2>商品展示与点击</h2><span class="result-count">匹配 <b id="salesResultCount">${rows.length}</b> 条</span></div>${productFilters(products,'traffic',{initialFocus:activityOnly?'hasActivity':''})}${rows.length?dataTable(headers,rows,{clickable:true,title:'商品展示与点击',className:`sales-detail-table traffic-product-table${hasRank?' has-rank':''}`,footnote:`CTR = 点击量 ÷ 展示量。— 表示未提供或无法计算；0 保留真实源值。${hasRank?'区间最佳排名为所选日期内已有排名的最小正数，不代表当前排名。':''}排序、筛选与分页作用于完整已加载列表。`}):emptyStateBlock('当前范围没有商品明细')}<div id="salesNoResults" class="filter-empty" hidden>没有符合筛选的商品，可切换“全部商品”查看零值与缺失记录。</div></article>`;
    if(!trend.some(hasActivity)&&!products.some(hasActivity))return `${head}<section class="panel traffic-empty"><div><strong>当前范围暂无展示或点击记录</strong><p>可调整日期或店铺；已有商品的零值与缺失字段保留在全部商品中。</p></div>${products.length?`<details class="traffic-all-details"><summary>查看全部商品（${intText(products.length)}）</summary>${detailsTable(false)}</details>`:''}</section>`;
    const sumDaily=key=>{const values=trend.map(row=>toNumber(row[key])).filter(value=>value!==null);return values.length?values.reduce((total,value)=>total+value,0):null;};
    const impressions=sumDaily('impressions'),clicks=sumDaily('clicks');
    const impressionsDays=trend.filter(row=>toNumber(row.impressions)!==null).length,clicksDays=trend.filter(row=>toNumber(row.clicks)!==null).length;
    const returnedFieldsComplete=trend.length>0&&impressionsDays===trend.length&&clicksDays===trend.length;
    const dayContext=count=>!trend.length?'暂无日记录':count===trend.length?`已返回 ${count} 天日记录`:`已返回 ${count} / ${trend.length} 天`;
    const cards=[metric('展示量',intText(impressions),{context:dayContext(impressionsDays),accent:'var(--teal)'}),metric('点击量',intText(clicks),{context:dayContext(clicksDays)}),metric('点击率 CTR',fixedPercent(returnedFieldsComplete?sharePercent(clicks,impressions):null),{context:returnedFieldsComplete?'按已返回日记录计算':'日字段不完整，暂不计算'})];
    if(toNumber(summary.orders)>0)cards.push(metric('订单量',intText(summary.orders),{context:'当前范围全部订单'}));
    if(toNumber(summary.volume)>0)cards.push(metric('销量',intText(summary.volume),{context:'当前范围全部销量'}));
    const labels=trend.map(row=>shortDate(String(row.statsDate).slice(0,10)));
    const chartSeries=[{key:'impressions',name:'每日展示量',className:'series-teal'},{key:'clicks',name:'每日点击量',className:'series-orange'}].filter(item=>trend.some(row=>toNumber(row[item.key])>0));
    const chartWidth=Math.max(320,Math.round((app.clientWidth-56)/(chartSeries.length>1&&window.innerWidth>800?2:1)));
    const charts=chartSeries.map(item=>`<article class="panel traffic-chart"><div class="panel-head"><h2>${item.name}</h2></div><div class="panel-body chart-canvas">${lineChart([{name:item.name,values:trend.map(row=>toNumber(row[item.key])),className:item.className}],labels,{label:`${item.name}趋势`,min:0,width:chartWidth,area:false,format:intText})}</div>${singleDayNote(trend)}</article>`).join('');
    const incomplete=trend.some(row=>toNumber(row.impressions)===null||toNumber(row.clicks)===null);
    return `${head}<div class="traffic-summary-note">展示与点击来自现有广告指标，不能替代商品全部访问次数。${incomplete?'部分日期缺字段，汇总仅包含已提供的日记录。':''}</div>${metricGrid(cards,`traffic-metrics traffic-metrics-${cards.length}`)}${charts?`<section class="traffic-charts${chartSeries.length===1?' single-chart':''}">${charts}</section>`:'<p class="traffic-coverage-note">当前范围暂无可绘制的展示或点击日趋势。</p>'}${detailsTable(true)}`;
  }

  function adsPageHead(){ return pageChrome('广告投放',`${dateRangeText()} · ${scopeText()}`,{export:true}); }

  function adsMetrics(data){
    const summary=data.summary||{},change=data.change||{},revenue=liveData.sales?.summary?.revenue,tacos=sharePercent(summary.spend,revenue);
    return [metric('广告花费',moneyText(summary.spend),{change:deltaBadge(change.spend,false),accent:'var(--orange)'}),metric('广告销售额',moneyText(summary.adSales),{change:deltaBadge(change.adSales)}),percentCard('ACOS',summary.acos,{context:'花费 / 广告销售额'}),multipleCard('ROAS',summary.roas,{context:'广告销售额 / 花费'}),metric('广告订单',intText(summary.adOrders),{unit:toNumber(summary.adOrders)===null?'':'单'}),metric('TACOS',fixedPercent(tacos),{context:'广告花费 / 总销售额',accent:'var(--orange)'})];
  }

  function adsComparisonRows(data){
    const current=data.summary||{};
    const previous=data.previousSummary||{};
    const change=data.change||{};
    const acosNow=apiRatio(current.acos),acosPrevious=apiRatio(previous.acos);
    const items=[
      ['广告花费',moneyText(current.spend),moneyText(previous.spend),change.spend,false],
      ['广告销售额',moneyText(current.adSales),moneyText(previous.adSales),change.adSales,true],
      ['ROAS',decimalText(current.roas,2),decimalText(previous.roas,2),change.roas,true],
      ['ACOS',acosNow===null?'—':fixedPercent(acosNow),acosPrevious===null?'—':fixedPercent(acosPrevious),change.acos,false]
    ];
    return items.map(item=>({record:item[0],cells:[item[0],item[1],item[2],deltaText(item[3],item[4])]}));
  }

  function adsProductRows(products){
    return products.map(row=>({record:`${row.localSku||row.asin||'未标注'} / ${row.asin||'—'}`,meta:productRowMeta(row,'ads'),sortValues:[row.localSku||row.asin,row.sellerName,row.spend,row.adSales,row.adOrders,sharePercent(row.spend,row.adSales),row.roas,apiRatio(row.asoas)??sharePercent(row.adSales,row.revenue)],cells:[productIdentityCell(row),productStoreCell(row),moneyText(row.spend),moneyText(row.adSales),intText(row.adOrders),fixedPercent(sharePercent(row.spend,row.adSales)),toNumber(row.roas)===null?'—':`${decimalText(row.roas,2)}×`,fixedPercent(apiRatio(row.asoas)??sharePercent(row.adSales,row.revenue))]}));
  }

  function adsTemplate(){
    const state=loadState.advertising,head=adsPageHead();
    if(state.phase==='error')return `${head}${dataStateBlock({title:'广告数据加载失败',message:state.error,tone:'error',retry:'advertising'})}`;
    if(state.phase!=='ready')return `${head}${dataStateBlock({title:'正在读取广告数据',tone:'loading'})}`;
    const data=liveData.advertising||{},products=Array.isArray(data.products)?data.products:[],rows=adsProductRows(products);
    return `${head}${dataQualityStrip(data,'advertising')}${metricGrid(adsMetrics(data),'six')}<section class="section-grid">${dailyTrendPanel(data,'advertising')}<article class="panel span-4"><div class="panel-head"><h2>与上期对比</h2></div>${dataTable(['指标','本期','上期','变化'],adsComparisonRows(data),{title:'广告与上期对比'})}</article><article class="panel span-12 sales-detail-panel"><div class="panel-head"><h2>商品广告表现</h2><span class="result-count">匹配 <b id="salesResultCount">${rows.length}</b> 条</span></div>${productFilters(products,'ads')}${rows.length?dataTable(['MSKU / ASIN / 品名','店铺 / 站点','广告花费','广告销售额','广告订单','ACOS','ROAS','广告销售占比'],rows,{clickable:true,title:'商品广告表现',className:'sales-detail-table',footnote:'广告订单不等于广告销量。ACOS = 花费 / 广告销售额；ROAS = 广告销售额 / 花费。搜索与排序作用于全部商品。'}):emptyStateBlock('当前范围没有商品广告记录')}<div id="salesNoResults" class="filter-empty" hidden>没有匹配的商品。</div></article></section>`;
  }

  function inventoryTemplate(){
    const scopeLabel='Amazon FBA v2 最新完整库存快照；顶部日期仅影响销量；Excel 月度报表按页内月份查看';
    const head=pageChrome('库存中心',scopeLabel,{export:false,related:false});
    if(!window.InventoryWorkspace)return `${head}${dataStateBlock({title:'库存页面文件未完整加载',message:'请上传 inventory-workspace.js 与 inventory-workspace.css 后强制刷新页面。',tone:'error',retry:'inventory'})}`;
    return head+`<details class="inventory-demo-preview"><summary>库存中心六页原型预览 <small>演示数据</small></summary><p>以下原型使用虚拟数据，实际库存请查看下方库存工作区。</p><iframe src="./inventory-center-demo.html" title="库存中心演示原型" loading="lazy"></iframe></details>`+inventorySubnav('inventory')+window.InventoryWorkspace.render({data:liveData.inventory,state:loadState.inventory,scopeKey:moduleScopeKey('inventory'),scopeLabel})+inventorySeasonalitySection()+relatedAnalysisNav('inventory');
  }

  function inventorySubnav(active){if(active==='inventory')return '';return `<nav class="oi-subnav" aria-label="库存与采购"><a href="#inventory"${active==='inventory'?' aria-current="page"':''}>库存总览</a><a href="#replenishment"${active==='replenishment'?' aria-current="page"':''}>采购与补货</a></nav>`;}
  function replenishmentTemplate(){return pageChrome('采购与补货建议','采购与补货所需数据准备',{export:false,related:false})+inventorySubnav('replenishment')+(window.OverseasInventory?.replenishment()||dataStateBlock({title:'采购页面文件未完整加载',message:'请刷新页面后重试。',tone:'error'}));}

  function logisticsTransitMetric(source){
    const sampleCount=toNumber(source?.sampleCount),averageDays=toNumber(source?.averageDays);
    const validCount=sampleCount===null?null:Math.max(0,Math.trunc(sampleCount));
    return {sampleCount:validCount,averageDays:validCount>0&&averageDays>0?averageDays:null};
  }

  function logisticsDaysText(value){
    return value>0&&value<.01?'＜0.01':decimalText(value,2);
  }

  function logisticsHistoricalScope(transport){return transport?.scope==='ALL_HISTORY'&&transport.dateFiltered===false;}

  function logisticsTransitStatus(source){
    const metric=logisticsTransitMetric(source);
    if(metric.sampleCount===null)return {label:'尚未读取',reason:'历史签收统计尚未返回，请重新加载或核对后端版本。'};
    if(metric.sampleCount>0)return {label:metric.sampleCount<5?'历史样本较少':'条历史签收记录',reason:'全部历史签收天数大于0的来源记录参与平均值，不受日期筛选限制。'};
    if(toNumber(source?.fieldPresentCount)===0)return {label:'签收字段未读到',reason:'全部历史同步记录未读到签收天数字段；不能据此判断源表没有数据，请同步后核对来源。'};
    const missing=Math.max(0,toNumber(source?.missingCount)||0),invalid=Math.max(0,toNumber(source?.invalidCount)||0),nonPositive=Math.max(0,toNumber(source?.nonPositiveCount)||0);
    if(invalid>0)return {label:nonPositive===invalid?'仅读到0或负数':'签收结果未读完整',reason:`全部历史记录中，${intText(nonPositive)}条为0或负数，${intText(Math.max(0,invalid-nonPositive))}条无法计算，${intText(missing)}条为空或占位；请重新同步并核对读取结果。`};
    return {label:'签收结果未读到',reason:`全部历史同步记录有${intText(missing)}条签收天数为空或占位；源表可能已有数值，请重新同步并核对来源。`};
  }

  function logisticsTransitCells(source){
    const {sampleCount,averageDays}=logisticsTransitMetric(source),status=logisticsTransitStatus(source);
    return [averageDays===null?`<span class="logistics-unavailable" title="${escapeAttr(status.reason)}">—</span>`:`<b class="logistics-transit-days">${logisticsDaysText(averageDays)}</b><span class="logistics-day-unit"> 天</span>`,sampleCount===null?'<span class="logistics-sample-note">尚未读取</span>':`<span title="${escapeAttr(status.reason)}">${intText(sampleCount)}<small class="logistics-sample-note${sampleCount>0&&sampleCount<5?' few':''}">${status.label}</small></span>`];
  }

  function logisticsTransitPendingReason(transport,failed=false){
    if(logisticsPartPending('breakdown'))return '历史签收统计正在后台读取';
    if(failed)return '本次历史签收统计读取失败';
    if(!logisticsHistoricalScope(transport))return '需更新后端 R38 后查看历史签收统计';
    if(transport.available!==true)return '历史签收统计暂未读取';
    if(toNumber(transport.sourceRowCount)===0)return '暂无历史发货记录';
    return '全部历史记录暂未读到签收正值';
  }

  function logisticsHistoryCell(content,filters,title,verified){
    if(!verified)return content;
    return `<button type="button" class="logistics-history-open" data-logistics-open data-logistics-history="true" data-record="${escapeAttr(title)}" data-logistics-filters="${escapeAttr(JSON.stringify(filters))}" aria-label="查看${escapeAttr(title)}">${content}</button>`;
  }

  function logisticsBreakdownRows(rows,type,showTransit=false){
    const historyVerified=loadState.logistics.failedParts?.includes('breakdown')!==true&&logisticsHistoricalScope(liveData.logisticsBreakdown?.transport)&&liveData.logisticsBreakdown.transport.available===true;
    return (Array.isArray(rows)?rows:[]).map(row=>{
      const name=type==='country'?row.country||'未填写':row.providerName||row.sourceId||'未填写';
      const channel=String(row.channel||'未填写'),country=String(row.country||'未填写');
      const signed=historyVerified?row.transitMetrics?.delivered:undefined,transit=logisticsTransitMetric(signed);
      const filters=type==='country'?{country:row.country||'未填写'}:{...(row.sourceId?{sourceId:row.sourceId}:{provider:name}),...(type==='channel'?{country:row.country||'未填写',channel:row.channel||'未填写'}:{})};
      const channelCells=type==='channel'?[{html:escapeAttr(country)+(row.historicalOnly===true&&!logisticsAllDates?'<small class="logistics-historical-only">本期无发货</small>':''),className:'logistics-country-cell'},{html:escapeAttr(channel),className:'logistics-channel-cell'}]:[];
      const trackingValues=type==='provider'?[row.trackingCount,sharePercent(row.trackingCount,row.shipmentRows)]:[];
      const trackingCells=type==='provider'?[intText(row.trackingCount),fixedPercent(sharePercent(row.trackingCount,row.shipmentRows))]:[];
      const timingCells=showTransit?logisticsTransitCells(signed).map(cell=>logisticsHistoryCell(cell,filters,`${name} / ${country} / ${channel} · 历史签收结果`,historyVerified)):[];
      return {
        record:type==='channel'?`${name} / ${country} / ${channel}`:String(name),
        sortValues:[name,...(type==='channel'?[country,channel]:[]),row.shipmentRows,row.cartons,...trackingValues,...(showTransit?[transit.averageDays,transit.sampleCount]:[])],
        meta:{'logistics-filters':JSON.stringify(filters),fields:JSON.stringify([[type==='country'?'国家':'物流商',name],...(type==='channel'?[['国家',country],['源表渠道',channel]]:[]),[logisticsAllDates?'全部发货记录':'本期发货记录',row.shipmentRows??'—'],[logisticsAllDates?'全部箱数':'本期箱数',row.cartons??'—'],...(showTransit?[['历史平均运输天数',transit.averageDays===null?logisticsTransitStatus(signed).label:`${logisticsDaysText(transit.averageDays)} 天`],['历史签收样本',transit.sampleCount??'—'],['计算口径','全部历史签收天数大于0的来源行等权平均；不受顶部日期筛选限制']]:[])])},
        cells:[escapeAttr(name),...channelCells,intText(row.shipmentRows),intText(row.cartons),...trackingCells,...timingCells]
      };
    });
  }

  function logisticsTransportNote(transport,hasTransit,failed=false){
    if(logisticsPartPending('breakdown'))return `<div class="logistics-transport-note" role="status"><b>历史签收统计正在后台读取</b><span>发货汇总先显示，物流商与渠道时效读取完成后自动更新。</span></div>`;
    if(failed)return '<div class="logistics-transport-note pending"><b>本次历史签收统计读取失败</b><span>请重新加载；发货统计仍使用顶部日期范围。</span></div>';
    if(!logisticsHistoricalScope(transport))return '<div class="logistics-transport-note pending"><b>历史签收统计需要后端 R38</b><span>请完整更新后端后重新加载。历史平均运输天数及样本暂不显示，避免使用旧版日期口径。</span></div>';
    if(transport.available!==true)return '<div class="logistics-transport-note pending"><b>历史签收统计暂未读取</b><span>请重新加载；发货记录仍可查看。</span></div>';
    const metric=transport.summary?.delivered||{},sourceRows=toNumber(transport.sourceRowCount),status=logisticsTransitStatus(metric);
    const counts=[`历史签收样本 ${intText(metric.sampleCount)} 条`,`空白 / 点号 ${intText(metric.missingCount)} 条`,`0或负数 ${intText(metric.nonPositiveCount)} 条`,`其他未识别 ${intText(Math.max(0,(toNumber(metric.invalidCount)||0)-(toNumber(metric.nonPositiveCount)||0)))} 条`];
    if(toNumber(metric.formulaDerivedCount)>0)counts.push(`日期回算 ${intText(metric.formulaDerivedCount)} 条`);
    const detail=hasTransit?'全部历史正值均参与平均运输天数，不受顶部日期筛选限制。负数、0、点号及空值不参与均值；发货记录、箱数、趋势和跟踪覆盖率仍按当前发货日期统计。':sourceRows===0?'已同步范围内暂无历史记录，请执行同步。':`${status.reason}历史签收统计不受顶部日期筛选限制。`;
    return `<div class="logistics-transport-note${hasTransit?'':' pending'}"><b>全部历史签收记录</b><span>${counts.join(' · ')}</span><small>${escapeAttr(detail)}</small></div>`;
  }

  function logisticsPerformancePanel(breakdown,transport,failed){
    const providers=Array.isArray(breakdown.providerRows)?breakdown.providerRows:[],channels=Array.isArray(breakdown.channelRows)?breakdown.channelRows:[];
    if(!providers.length&&logisticsPartPending('breakdown'))return '<article class="panel span-12 logistics-performance"><div class="panel-head"><h2>物流商与渠道表现</h2></div>'+logisticsPartPlaceholder('breakdown','物流商与历史签收统计')+'</article>';
    if(!providers.length)return '<article class="panel span-12 logistics-performance"><div class="panel-head"><h2>物流商与渠道表现</h2></div>'+emptyStateBlock('当前范围暂无物流商汇总数据')+'</article>';
    const historyVerified=!failed&&logisticsHistoricalScope(transport)&&transport.available===true,countScope=logisticsAllDates?'全部':'本期';
    const headers=['物流商 / 展开渠道',`${countScope}发货记录`,`${countScope}箱数`,`${countScope}跟踪覆盖率`,`历史平均运输天数${metricHelp('历史平均运输天数')}`,'历史签收样本','发货明细'];
    const head=headers.map((label,index)=>{const help=String(label).match(/<button\b[\s\S]*?<\/button>/g)||[];const text=String(label).replace(/<button\b[\s\S]*?<\/button>/g,'');return `<span class="logistics-provider-col" ${index===6?'':`data-provider-heading="${index}"`}><button type="button" data-provider-sort="${index}" ${index===6?'disabled':''}>${text}${index===6?'':' <i aria-hidden="true">↕</i>'}</button>${help.join('')}</span>`;}).join('');
    const rows=providers.map((provider,index)=>{
      const name=String(provider.providerName||provider.sourceId||'未填写'),key=String(provider.sourceId||name),ownChannels=channels.filter(row=>provider.sourceId?String(row.sourceId)===String(provider.sourceId):String(row.providerName||row.sourceId||'未填写')===name);
      const countryCount=new Set(ownChannels.map(row=>row.country||'未填写')).size,transit=logisticsTransitMetric(historyVerified?provider.transitMetrics?.delivered:undefined),cells=logisticsTransitCells(historyVerified?provider.transitMetrics?.delivered:undefined),rate=sharePercent(provider.trackingCount,provider.shipmentRows);
      const filterObject=provider.sourceId?{sourceId:provider.sourceId}:{provider:name},filters=JSON.stringify(filterObject);
      const historyCells=cells.map(cell=>logisticsHistoryCell(cell,filterObject,`${name} · 历史签收结果`,historyVerified));
      const children=logisticsBreakdownRows(ownChannels,'channel',true).map(row=>({...row,cells:row.cells.slice(1),sortValues:row.sortValues.slice(1)}));
      const sortValues=[name,provider.shipmentRows,provider.cartons,rate,transit.averageDays,transit.sampleCount];
      return `<details class="logistics-provider-group" data-provider-group data-original-index="${index}" data-provider-key="${escapeAttr(key)}" data-provider-search="${escapeAttr([name,...ownChannels.map(row=>`${row.country||''} ${row.channel||''}`)].join(' ').toLowerCase())}" data-provider-values="${escapeAttr(JSON.stringify(sortValues))}"><summary class="logistics-provider-grid"><span class="logistics-provider-name"><i aria-hidden="true">›</i><span><b>${escapeAttr(name)}</b><small>${ownChannels.length} 个渠道 · ${countryCount} 个国家 / 地区</small>${provider.historicalOnly===true&&!logisticsAllDates?'<small class="logistics-historical-only">本期无发货 · 可查历史签收</small>':''}</span></span><span>${intText(provider.shipmentRows)}</span><span>${intText(provider.cartons)}</span><span title="已填写跟踪号 ${intText(provider.trackingCount)} 条">${fixedPercent(rate)}</span><span>${historyCells[0]}</span><span>${historyCells[1]}</span><span><button type="button" class="text-button" data-logistics-open data-record="${escapeAttr(`物流商：${name}`)}" data-logistics-filters="${escapeAttr(filters)}">查看发货 ↗</button></span></summary><div class="logistics-provider-channels"><div class="logistics-channel-caption"><b>${escapeAttr(name)} · 国家与渠道</b><span>点击渠道行查看${countScope}发货；点击历史均值或样本查看历史签收</span></div>${children.length?dataTable(['国家','渠道（源表原文）',`${countScope}发货记录`,`${countScope}箱数`,`历史平均运输天数${metricHelp('历史平均运输天数')}`,'历史签收样本'],children,{clickable:true,title:`${name}渠道表现`,searchable:true,searchPlaceholder:'搜索国家 / 渠道',className:'logistics-nested-channel-table'}):emptyStateBlock('本物流商暂未返回渠道汇总')}</div></details>`;
    }).join('');
    return `<article class="panel span-12 logistics-performance logistics-combined-panel"><div class="panel-head"><div><h2>物流商与渠道表现</h2><p>展开物流商查看各国渠道；历史时效固定计算全部签收正值</p></div><small>${providers.length} 家 · ${channels.length} 个渠道</small></div><div class="logistics-performance-scopes"><span><i></i>发货统计：${escapeAttr(logisticsDateRangeText())}</span><span class="historical"><i></i>运输时效：${historyVerified?'全部历史签收记录':'历史口径待确认'}</span></div><div class="logistics-provider-toolbar"><input type="search" data-provider-search-input aria-label="搜索物流商、国家或渠道" placeholder="搜索物流商 / 国家 / 渠道"><button type="button" class="text-button" data-provider-expand>展开本页渠道</button><button type="button" class="text-button" data-provider-collapse>收起全部</button></div><div class="logistics-provider-scroll"><div class="logistics-provider-grid logistics-provider-head">${head}</div><div data-provider-list>${rows}</div><p class="logistics-provider-empty" data-provider-empty hidden>没有匹配的物流商、国家或渠道</p></div><div class="table-pagination logistics-provider-pagination"><span class="table-range" data-provider-range aria-live="polite"></span><label>显示 <select data-provider-size aria-label="物流商显示条数"><option value="50">50 家</option><option value="100">100 家</option><option value="0">全部</option></select></label><button type="button" data-provider-prev aria-label="上一页物流商">‹</button><span data-provider-page></span><button type="button" data-provider-next aria-label="下一页物流商">›</button></div><div class="table-footnote">历史签收样本 = 全部历史签收天数大于0的记录，不受顶部日期限制。点击历史均值或样本可核对历史记录；点击“查看发货”使用当前发货日期。建议在同国家、同渠道比较历史时效。</div></article>`;
  }

  function bindLogisticsPerformance(){
    const panel=$('.logistics-combined-panel',app);if(!panel)return;
    const list=$('[data-provider-list]',panel),groups=()=>$$('[data-provider-group]',list);let page=1;
    panel._setProviderPage=value=>{page=value;update();};
    const update=(reset=false)=>{
      if(reset)page=1;const term=$('[data-provider-search-input]',panel).value.trim().toLowerCase(),rows=groups(),matches=rows.filter(row=>row.dataset.providerSearch.includes(term));
      const size=Number($('[data-provider-size]',panel).value),pages=size?Math.max(1,Math.ceil(matches.length/size)):1;page=Math.max(1,Math.min(page,pages));panel.dataset.providerPage=page;const start=size?(page-1)*size:0,end=size?Math.min(start+size,matches.length):matches.length;
      rows.forEach(row=>row.hidden=true);matches.slice(start,end).forEach(row=>row.hidden=false);
      $('[data-provider-range]',panel).textContent=`共 ${matches.length} 家${matches.length===rows.length?'':`（全部 ${rows.length} 家）`} · ${matches.length?start+1:0}–${end}`;
      $('[data-provider-page]',panel).textContent=`${page} / ${pages}`;$('[data-provider-prev]',panel).disabled=page===1;$('[data-provider-next]',panel).disabled=page===pages;$('[data-provider-empty]',panel).hidden=matches.length!==0;
    };
    $$('[data-provider-sort]',panel).forEach(button=>button.addEventListener('click',()=>{
      const column=Number(button.dataset.providerSort),direction=panel.dataset.sortColumn===String(column)&&panel.dataset.sortDirection==='asc'?'desc':'asc',sign=direction==='asc'?1:-1;
      groups().sort((a,b)=>{const av=JSON.parse(a.dataset.providerValues)[column],bv=JSON.parse(b.dataset.providerValues)[column];if(av===null&&bv===null)return Number(a.dataset.originalIndex)-Number(b.dataset.originalIndex);if(av===null)return 1;if(bv===null)return -1;return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'zh-CN',{numeric:true}))*sign||Number(a.dataset.originalIndex)-Number(b.dataset.originalIndex);}).forEach(row=>list.appendChild(row));
      panel.dataset.sortColumn=column;panel.dataset.sortDirection=direction;$$('[data-provider-sort] i',panel).forEach(icon=>icon.textContent=icon.closest('button')===button?(direction==='asc'?'↑':'↓'):'↕');update(true);
    }));
    $('[data-provider-search-input]',panel).addEventListener('input',()=>update(true));$('[data-provider-size]',panel).addEventListener('change',()=>update(true));
    $('[data-provider-prev]',panel).addEventListener('click',()=>{page--;update();});$('[data-provider-next]',panel).addEventListener('click',()=>{page++;update();});
    $('[data-provider-expand]',panel).addEventListener('click',()=>groups().filter(row=>!row.hidden).forEach(row=>row.open=true));$('[data-provider-collapse]',panel).addEventListener('click',()=>groups().forEach(row=>row.open=false));update(true);
  }

  function logisticsSyncDisplay(sync,loading=false){
    const running=logisticsSyncState.running||logisticsTaskRunning(sync);
    const total=toNumber(sync.totalSources),completed=toNumber(sync.completedSources);
    const progress=total>0&&completed!==null?` ${intText(Math.min(total,Math.max(0,completed)))}/${intText(total)} 来源`:'';
    const busy=logisticsSyncState.initiating||running||logisticsSyncState.uncertain||logisticsSyncState.checking||logisticsSyncState.refreshing;
    const labels={SUCCESS:'同步成功',PARTIAL_FAILURE:'部分成功',FAILED:'同步失败'};
    const label=logisticsSyncState.initiating?'正在提交同步':logisticsSyncState.uncertain?(logisticsSyncState.checking?'正在查询同步状态':'同步状态待确认'):running?`同步中${progress}`:loading?'读取中':labels[sync.lastRunStatus]||sync.lastRunStatus||(!sync.enabled||!sync.tokenConfigured?'待同步':'已连接');
    const tone=logisticsSyncState.uncertain?'warn':running||logisticsSyncState.initiating?'neutral':sync.lastRunStatus==='SUCCESS'?'ok':['PARTIAL_FAILURE','FAILED'].includes(sync.lastRunStatus)?'warn':'neutral';
    return {label,tone,disabled:busy||loading||!sync.enabled||!sync.tokenConfigured,button:logisticsSyncState.initiating?'提交中…':logisticsSyncState.uncertain?'待确认状态':running?'同步中…':logisticsSyncState.refreshing?'更新报表…':'立即同步'};
  }
  function logisticsSyncFeedback(){
    const sync=liveData.logisticsStatus||{};
    const running=logisticsSyncState.running||logisticsTaskRunning(sync);
    if(logisticsSyncState.initiating)return '<div class="logistics-job-note" role="status"><b>正在提交同步任务</b><span>当前报表继续显示，提交后可查看后台进度。</span></div>';
    if(logisticsSyncState.uncertain)return `<div class="logistics-job-note warn" role="status"><b>同步状态待确认</b><span>${escapeAttr(logisticsSyncState.error||'正在核对后台任务，暂不重复提交。')}</span><button type="button" class="text-button" data-action="logistics-check-status" ${logisticsSyncState.checking?'disabled':''}>${logisticsSyncState.checking?'查询中…':'查询同步状态'}</button></div>`;
    if(running){
      const total=toNumber(sync.totalSources),completed=toNumber(sync.completedSources);
      const current=sync.currentSource?`正在处理 ${String(sync.currentSource)}`:'后台正在读取物流数据源';
      return `<div class="logistics-job-note" role="status"><b>${escapeAttr(logisticsSyncDisplay(sync).label)}</b><span>${escapeAttr(current)}${sync.syncedRows===undefined?'':` · 已写入 ${intText(sync.syncedRows)} 行`}</span>${total>0&&completed!==null?`<progress max="${total}" value="${Math.min(total,Math.max(0,completed))}" aria-label="已完成数据源"></progress>`:''}<small>${escapeAttr(logisticsSyncState.error||'同步完成后自动更新当前范围；现有报表可继续查看。')}</small></div>`;
    }
    return logisticsSyncState.message?`<div class="logistics-job-note" role="status"><span>${escapeAttr(logisticsSyncState.message)}</span></div>`:'';
  }

  function logisticsItemRows(items){
    return (Array.isArray(items)?items:[]).map(row=>({
      record:`${row.shipmentNo||row.fbaNo||row.trackingNo||'物流记录'} · ${row.sourceId||''}/${row.sourceRowId||row.id||''}`,
      meta:{
        'logistics-item':'true',
        search:[row.shipmentNo,row.fbaNo,row.trackingNo,row.product,row.providerName,row.country].filter(Boolean).join(' ').toLowerCase(),
        fields:JSON.stringify([
          ['来源记录',`${row.sourceId||'—'} / ${row.sourceRowId||row.id||'—'}`],['签收天数',toNumber(row.signedDays)>0?`${logisticsDaysText(toNumber(row.signedDays))} 天`:'—'],['签收读取情况',row.signedDaysReason||'需更新后端 R37 后查看签收明细'],['发货日期',row.shipDate],['销售',row.salesperson],['发货单号',row.shipmentNo],['FBA号（货件号）',row.fbaNo],
          ['物流入仓号',row.inboundNo],['跟踪号',row.trackingNo],['国家',row.country],['物流商、国家、渠道',row.providerCountryChannel],
          ['是否单独报关',row.separateDeclaration],['备注',row.remark],['箱数',row.cartons],['实重',row.actualWeight],
          ['材积重',row.volumetricWeight],['方数',row.cubicVolume],['仓库重',row.warehouseWeight],['总仓库重',row.totalWarehouseWeight],
          ['计费重',row.chargeableWeight],['单价',row.unitPrice],['仓库代码',row.warehouseCode],['产品',row.product],['附加费名称',row.surchargeName]
        ].map(([label,value])=>[label,value===null||value===undefined||String(value).trim()===''?'—':String(value)]))
      },
      cells:[
        {html:`<b>${escapeAttr(row.shipmentNo||row.fbaNo||'—')}</b><small>${escapeAttr(row.trackingNo||'无跟踪号')} · ${escapeAttr(row.product||'未填写产品')}</small>`,className:'product-cell'},
        `${escapeAttr(row.providerName||row.sourceId||'未填写')} / ${escapeAttr(row.country||'—')}`,
        escapeAttr(row.shipDate||'未读到日期'),intText(row.cartons),escapeAttr(row.warehouseCode||'—')
      ]
    }));
  }

  function fulfillmentTemplate(){
    const state=loadState.logistics;
    const sync=liveData.logisticsStatus||{};
    const loading=state.phase==='loading';
    const syncDisplay=logisticsSyncDisplay(sync,loading),{tone,label}=syncDisplay;
    const overview=liveData.logisticsOverview||{};
    const summary=overview.summary||{};
    const trend=Array.isArray(liveData.logisticsTrend?.trend)?liveData.logisticsTrend.trend:[];
    const cartonSeries=trend.map(row=>toNumber(row.cartons));
    const breakdown=liveData.logisticsBreakdown||{};
    const breakdownFailed=state.failedParts?.includes('breakdown')===true;
    const transport=breakdown.transport;
    const historyVerified=!breakdownFailed&&logisticsHistoricalScope(transport);
    const delivered=logisticsTransitMetric(historyVerified?transport?.summary?.delivered:undefined);
    const hasTransit=historyVerified&&transport?.available===true&&delivered.averageDays!==null;
    const countryRows=logisticsBreakdownRows(breakdown.countryRows,'country');
    const transitPending=logisticsTransitPendingReason(transport,breakdownFailed);
    const transitContext=hasTransit?`全部历史正值 · ${intText(delivered.sampleCount)} 条样本 · 不受日期限制`:`全部历史签收 · ${transitPending}`;
    const items=Array.isArray(liveData.logisticsItems?.items)?liveData.logisticsItems.items:[];
    const anomalies=Array.isArray(liveData.logisticsAnomalies?.anomalies)?liveData.logisticsAnomalies.anomalies:[];
    const failedSourceNames=Array.isArray(sync.sources)
      ? sync.sources.filter(source=>String(source.lastSyncStatus||'').toUpperCase()==='FAILED').map(source=>`${source.providerName||source.sourceId||'未命名'}（${source.sheetName||'未命名工作表'}）`).slice(0,8)
      : [];
    const sourceStatuses=Array.isArray(sync.sources)?sync.sources:[];
    const syncMessage=sync.lastRunMessage||overview.lastSyncMessage||'尚未执行同步';
    const sourceStatusDetails=sourceStatuses.length?`<details class="logistics-source-details"><summary>查看 ${sourceStatuses.length} 个数据源状态</summary><div class="logistics-source-list">${sourceStatuses.map(source=>{const failed=String(source.lastSyncStatus||'').toUpperCase()==='FAILED';return `<div class="logistics-source-row ${failed?'failed':''}"><b>${escapeAttr(source.providerName||source.sourceId||'未命名')}</b><span>${escapeAttr(source.sheetName||'未命名工作表')}</span><em>${failed?'失败':'成功'}</em><small title="${escapeAttr(source.lastSyncMessage||'—')}">${escapeAttr(source.lastSyncMessage||'—')}</small></div>`}).join('')}</div></details>`:'';
    const trackingRate=toNumber(summary.shipmentRows)?(toNumber(summary.trackingCount)||0)/toNumber(summary.shipmentRows):null;
    const cards=[
      metric(logisticsAllDates?'全部发货记录':'本期发货记录',intText(summary.shipmentRows),{unit:'条',context:`${logisticsDateRangeText()} · 全部物流商`}),
      metric(logisticsAllDates?'全部发货箱数':'本期发货箱数',intText(summary.cartons),{unit:'箱',context:logisticsAllDates?'全部发货日期':'按顶部发货日期统计',accent:'var(--blue)'}),
      metric('历史平均运输天数',hasTransit?logisticsDaysText(delivered.averageDays):'—',{unit:hasTransit?'天':'',context:transitContext,accent:'var(--green)'}),
      percentCard('跟踪覆盖率',trackingRate,{context:`${logisticsAllDates?'全部':'本期'}已填写 ${intText(summary.trackingCount)} 条`,accent:'var(--green)'}),
      metric('缺少跟踪号',intText(summary.missingTrackingCount),{unit:'条',context:`${logisticsAllDates?'全部':'本期'}记录 · 点击核对缺失跟踪号`,accent:'var(--red)'})
    ];
    if(state.phase==='error')return `${pageChrome('仓储发货',`${logisticsDateRangeText()} · 物流明细与履约分析`,{export:true})}${dataStateBlock({title:'物流数据加载失败',message:`${state.error||'接口未返回数据'}。请确认后端已部署物流分析接口。`,tone:'error',retry:'logistics'})}`;
    if(loading)return `${pageChrome('仓储发货',`${logisticsDateRangeText()} · 正在读取标准化物流明细`,{export:false})}${dataStateBlock({title:'正在加载物流分析…',message:'正在读取发货箱数、物流商、跟踪记录和数据质量信息。',tone:'loading'})}`;
    const syncWarning=sync.lastRunStatus==='PARTIAL_FAILURE'||sync.lastRunStatus==='FAILED'
      ?`<div class="logistics-sync-warning"><div><b>${escapeAttr(label)}</b>：${escapeAttr(shortMessage(syncMessage))}${failedSourceNames.length?`。失败来源：${escapeAttr(failedSourceNames.join('、'))}`:''}</div><details><summary>查看完整同步信息</summary><pre>${escapeAttr(syncMessage)}</pre></details></div>`:'';
    const readWarning=state.phase==='partial'?`<div class="logistics-sync-warning"><b>部分物流统计未读取</b><span>${escapeAttr(shortMessage(state.error||'请重新加载当前范围',160))}${state.retainedData?'；未更新的部分仍显示本范围上次读取结果。':''}</span><button type="button" class="text-button" data-action="retry-data">重新加载</button></div>`:'';
    return `${pageChrome('仓储发货',`${logisticsDateRangeText()} · 全部物流商 · 发货箱数与跟踪记录`,{export:true})}
      <section class="section-grid logistics-data-page">
        <article class="panel span-12 logistics-live-head"><div><div class="eyebrow"><i></i>物流履约看板</div><h2>发货与签收时效</h2><p class="logistics-date-scope">发货统计：${escapeAttr(logisticsDateRangeText())}${logisticsAllDates?' <button type="button" class="text-button" data-trend-period="last90">返回近90天发货</button>':' <button type="button" class="text-button" data-action="logistics-all-dates">查看全部发货日期</button>'}</p><p class="logistics-history-scope">运输时效：${historyVerified?'全部历史签收记录 · 不受日期筛选限制':'历史签收口径待确认，请核对后端 R38'}</p></div><div class="view-toolbar"><span class="status-pill ${tone}" data-logistics-sync-label>${escapeAttr(label)}</span><button class="primary-button" data-action="logistics-sync" type="button" ${syncDisplay.disabled?'disabled':''}>${syncDisplay.button}</button></div></article>
        <div id="logisticsSyncFeedback" class="logistics-job-feedback">${logisticsSyncFeedback()}</div>
        ${syncWarning}
        ${readWarning}
        ${metricGrid(cards,'five logistics-metrics')}
        ${logisticsTransportNote(transport,hasTransit,breakdownFailed)}
        <article class="panel span-8 logistics-carton-trend"><div class="panel-head"><div><h2>发货箱数趋势</h2><p>${logisticsDateRangeText()} · 按发货日期汇总</p></div><div class="chart-legend-light"><span>箱数 · 箱</span></div></div>${trend.length&&cartonSeries.some(value=>value!==null)?`<div class="panel-body chart-canvas">${lineChart([{name:'发货箱数',values:cartonSeries,format:value=>`${intText(value)} 箱`,className:'series-blue'}],trend.map(row=>shortDate(String(row.date||'').slice(0,10))),{label:'按发货日期汇总的箱数趋势',min:0,max:Math.max(1,...cartonSeries.filter(value=>value!==null))*1.1,format:intText,area:false})}</div><div class="logistics-trend-note">未填写发货日期的记录不进入趋势；发货记录按来源行计数。</div>`:logisticsPartPlaceholder('trend','发货箱数趋势')||emptyStateBlock('当前日期范围未返回发货箱数日记录')}</article>
        <article class="panel span-4"><div class="panel-head"><div><h2>同步状态</h2><p>数据链路健康度</p></div><span class="status-pill ${tone}" data-logistics-sync-label>${escapeAttr(label)}</span></div><div class="logistics-sync-status compact"><div><span>最近同步</span><b>${escapeAttr(String(sync.lastSyncAt||overview.latestSyncAt||'尚未执行'))}</b></div><div><span>最近结果</span><b id="logisticsLatestResult" title="${escapeAttr(syncMessage)}">${escapeAttr(shortMessage(syncMessage,72))}</b></div><div><span>已启用来源</span><b>${intText(sync.enabledSourceCount??overview.enabledSourceCount)} 个</b></div><div><span>失败来源</span><b>${intText(sync.failedSourceCount??overview.failedSourceCount)} 个</b></div></div>${sourceStatusDetails}</article>
        ${logisticsPerformancePanel(breakdown,transport,breakdownFailed)}
        <details class="panel span-12 secondary-details logistics-country-details"><summary>目的国发货分布 <span>${countryRows.length} 个国家 / 地区 · 展开</span></summary>${countryRows.length?dataTable(['国家','发货记录','箱数'],countryRows,{clickable:true,title:'目的国发货分布',className:'logistics-country-table'}):emptyStateBlock('暂无国家汇总数据')}</details>
        <details class="panel span-12 logistics-quality-details" data-logistics-quality><summary>异常与数据质量 <span>${logisticsPartState.anomalies?.phase==='ready'?anomalies.length+' 项':'展开时读取'}</span></summary><div class="logistics-quality-body">${logisticsPartPlaceholder('anomalies','数据质量检查')||(logisticsPartState.anomalies?.phase==='ready'?(anomalies.length?`<div class="logistics-anomalies">${anomalies.map(row=>`<div class="logistics-anomaly ${String(row.severity||'关注')==='预警'?'warn':''}"><span>${escapeAttr(row.category||'质量')}</span><b>${escapeAttr(row.description||row.type||'需核对')}</b><em>${intText(row.count)} 条 · ${escapeAttr(row.severity||'关注')}</em></div>`).join('')}</div>`:emptyStateBlock('当前范围未发现已定义的物流异常')):'<p class="logistics-optional-note">展开后读取缺失字段及重复记录检查。</p>')}</div></details>
        <article class="panel span-12 sales-detail-panel"><div class="panel-head"><div><h2>发货明细</h2><p>${logisticsPartPending('items')&&!items.length?'正在读取最近发货记录':'当前显示最近 '+items.length+' 条；查看全部可分页、搜索及核对签收结果'}</p></div><div class="view-toolbar"><strong class="result-count">${logisticsPartPending('items')&&!items.length?'读取中':'共 '+intText(liveData.logisticsItems?.total??items.length)+' 条'}</strong><button type="button" class="text-button" data-logistics-open data-record="全部发货明细">查看全部 ↗</button></div></div>${items.length?dataTable(['发货单号 / 跟踪号','物流商 / 国家','发货日期','箱数','仓库代码'],logisticsItemRows(items),{clickable:true,title:'物流发货明细',footnote:'重复同步按 source_id + 文档行号覆盖；箱数按源表 cartons 汇总，未提供商品件数。'}):logisticsPartPlaceholder('items','发货明细')||emptyStateBlock('当前日期范围没有物流明细，请先执行同步或调整日期范围')}</article>
      </section>`;
  }

  function cashflowTemplate(){return pageChrome('回款与资金','钉钉表格',{export:false})+(window.CashflowView?window.CashflowView.render():dataStateBlock({title:'资金表正在准备',message:'载入表格后显示真实记录。',tone:'empty'}));}

  function dataTemplate(){
    const entries=[['sales','销售与利润','sales'],['advertising','广告效率','ads'],['inventory','库存与备货','inventory'],['seasonality','商品季节性参考','seasonality']];
    const states={idle:'尚未读取',loading:'读取中',ready:'已返回',error:'读取失败',partial:'部分返回'};
    const rows=entries.map(([key,label,view])=>{const state=loadState[key],data=liveData[key]||{},summary=data.summary||{};
      const date=summary.latestStatsDate||data.dataDate||data.amazonSnapshot?.dataDate||data.amazonSnapshot?.snapshotDate||'—';
      return {cells:[label,states[state.phase]||'待核对',escapeAttr(String(date).slice(0,10)),escapeAttr(state.detailsError||state.error||'—'),{html:`<button type="button" class="text-button" data-route="${view}">打开查看 ↗</button>`}]};});
    return `${pageChrome('数据状态','本次页面会话的数据读取情况',{export:true})}<section class="panel"><div class="panel-head"><h2>本次会话 · 数据读取状态</h2><small>前端 20261016-newui5 · 后端 ${escapeAttr(liveData.status?.analysisVersion||'版本未返回')}</small></div>${dataTable(['模块','读取状态','源数据日期','异常信息','查看'],rows,{title:'数据读取状态',footnote:'已返回表示接口有响应，不代表字段已完整采集。请在各页“数据检查”查看原字段非零记录与缺失情况。'})}</section><div class="inventory-warning" style="margin-top:9px">Sessions、Page Views、Buy Box 全为 0 时，需对照数据库实际值、接口响应与部署版本，不能仅凭字段存在或页面为 0 判断无数据。资金页直连钉钉授权工作表，按表、按原币独立展示；转账申请金额不等于已到账。</div>`;
  }

  function inventoryProductIdentity(row){
    return {country:row?.country??row?.site,mid:row?.mid,sid:row?.sid,sellerName:row?.sellerName,localSku:row?.localSku??row?.code,asin:row?.asin};
  }
  function completeInventoryProduct(row){
    const identity=inventoryProductIdentity(row);
    return seasonProductFields.every(key=>identity[key]!==null&&identity[key]!==undefined&&String(identity[key]).trim()!=='');
  }
  function inventoryProductKey(row){
    const identity=inventoryProductIdentity(row);
    return JSON.stringify(seasonProductFields.map(key=>{
      const value=String(identity[key]??'').trim();
      return ['country','localSku','asin'].includes(key)?value.toUpperCase():value;
    }));
  }
  function inventorySeasonScopeKey(){
    return JSON.stringify([inventoryScopeParams(),window.AnalyticsApi?.authScopeVersion?.()??0]);
  }
  function resetInventorySeasonality(){
    seasonalityToken++;
    Object.assign(inventorySeason,{query:'',selectedKey:'',selectedProduct:null,scopeKey:inventorySeasonScopeKey(),month:null});
    liveData.seasonality=null;loadState.seasonality={phase:'idle',error:''};
  }
  function synchronizeInventorySeasonScope(){
    if(inventorySeason.scopeKey!==inventorySeasonScopeKey())resetInventorySeasonality();
  }
  function inventorySeasonProducts(){
    if(loadState.inventory.phase!=='ready')return [];
    const products=liveData.inventory?.amazonSnapshot?.products;
    return [...new Map((Array.isArray(products)?products:[]).filter(completeInventoryProduct).map(row=>[inventoryProductKey(row),row])).values()];
  }
  function inventorySeasonProductOptions(){
    const products=inventorySeasonProducts(),query=inventorySeason.query.trim().toLowerCase();
    const matches=products.filter(row=>[row.localSku,row.asin,row.productName,row.sellerName,row.country].join(' ').toLowerCase().includes(query));
    const visible=matches.slice(0,100);
    const selected=products.find(row=>inventoryProductKey(row)===inventorySeason.selectedKey);
    if(selected&&!visible.some(row=>inventoryProductKey(row)===inventorySeason.selectedKey))visible.unshift(selected);
    return {total:matches.length,html:'<option value="">选择具体商品、店铺与站点</option>'+visible.map(row=>{
      const key=inventoryProductKey(row),label=[row.localSku,row.asin,row.productName,row.sellerName,row.country].filter(Boolean).join(' · ');
      return '<option value="'+escapeAttr(key)+'" '+(key===inventorySeason.selectedKey?'selected':'')+'>'+escapeAttr(label)+'</option>';
    }).join('')};
  }
  function inventorySeasonalitySection(){
    synchronizeInventorySeasonScope();
    return '<details class="panel span-12 inventory-seasonality" id="inventorySeasonality" '+(inventorySeason.open?'open':'')+'><summary><span><strong>季节性备货参考</strong><small>Amazon 商品历史销量</small></span><i aria-hidden="true">⌄</i></summary><div id="inventorySeasonBody">'+(inventorySeason.open?inventorySeasonalityContent():'')+'</div></details>';
  }
  function inventorySeasonalityContent(){
    if(loadState.inventory.phase!=='ready')return '<p class="inventory-season-hint">库存商品列表加载后，可选择商品查看历史销量。</p>';
    const products=inventorySeasonProducts();
    if(!products.length)return '<p class="inventory-season-hint">当前范围暂无可用于查询历史的完整商品记录，请调整店铺或日期。</p>';
    const options=inventorySeasonProductOptions(),selected=inventorySeason.selectedProduct,state=loadState.seasonality;
    const controls='<div class="inventory-season-controls"><input id="inventorySeasonSearch" type="search" placeholder="搜索 SKU / ASIN / 品名 / 店铺" aria-label="搜索库存商品" autocomplete="off" value="'+escapeAttr(inventorySeason.query)+'"><select id="inventorySeasonProduct" aria-label="选择具体库存商品">'+options.html+'</select><button class="primary-button" type="button" data-inventory-season-load '+(!selected||state.phase==='loading'?'disabled':'')+'>'+(state.phase==='error'?'重试本商品':state.phase==='ready'?'刷新本商品':'查看趋势')+'</button><small id="inventorySeasonMatchCount">'+(options.total>100?'匹配 '+intText(options.total)+' 个，先显示 100 个，可继续搜索':'匹配 '+intText(options.total)+' 个商品')+'</small></div>';
    if(!selected)return controls+'<p class="inventory-season-hint">选择一个商品，查看历史销量与备货参考。</p>';
    if(state.phase==='loading')return controls+'<p class="inventory-season-hint" role="status">正在读取所选商品的历史销量…</p>';
    if(state.phase==='error')return controls+'<p class="inventory-season-hint error" role="alert">'+escapeAttr(state.error)+'</p>';
    if(state.phase!=='ready')return controls;
    const source=liveData.seasonality||{},histories=Array.isArray(source.histories)?source.histories:[],history=histories[0];
    if(!history)return controls+'<p class="inventory-season-hint">该商品暂无可用销量历史，暂无法判断季节性。</p>';
    const coverage=toNumber(history.coverageMonths),insufficient=history.insufficient===true||coverage===null||coverage<12;
    const items=(Array.isArray(source.items)?source.items:[]).filter(item=>!item.insufficient&&toNumber(item.peak)>=2);
    const active=Number(inventorySeason.month)||new Date().getMonth()+1;
    const chosen=items.find(item=>Number(item.month)===active);
    const months=Array.from({length:12},(_,index)=>{
      const month=index+1,count=items.filter(item=>Number(item.month)===month).length;
      return '<button class="season-month '+(month===active?'active':'')+'" type="button" data-inventory-season-month="'+month+'" aria-pressed="'+(month===active)+'"><b>'+month+'月</b><em>'+count+'</em></button>';
    }).join('');
    const scope=[selected.localSku,selected.asin,selected.sellerName,selected.country].filter(Boolean).join(' · ');
    const meta='<div class="season-meta"><strong>'+escapeAttr(scope)+'</strong><span>'+escapeAttr(history.historyRange||[source.historyStart,source.historyEnd].filter(Boolean).join(' 至 ')||'历史范围未提供')+'</span><details class="season-method"><summary>计算口径 ⓘ</summary><p>周均销量 = 月销量 ÷ 当月天数 × 7。最近 12 个完整月的周均销量中位数作为基准，达到 2 倍标记备货信号。缺失月份不补零；不足 12 个完整月暂不预测。销量季节变化还需结合促销、缺货和库存判断。</p></details></div>';
    const notice=insufficient?'<p class="inventory-season-status warning">数据积累不足（'+(coverage===null?'—':intText(coverage))+' / 12 个完整月），暂无法预测；已保留可用历史趋势。</p>':chosen?'<div class="inventory-season-status"><span class="signal-tag '+(String(chosen.signal||'').includes('一致')?'strong':'verify')+'">'+escapeAttr(chosen.signal||'待核实')+'</span><strong>'+active+' 月 · '+decimalText(chosen.peak,2)+'×</strong><span>备货启动 '+escapeAttr(chosen.start||'未提供')+'</span>'+(chosen.urgent?'<small class="urgent">请核对备货进度</small>':'')+'</div>':'<p class="inventory-season-status">'+(items.length?'所选月份暂无达到 2 倍的信号，仍可查看历史销量。':'未识别到达到 2 倍的季节性信号，仍可查看历史销量。')+'</p>';
    const compare=chosen&&!insufficient&&toNumber(chosen.baseline)>0&&toNumber(chosen.peakValue)!==null?inventorySeasonCompare(chosen):'';
    return controls+'<section class="seasonality-page inventory-season-content">'+meta+'<div class="season-calendar panel"><div class="season-month-grid" aria-label="选择季节性月份">'+months+'</div></div>'+notice+'<div class="season-chart-grid '+(!compare?'history-only':'')+'"><article class="panel"><div class="panel-head"><h2>历史周均销量</h2><small>件 / 周</small></div><div class="season-trend">'+inventorySeasonTrend(history,insufficient)+'</div></article>'+compare+'</div><p class="season-footnote">库存与销量历史分别展示。季节性参考仅用于安排备货，不保证未来销量；请结合促销、缺货和供货周期判断。</p></section>';
  }
  function inventorySeasonTrend(history,insufficient){
    const trend=(Array.isArray(history.trend)?history.trend:[]).map(toNumber),labels=Array.isArray(history.trendLabels)?history.trendLabels:trend.map((_,index)=>String(index+1));
    const valid=trend.filter(value=>value!==null);
    if(!valid.length)return '<div class="season-chart-empty">暂无可用销量历史</div>';
    const baseline=toNumber(history.baseline),width=720,height=170,pad={l:62,r:18,t:15,b:27};
    const max=Math.max(1,...valid,baseline??0)*1.12;
    const x=index=>pad.l+index*(width-pad.l-pad.r)/Math.max(1,trend.length-1),y=value=>height-pad.b-value/max*(height-pad.t-pad.b);
    let connected=false;
    const path=trend.map((value,index)=>{if(value===null){connected=false;return '';}const part=(connected?'L':'M')+x(index)+' '+y(value);connected=true;return part;}).join(' ');
    return '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="所选商品历史周均销量">'+[0,.5,1].map(t=>'<line class="axis-line" x1="'+pad.l+'" y1="'+y(max*t)+'" x2="'+(width-pad.r)+'" y2="'+y(max*t)+'"/><text class="axis-label" x="'+(pad.l-6)+'" y="'+(y(max*t)+4)+'" text-anchor="end">'+decimalText(max*t,2)+'</text>').join('')+(!insufficient&&baseline!==null?'<line class="season-baseline" x1="'+pad.l+'" y1="'+y(baseline)+'" x2="'+(width-pad.r)+'" y2="'+y(baseline)+'"/>':'')+'<path class="season-trend-line" d="'+path+'"/>'+trend.map((value,index)=>value===null?'':'<circle cx="'+x(index)+'" cy="'+y(value)+'" r="3" class="season-trend-dot"><title>'+escapeAttr(labels[index]||'')+' · '+decimalText(value,2)+' 件 / 周</title></circle>').join('')+labels.map((label,index)=>index%2===0||index===labels.length-1?'<text class="axis-label" x="'+x(index)+'" y="'+(height-7)+'" text-anchor="middle">'+escapeAttr(label)+'</text>':'').join('')+'</svg><span class="season-chart-caption">'+(insufficient?'缺失月份留空，暂不预测':'虚线：12 个完整月的周均销量中位数')+'</span>';
  }
  function inventorySeasonCompare(row){
    const baseline=toNumber(row.baseline),peak=toNumber(row.peakValue),max=Math.max(1,baseline,peak);
    const bars=[['平时中位数',baseline,'normal'],[row.month+' 月周均',peak,'peak']].map(([name,value,kind])=>'<div><b>'+decimalText(value,2)+'</b><i class="'+kind+'" style="height:'+Math.max(1,value/max*105)+'px"></i><span>'+name+'</span></div>').join('');
    return '<article class="panel"><div class="panel-head"><h2>平时与信号月</h2><small>件 / 周</small></div><div class="season-compare"><div class="season-compare-bars">'+bars+'</div><span class="season-chart-caption">销量倍数 '+decimalText(row.peak,2)+'×</span></div></article>';
  }
  function paintInventorySeasonality(){
    const body=$('#inventorySeasonBody',app);
    if(body&&inventorySeason.open)body.innerHTML=inventorySeasonalityContent();
  }
  function bindInventorySeasonality(){
    const section=$('#inventorySeasonality',app);
    if(!section)return;
    section.addEventListener('toggle',()=>{
      inventorySeason.open=section.open;
      if(section.open){synchronizeInventorySeasonScope();paintInventorySeasonality();}
    });
    section.addEventListener('input',event=>{
      if(event.target.id!=='inventorySeasonSearch')return;
      inventorySeason.query=event.target.value;
      const options=inventorySeasonProductOptions();
      $('#inventorySeasonProduct',section).innerHTML=options.html;
      $('#inventorySeasonMatchCount',section).textContent=options.total>100?'匹配 '+intText(options.total)+' 个，先显示 100 个，可继续搜索':'匹配 '+intText(options.total)+' 个商品';
    });
    section.addEventListener('change',event=>{
      if(event.target.id!=='inventorySeasonProduct')return;
      const key=event.target.value,product=inventorySeasonProducts().find(row=>inventoryProductKey(row)===key);
      seasonalityToken++;liveData.seasonality=null;loadState.seasonality={phase:'idle',error:''};
      inventorySeason.selectedKey=product?key:'';inventorySeason.selectedProduct=product||null;inventorySeason.month=null;
      paintInventorySeasonality();
      if(product)void loadSeasonalityData();
    });
    section.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-inventory-season-load')){void loadSeasonalityData({refresh:true});return;}
      if(button.hasAttribute('data-inventory-season-month')){inventorySeason.month=Number(button.dataset.inventorySeasonMonth);paintInventorySeasonality();}
    });
  }

  const templates={overview:salesCockpitTemplate,sales:salesCockpitTemplate,'amazon-profit':amazonProfitTemplate,products:productsTemplate,ads:adsTemplate,inventory:inventoryTemplate,replenishment:replenishmentTemplate,fulfillment:fulfillmentTemplate,cashflow:cashflowTemplate,data:dataTemplate};
  const routeAliases={salesPage:'sales','sales-page':'sales',aiAlerts:'data',seasonality:'inventory','seasonality-trends':'inventory'};

  const drillMeta={
    overview:{label:'经营指标',actions:[['sales','查看销售利润'],['products','查看流量与转化'],['inventory','查看库存风险']]},
    sales:{label:'销售与利润',actions:[['products','查看流量与转化'],['ads','核查广告费'],['overview','回到经营总览']]},
    products:{label:'展示与点击',actions:[['ads','核查广告投入'],['sales','查看销售贡献']]},
    ads:{label:'广告类型',actions:[['products','查看商品贡献'],['sales','评估利润影响']]},
    seasonality:{label:'季节性趋势',actions:[['inventory','核对库存风险'],['sales','结合转化判断']]},
    inventory:{label:'库存与备货',actions:[['products','核对商品转化'],['fulfillment','查看仓储发货']]},
    fulfillment:{label:'仓储发货',actions:[['inventory','核对库存风险'],['data','核对数据状态']]},
    cashflow:{label:'回款与资金',actions:[['sales','核对销售账单'],['overview','回到经营总览']]},
    data:{label:'数据状态',actions:[['overview','查看指标应用'],['sales','进入销售分析']]}
  };

  const drillInsightMap={
    overview:['销售额','实际毛利润','退款金额','广告花费'],
    sales:['销售额','实际毛利润','退款金额','毛利率'],
    products:['展示量','点击量','点击率 CTR','销量'],
    ads:['广告花费','广告销售额','ACOS','ROAS'],
    inventory:['可售天数','低库存商品','在途数量','近30日销量'],
    fulfillment:['发货记录','箱数','历史平均运输天数','历史签收样本'],
    cashflow:['销售额','实际毛利润','退款金额','到账状态'],
    data:['来源表','金额口径','字段完整性','更新状态'],
    seasonality:['爆发倍数','平时中位数','备货启动日期','数据积累']
  };

  function drillInsights(trigger,title){
    const chips=(drillInsightMap[currentView]||drillInsightMap.overview).map(item=>`<span class="insight-chip">${escapeAttr(item)}</span>`).join('');
    const isLogistics=currentView==='fulfillment';
    const source=currentView==='products'?'领星产品表现 · 展示与点击':isLogistics?'物流标准明细 · 腾讯文档同步':trigger.dataset.source==='lingxing_profit_report_asin'?'领星利润报表 · 按所选范围汇总':trigger.dataset.source==='amazon_product_stats'?'领星产品表现 · 按所选范围汇总':'产品表现 / 利润报表 · 金额按汇率换算';
    const note=currentView==='products'?'展示与点击按当前范围已返回的日记录汇总；CTR 为总点击量除以总展示量。商品总销量单独展示。':isLogistics?'物流数据按 source_id + 文档行号覆盖；箱数按当前筛选范围汇总，发货记录为来源数据行数。':title==='退款率'||title==='退款金额'?'退款金额按正数展示；建议同时查看退款量与销售额，避免只看比例。':title==='毛利率'||title==='实际毛利润'?'利润金额已按来源汇率统一折算；建议结合销售额、广告花费与商品明细定位变化。':title==='广告花费'||title==='广告销售额'?'广告指标与销售主表保持同一日期和店铺范围，可继续跳转核对 ACOS / ROAS。':'当前抽屉保留可追溯字段，并把同一口径的关联指标集中到这里。';
    return `<section class="drawer-insights"><div class="drawer-section-title"><span>关联洞察</span><small>${isLogistics?'接入设计':'同口径指标'}</small></div><div class="insight-chips">${chips}</div><p class="drawer-insight-note">${escapeAttr(note)}</p><div class="drawer-source"><span>数据来源</span><b>${escapeAttr(source)}</b></div></section>`;
  }

  function routeState(){
    const raw=location.hash.slice(1);const [viewPart='',query='']=raw.split('?');
    const view=routeAliases[viewPart]||viewPart;
    const params=new URLSearchParams(query);
    return {view:templates[view]?view:'overview',detail:params.get('detail'),openSeasonality:['seasonality','seasonality-trends'].includes(viewPart)||params.get('section')==='seasonality'};
  }

  function closeDrilldown(updateUrl=true){
    logisticsDrawerGeneration++;
    $('.drill-backdrop')?._readController?.abort();
    $('.drill-backdrop')?.remove();
    if(updateUrl&&routeState().detail){
      const base=currentView==='overview'?'':`#${currentView}`;
      history.replaceState(null,'',`${location.pathname}${location.search}${base}`);
    }
    app.focus({preventScroll:true});
    if(pendingDataPaint)queueProgressivePaint();
  }

  function presentLogisticsDrilldown(trigger){
    closeDrilldown(false);
    const generation=logisticsDrawerGeneration,scope=dataScopeVersion,auth=window.AnalyticsApi?.authScopeVersion?.()??0;
    const title=trigger.dataset.record||trigger.dataset.metric||'发货明细';let filters={};
    try{const parsed=JSON.parse(trigger.dataset.logisticsFilters||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))filters=parsed;}catch(ignore){}
    const historyDetails=trigger.dataset.logisticsHistory==='true'||title==='历史平均运输天数';
    const base={...logisticsScopeParams(),...filters};
    if(historyDetails){delete base.startDate;delete base.endDate;base.allDates=true;}
    if(title==='缺少跟踪号')base.trackingStatus='MISSING';
    else if(title==='跟踪覆盖率')base.trackingStatus='FILLED';
    delete base.limit;delete base.offset;delete base.sellerName;
    const state={offset:0,size:50,total:0,keyword:'',request:0,busy:false};
    const backdrop=document.createElement('div');backdrop.className='drill-backdrop';
    const drawerController=new AbortController();backdrop._readController=drawerController;
    const filterLabel=[filters.sourceId?String(liveData.logisticsBreakdown?.providerRows?.find(row=>String(row.sourceId)===String(filters.sourceId))?.providerName||filters.sourceId):filters.provider,filters.country,filters.channel].filter(Boolean).join(' · ');
    const transport=liveData.logisticsBreakdown?.transport;
    const meanNote=historyDetails?`<div class="logistics-drawer-note"><b>历史发货记录与签收结果（仅正值参与均值）</b><span>此处读取当前物流商、国家、渠道对应的全部历史记录，不受顶部日期限制。正值以绿色显示；负数、0、点号及空值保留供核对，不参与平均运输天数。</span></div>`:'';
    backdrop.innerHTML=`<aside class="drill-drawer logistics-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="drillTitle"><header class="drill-head"><div><div class="drawer-crumb">仓储发货 <span>/</span> 发货明细</div><h2 id="drillTitle">${escapeAttr(title)}</h2><p>${escapeAttr(filterLabel||'当前范围全部物流商')} · ${escapeAttr(historyDetails?'全部历史记录 · 不受日期限制':logisticsDateRangeText()+'（按发货日期）')}${base.trackingStatus==='FILLED'?' · 已填跟踪号':base.trackingStatus==='MISSING'?' · 缺少跟踪号':''}</p></div><button data-close-drill aria-label="关闭详情">×</button></header><div class="drill-body">${meanNote}<form class="logistics-drawer-search"><input type="search" name="keyword" aria-label="搜索发货记录" placeholder="搜索发货单 / 货件号 / 跟踪号 / 产品"><button class="primary-button" type="submit">查询</button></form><div data-logistics-drawer-results aria-live="polite"></div><div class="table-pagination logistics-drawer-pagination"><span data-logistics-drawer-range></span><label>显示 <select data-logistics-drawer-size aria-label="发货明细显示条数"><option value="50">50 条</option><option value="100">100 条</option><option value="200">200 条</option><option value="0">全部</option></select></label><button type="button" data-logistics-drawer-prev aria-label="上一页发货明细">‹</button><span data-logistics-drawer-page></span><button type="button" data-logistics-drawer-next aria-label="下一页发货明细">›</button></div><p class="logistics-drawer-footnote">${historyDetails?'历史记录按当前物流商、国家、渠道读取全部日期，包含发货日期缺失记录。':'明细与当前发货日期及物流商、国家、渠道保持一致。'}点击记录查看完整字段；表头排序作用于已加载记录。“全部”会分批读取当前筛选范围。</p></div></aside>`;
    const current=()=>document.body.contains(backdrop)&&generation===logisticsDrawerGeneration&&scope===dataScopeVersion&&auth===(window.AnalyticsApi?.authScopeVersion?.()??0)&&currentView==='fulfillment';
    const results=$('[data-logistics-drawer-results]',backdrop);
    const paintControls=()=>{const pages=state.size?Math.max(1,Math.ceil(state.total/state.size)):1,page=state.size?Math.floor(state.offset/state.size)+1:1;$('[data-logistics-drawer-page]',backdrop).textContent=`${page} / ${pages}`;$('[data-logistics-drawer-prev]',backdrop).disabled=state.busy||state.offset===0;$('[data-logistics-drawer-next]',backdrop).disabled=state.busy||!state.size||state.offset+state.size>=state.total;$('[data-logistics-drawer-size]',backdrop).disabled=state.busy;$('form button',backdrop).disabled=state.busy;};
    const load=async()=>{
      const request=++state.request;state.busy=true;results.innerHTML='<div class="logistics-drawer-loading" role="status">正在读取对应发货记录…</div>';$('[data-logistics-drawer-range]',backdrop).textContent='';paintControls();
      try{
        if(!window.AnalyticsApi?.logisticsItems)throw new Error('物流明细接口未加载，请刷新页面。');
        if(historyDetails&&(loadState.logistics.failedParts?.includes('breakdown')===true||!logisticsHistoricalScope(transport)||transport.available!==true))throw new Error('历史签收口径需要后端 R38，请完整更新后重新加载。');
        const items=[];let offset=state.offset,total=0;
        do{
          const payload=await window.AnalyticsApi.logisticsItems({...base,keyword:state.keyword,limit:state.size||200,offset},{signal:drawerController.signal});
          if(!current()||request!==state.request)return;
          if(base.allDates&&payload?.dateRange?.allDates!==true)throw new Error('全部发货日期需要更新后端至 R37，请完整上传后重试。');
          const batch=Array.isArray(payload?.items)?payload.items:[];total=Math.max(0,toNumber(payload?.total)??batch.length);items.push(...batch);offset+=batch.length;
          if(state.size||offset>=total)break;
          if(!batch.length)throw new Error('发货记录在读取期间发生变化，请重新查询。');
          results.innerHTML=`<div class="logistics-drawer-loading" role="status">正在读取全部记录：${intText(items.length)} / ${intText(total)} 条…</div>`;
        }while(true);
        state.total=total;
        if(!items.length){results.innerHTML=`<div class="logistics-drawer-empty"><b>${historyDetails?'当前条件没有历史发货记录':'当前筛选范围没有发货记录'}</b><span>${historyDetails?'请调整搜索条件或同步后重试。':'请调整发货日期或搜索条件；查看历史签收结果可跨日期核对。'}</span></div>`;}
        else{
          const rows=logisticsItemRows(items).map((row,index)=>{const item=items[index],positive=toNumber(item.signedDays)>0;return {...row,sortValues:[item.shipmentNo||item.fbaNo||item.trackingNo||'',item.providerName||item.sourceId||'',item.shipDate,item.cartons,positive?toNumber(item.signedDays):null,item.signedDaysReason||''],cells:[row.cells[0],row.cells[1],row.cells[2],row.cells[3],{html:positive?`<b class="logistics-transit-days">${logisticsDaysText(toNumber(item.signedDays))}</b> 天`:'—',className:'logistics-signed-value'},{html:`<span class="logistics-signed-status ${positive?'positive':'pending'}">${escapeAttr(item.signedDaysReason||'需更新后端 R37 后查看签收明细')}${item.signedDaysFormulaDerived?'<small>由同一行 K−A 日期回算</small>':''}</span>`,className:'logistics-signed-reason'}]};});
          results.innerHTML=dataTable(['发货单 / 跟踪号 / 产品','物流商 / 国家','发货日期','箱数','签收天数','签收读取情况'],rows,{clickable:true,title:'对应发货记录',paginated:false,className:'logistics-drawer-table'});
          bindDataTables(results);$$('tr.clickable',results).forEach(row=>{const activate=()=>presentDrilldown(row);row.addEventListener('click',activate);row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});});
        }
        $('[data-logistics-drawer-range]',backdrop).textContent=`共 ${intText(total)} 条 · ${items.length?state.offset+1:0}–${state.offset+items.length}`;
      }catch(error){if(!current()||request!==state.request)return;results.innerHTML=`<div class="logistics-drawer-empty error"><b>发货明细读取失败</b><span>${escapeAttr(shortMessage(error?.message||'请重新加载',180))}</span><button type="button" class="text-button" data-logistics-drawer-retry>重新读取</button></div>`;$('[data-logistics-drawer-retry]',results).addEventListener('click',()=>void load());}
      finally{if(current()&&request===state.request){state.busy=false;paintControls();}}
    };
    backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeDrilldown();});$('[data-close-drill]',backdrop).addEventListener('click',()=>closeDrilldown());
    $('form',backdrop).addEventListener('submit',event=>{event.preventDefault();if(state.busy)return;state.keyword=$('input[name="keyword"]',backdrop).value.trim();state.offset=0;void load();});
    $('[data-logistics-drawer-size]',backdrop).addEventListener('change',event=>{state.size=Number(event.target.value);state.offset=0;void load();});
    $('[data-logistics-drawer-prev]',backdrop).addEventListener('click',()=>{state.offset=Math.max(0,state.offset-state.size);void load();});$('[data-logistics-drawer-next]',backdrop).addEventListener('click',()=>{state.offset+=state.size;void load();});
    document.body.appendChild(backdrop);$('[data-close-drill]',backdrop).focus();void load();
  }

  function presentDrilldown(trigger){
    if(currentView==='fulfillment'&&trigger.dataset.logisticsItem!=='true'){presentLogisticsDrilldown(trigger);return;}
    closeDrilldown(false);
    const isRow=trigger.matches('tr');
    const title=isRow?trigger.dataset.record:trigger.dataset.metric;
    let fields=[];
    if(isRow){
      const table=trigger.closest('table');const headers=$$('th',table).map(cell=>cell.textContent.trim());
      try{ fields=trigger.dataset.fields?JSON.parse(trigger.dataset.fields):[]; }catch(ignore){ fields=[]; }
      if(!Array.isArray(fields)||!fields.length) fields=$$('td',trigger).map((cell,index)=>[headers[index]||`字段 ${index+1}`,cell.textContent.trim()]);
    }else{
      fields=[['当前值',trigger.dataset.displayValue||$('.value',trigger.closest('.metric-card')||trigger)?.textContent.trim()||$('b',trigger)?.textContent.trim()||'查看明细'],['日期范围',dateRangeText()],['统计周期',activePeriodLabel()],['店铺范围',$('#platformButton span')?.textContent.trim()||'全部店铺']];
      if(metricFormulas[title])fields.push(['计算口径',metricFormulas[title]]);
    }
    const meta=drillMeta[currentView];
    const backdrop=document.createElement('div');backdrop.className='drill-backdrop';
     backdrop.innerHTML=`<aside class="drill-drawer" role="dialog" aria-modal="true" aria-labelledby="drillTitle"><header class="drill-head"><div><div class="drawer-crumb">${routeNames[currentView]} <span>/</span> ${meta.label}</div><h2 id="drillTitle">${escapeAttr(title)}</h2><p>${isRow?'记录详情与关联分析':'指标下钻与关联分析'}</p></div><button data-close-drill aria-label="关闭详情">×</button></header><div class="drill-body"><section><div class="drawer-section-title"><span>明细字段</span><small>${fields.length} 项</small></div><dl class="detail-list">${fields.map(field=>`<div><dt>${escapeAttr(field[0])}</dt><dd>${escapeAttr(field[1])}</dd></div>`).join('')}</dl></section>${drillInsights(trigger,title)}<section><div class="drawer-section-title"><span>继续分析</span><small>跨模块跳转</small></div><nav class="drawer-actions">${meta.actions.map(action=>`<button data-route="${action[0]}"><span>${action[1]}</span><i>→</i></button>`).join('')}</nav></section></div></aside>`;
    backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeDrilldown()});
    $('[data-close-drill]',backdrop).addEventListener('click',()=>closeDrilldown());
    $$('[data-route]',backdrop).forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.route)));
    document.body.appendChild(backdrop);$('[data-close-drill]',backdrop).focus();
  }

  function openDrilldown(trigger,updateUrl=true){
    const key=trigger.dataset.record||trigger.dataset.metric;
    if(updateUrl){const target=`#${currentView}?detail=${encodeURIComponent(key)}`;if(location.hash!==target){try{history.pushState(null,'',`${location.pathname}${location.search}${target}`);}catch(ignore){}}}
    presentDrilldown(trigger);
  }

  function renderView(view,detail=null,openSeasonality=false){
    window.SalesCockpit?.unmount?.();
    const showInventorySeasonality=openSeasonality||view==='seasonality'||view==='seasonality-trends';
    if(showInventorySeasonality)inventorySeason.open=true;
    closeDrilldown(false);
    $('#chartTooltip')?.classList.remove('show');$('#formulaTooltip')?.classList.remove('show');
    const alias=routeAliases[view]||view;
    const nextView=templates[alias]?alias:'overview';const viewChanged=nextView!==currentView;
    if(currentView==='fulfillment'&&nextView!=='fulfillment'){
      logisticsReadController?.abort();logisticsToken++;
      if(logisticsPartPending('anomalies'))logisticsPartState.anomalies={phase:'idle',pending:false,error:''};
      if(loadState.logistics.phase==='loading'||['status','overview','trend','breakdown','items'].some(logisticsPartPending))loadState.logistics={phase:'idle',error:''};
      if(logisticsSyncState.refreshing)loadState.logistics={phase:'idle',error:''};
      stopLogisticsPolling();
    }
    currentView=nextView;
    document.body.dataset.view=currentView;
    syncDataState();
    pendingPageChrome={title:routeNames[currentView],subtitle:'',export:false};document.title=`${routeNames[currentView]} · 环球营盘`;
    $$('.nav-item').forEach(button=>{const active=button.dataset.view===(currentView==='amazon-profit'?'sales':currentView);button.classList.toggle('active',active);active?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current')});
    app.innerHTML=templates[currentView]();$('#routeTitle').textContent=pendingPageChrome.title;$('#routeTitle').title=pendingPageChrome.subtitle;$('#exportButton').hidden=!pendingPageChrome.export;bindDynamicActions();animateCounts(app);if(viewChanged)window.scrollTo({top:0,behavior:'auto'});app.focus({preventScroll:true});
    if(['overview','sales'].includes(currentView))window.SalesCockpit?.mount(app,salesCockpitContext());
    if(showInventorySeasonality&&currentView==='inventory')window.InventoryWorkspace?.selectSource?.('amazon');
    if(detail){requestAnimationFrame(()=>{const trigger=$$('[data-record],[data-metric]',app).find(item=>(item.dataset.record||item.dataset.metric)===detail);if(trigger)openDrilldown(trigger,false)})}
    ensureViewData();
    if(currentView==='fulfillment'){
      paintLogisticsSync();
      if(viewChanged&&['ready','partial'].includes(loadState.logistics.phase)&&!logisticsPartPending('status'))void checkLogisticsSyncStatus();
      else scheduleLogisticsStatusCheck();
    }
  }

  function filterSalesDetails(){
    const table=$('.sales-detail-table',app);if(!table||!$('#salesSearch',app))return;
    const term=($('#salesSearch',app)?.value||'').trim().toLowerCase(),focus=$('#salesFocus',app)?.value||'';
    const filters=Object.fromEntries($$('[data-sales-filter]',app).map(select=>[select.dataset.salesFilter,select.value]));
    const rows=$$('tbody tr',table);
    rows.forEach(row=>{const matches=(!term||(row.dataset.search||row.innerText.toLowerCase()).includes(term))&&Object.entries(filters).every(([key,value])=>!value||row.dataset[key]===value)&&(!focus||(row.dataset.focus||'').split(' ').includes(focus));row.dataset.filterExcluded=String(!matches);});
    const selected=$('#salesSort',app)?.value;
    if(selected){
      const [key,direction]=selected.split(':'),attribute=`data-sort-${key}`;
      rows.sort((a,b)=>{const left=toNumber(a.getAttribute(attribute)),right=toNumber(b.getAttribute(attribute));if(left===null&&right===null)return 0;if(left===null)return 1;if(right===null)return -1;return direction==='asc'?left-right:right-left;}).forEach(row=>$('tbody',table).appendChild(row));
      $$('thead th',table).forEach(th=>{th.setAttribute('aria-sort','none');const icon=$('[data-sort-column] i',th);if(icon)icon.textContent='↕';});
      delete table.dataset.sortColumn;delete table.dataset.sortDirection;
    }
    const visible=updateTablePage(table,true);
    const empty=$('#salesNoResults',app);if(empty)empty.hidden=visible>0;
  }

  function bindChartTooltips(root){
    let tooltip=$('#chartTooltip');
    if(!tooltip){tooltip=document.createElement('div');tooltip.id='chartTooltip';tooltip.className='chart-tooltip';tooltip.setAttribute('role','status');document.body.appendChild(tooltip)}
    const place=(target,event)=>{
      const rect=target.getBoundingClientRect();const x=event?.clientX??rect.left+rect.width/2;const y=event?.clientY??rect.top;
      tooltip.style.left=`${Math.min(window.innerWidth-176,Math.max(12,x+12))}px`;tooltip.style.top=`${Math.max(12,y-70)}px`;
    };
    $$('.chart-point',root).forEach(point=>{
      const guide=$('.chart-guide-line',point.closest('svg'));
      const show=event=>{if(guide){guide.setAttribute('x1',point.dataset.chartX);guide.setAttribute('x2',point.dataset.chartX);guide.classList.add('show')}tooltip.innerHTML=`<span>${escapeAttr(point.dataset.chartDate)}</span><strong>${escapeAttr(point.dataset.chartSeries)}</strong><b>${escapeAttr(point.dataset.chartValue)}</b>`;place(point,event);tooltip.classList.add('show')};
      const hide=()=>{tooltip.classList.remove('show');guide?.classList.remove('show')};
      point.addEventListener('pointerenter',show);point.addEventListener('pointermove',event=>place(point,event));point.addEventListener('pointerleave',hide);point.addEventListener('focus',event=>{show(event);requestAnimationFrame(()=>place(point))});point.addEventListener('blur',hide);
    });
  }

  function bindFormulaTooltips(root){
    let tooltip=$('#formulaTooltip');
    if(!tooltip){tooltip=document.createElement('div');tooltip.id='formulaTooltip';tooltip.className='formula-tooltip';tooltip.setAttribute('role','tooltip');document.body.appendChild(tooltip)}
    const show=button=>{
      const rect=button.getBoundingClientRect();tooltip.textContent=button.dataset.tip;
      tooltip.style.left=`${Math.min(window.innerWidth-336,Math.max(12,rect.left-88))}px`;tooltip.style.top=`${Math.min(window.innerHeight-90,rect.bottom+9)}px`;tooltip.classList.add('show');button.setAttribute('aria-describedby','formulaTooltip');
    };
    const hide=button=>{tooltip.classList.remove('show');button.removeAttribute('aria-describedby')};
    $$('[data-formula-help]',root).forEach(button=>{
      button.addEventListener('pointerenter',()=>show(button));button.addEventListener('pointerleave',()=>hide(button));button.addEventListener('focus',()=>show(button));button.addEventListener('blur',()=>hide(button));button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();button.focus();show(button)});
    });
  }



  function bindDynamicActions(){
    $$('[data-route]',app).forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.route)));
    $$('[data-trend-period]',app).forEach(button=>button.addEventListener('click',()=>applyPresetPeriod(button.dataset.trendPeriod)));
    $$('[data-action="retry-data"]',app).forEach(button=>button.addEventListener('click',()=>{showToast('正在重新加载当前范围数据');reloadCurrentView()}));
    $$('[data-action="connect-tencent-doc"]',app).forEach(button=>button.addEventListener('click',()=>showToast('接入需要：文档链接/ID、工作表名称、只读授权；多文档按物流商分别登记')));
    $$('[data-action="logistics-sync"]',app).forEach(button=>button.addEventListener('click',()=>{button.disabled=true;void startLogisticsSync();}));
    $$('.data-table tr.clickable',app).forEach(row=>{const activate=()=>openDrilldown(row);row.addEventListener('click',activate);row.addEventListener('keydown',event=>{if(event.target!==row)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();activate()}})});
    $$('[data-metric]',app).forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();openDrilldown(button);}));
    $$('[data-logistics-open]',app).forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openDrilldown(button);}));
    bindLogisticsPerformance();
    $$('[data-action="logistics-retry-anomalies"]',app).forEach(button=>button.addEventListener('click',()=>void loadLogisticsAnomalies({bypassCache:true})));
    $('[data-logistics-quality]',app)?.addEventListener('toggle',event=>{if(event.target.open&&logisticsPartState.anomalies?.phase==='idle')void loadLogisticsAnomalies();});
    $$('[data-action="logistics-all-dates"]',app).forEach(button=>button.addEventListener('click',()=>{logisticsAllDates=true;showToast('发货数量统计已切换为全部日期；历史时效保持不变');reloadCurrentView({bypassCache:false});}));
    $$('[data-priority-filter]',app).forEach(button=>button.addEventListener('click',()=>{const priority=button.dataset.priorityFilter;$$('[data-priority-filter]',app).forEach(item=>item.classList.toggle('active',item===button));$$('tbody tr[data-priority]',app).forEach(row=>row.hidden=priority!=='all'&&row.dataset.priority!==priority)}));
    $('#salesSearch',app)?.addEventListener('input',filterSalesDetails);
    $('#salesFocus',app)?.addEventListener('change',filterSalesDetails);
    $('#salesSort',app)?.addEventListener('change',filterSalesDetails);
    $$('[data-focus-filter]',app).forEach(button=>button.addEventListener('click',()=>{const select=$('#salesFocus',app);if(!select){navigate('sales');return}select.value=button.dataset.focusFilter;filterSalesDetails();$('.sales-detail-panel',app)?.scrollIntoView({block:'start',behavior:'smooth'});}));
    $$('[data-sales-filter]',app).forEach(select=>select.addEventListener('change',filterSalesDetails));
    $('#resetSalesFilters',app)?.addEventListener('click',()=>{$('#salesSearch',app).value='';$$('[data-sales-filter]',app).forEach(select=>select.value='');const focus=$('#salesFocus',app);if(focus)focus.value=focus.dataset.defaultFocus||'';if($('#salesSort',app))$('#salesSort',app).selectedIndex=0;filterSalesDetails();$('#salesSearch',app).focus()});
    if(currentView==='inventory')window.InventoryWorkspace?.mount(app,{onRetry:()=>reloadCurrentView(),onExport:()=>exportCurrentTable(),onPairingAudit:()=>exportInventoryPairingAudit(),onStateChange:({source,canExport})=>{if(currentView!=='inventory')return;$('#exportButton').hidden=!canExport;const season=$('#inventorySeasonality',app);if(season)season.hidden=source!=='amazon';}});
    bindInventorySeasonality();
    if(currentView==='cashflow')window.CashflowView?.mount(app);
    bindDataTables();
    filterSalesDetails();
    bindChartTooltips(app);
    bindFormulaTooltips(app);
  }

  function navigate(view){ const openSeasonality=['seasonality','seasonality-trends'].includes(view),alias=routeAliases[view]||view;const target=templates[alias]?alias:'overview';const state=routeState();if(state.view===target&&!state.detail)renderView(target,null,openSeasonality);else location.hash=target==='overview'?'':target+(openSeasonality?'?section=seasonality':'');closeSidebar(); }
  function openSidebar(){ $('#sidebar').classList.add('open');$('#scrim').classList.add('show');$('#menuButton').setAttribute('aria-expanded','true'); }
  function closeSidebar(){ $('#sidebar').classList.remove('open');$('#scrim').classList.remove('show');$('#menuButton').setAttribute('aria-expanded','false'); }

  function renderPlatformOptions(query=''){
    const term=query.trim().toLowerCase();
    const stores=liveStores();
    const all=[{name:'',country:''}].concat(stores);
    const active=activeStore();
    $('#platformList').innerHTML=all.filter(item=>!item.name||`${item.name} ${item.country}`.toLowerCase().includes(term)).map(item=>`<label class="platform-option"><input type="radio" name="storeScope" value="${escapeAttr(item.name)}" ${item.name?(active&&active.name===item.name?'checked':''):(active?'':'checked')}><span>${escapeAttr(item.name||'全部店铺')}</span><small>${escapeAttr(item.country||(item.name?'国家未标注':'不限国家'))}</small></label>`).join('')||`<p class="popover-empty">未找到匹配的店铺</p>`;
  }
  function positionPlatformPopover(){const button=$('#platformButton'),popover=$('#platformPopover'),rect=button.getBoundingClientRect(),width=Math.min(360,window.innerWidth-24);popover.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`;popover.style.top=`${Math.max(12,Math.min(rect.bottom+8,window.innerHeight-320))}px`;}
  function openPlatformPopover(){ closeDatePopover(false);updateStoreButton();positionPlatformPopover();$('#platformPopover').hidden=false;$('#platformButton').setAttribute('aria-expanded','true');renderPlatformOptions();$('#platformSearch').focus(); }
  function closePlatformPopover(restoreFocus=true){ $('#platformPopover').hidden=true;$('#platformButton').setAttribute('aria-expanded','false');if(restoreFocus)$('#platformButton').focus(); }
  function applyPlatformScope(){
    const value=$('#platformList input[name="storeScope"]:checked')?.value||'';
    if(value===(activeStore()?.name||'')){scopeTouched=true;closePlatformPopover();return;}
    selectedStores=value?new Set([value]):new Set();
    scopeTouched=true;
    updateStoreButton();
    closePlatformPopover();
    showToast(value?`店铺范围：${value}`:'店铺范围：全部店铺');
    reloadCurrentView({bypassCache:false});
  }

  function showDateError(message){ const error=$('#dateError');error.textContent=message;error.hidden=!message; }
  function positionDatePopover(){
    const button=$('#dateButton'),popover=$('#datePopover'),rect=button.getBoundingClientRect();
    const width=Math.min(430,window.innerWidth-24),height=218;
    popover.style.left=`${Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12))}px`;
    popover.style.right='auto';popover.style.top=`${Math.max(12,Math.min(rect.bottom+8,window.innerHeight-height-12))}px`;
  }
  function openDatePopover(){
    closePlatformPopover(false);syncDateControls($('#periodSwitch button.active')?.dataset.period||null);showDateError('');
    positionDatePopover();$('#datePopover').hidden=false;$('#dateButton').setAttribute('aria-expanded','true');$('#dateStart').focus();
  }
  function closeDatePopover(restoreFocus=true){
    $('#datePopover').hidden=true;$('#dateButton').setAttribute('aria-expanded','false');showDateError('');
    if(restoreFocus)$('#dateButton').focus();
  }
  function applySelectedDates(){
    const start=$('#dateStart').value,end=$('#dateEnd').value;
    if(!isIsoDate(start)||!isIsoDate(end)){showDateError('请选择完整的开始和结束日期');return}
    if(start>end){showDateError('开始日期不能晚于结束日期');return}
    if(!logisticsAllDates&&start===selectedDateRange.start&&end===selectedDateRange.end){scopeTouched=true;closeDatePopover();return;}
    logisticsAllDates=false;setDateRange(start,end);scopeTouched=true;closeDatePopover();showToast(`日期范围已更新：${shortDate(start)} — ${shortDate(end)}`);
    reloadCurrentView({bypassCache:false});
  }
  function applyPresetPeriod(period,{silent=false}={}){
    const range=periodRange(period);if(!range)return;
    if(!logisticsAllDates&&range.start===selectedDateRange.start&&range.end===selectedDateRange.end){scopeTouched=true;syncDateControls(period);return;}
    logisticsAllDates=false;
    setDateRange(range.start,range.end,period);scopeTouched=true;
    if(!silent)showToast(`统计周期已切换为${activePeriodLabel()}`);
    reloadCurrentView({bypassCache:false});
  }

  function downloadInventoryRows(rows,filename){
    const headers=Object.keys(rows[0]);
    const csvCell=value=>{let text=String(value??'');if(typeof value==='string'&&(/^[\s]*[=+@]/.test(text)||/^[\s]*-(?!\d+(?:\.\d+)?\s*$)/.test(text)))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    const csv=[headers,...rows.map(row=>headers.map(key=>row[key]))].map(row=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  let pairingAuditBusy=false;
  async function exportInventoryPairingAudit(){
    if(pairingAuditBusy)return;
    const inventory=liveData.inventory,period=inventory?.period||{},startDate=String(period.startDate||selectedDateRange.start||''),endDate=String(period.endDate||selectedDateRange.end||'');
    if(!inventory||!startDate||!endDate){showToast('库存快照或日期尚未读取完成，请稍后重试');return;}
    pairingAuditBusy=true;showToast('正在核对库存与本期销量，完成后下载表格');
    try{
      const [liveResult,salesResult]=await Promise.allSettled([
        window.MarketplaceInventory?.load?.()||Promise.reject(new Error('实时库存模块未加载')),
        window.AnalyticsApi?.multiplatformSales?.({startDate,endDate},{cache:true})||Promise.reject(new Error('多平台销量接口未加载'))
      ]);
      const live=liveResult.status==='fulfilled'?liveResult.value:null;
      let sales=salesResult.status==='fulfilled'?salesResult.value:null;
      const errors={marketplace:liveResult.status==='rejected'?String(liveResult.reason?.message||liveResult.reason):'',sales:salesResult.status==='rejected'?String(salesResult.reason?.message||salesResult.reason):''};
      if(sales&&(String(sales.period?.startDate)!==startDate||String(sales.period?.endDate)!==endDate)){
        errors.sales='销量接口返回的日期与库存页面日期不一致';sales=null;
      }
      const audit=window.InventoryWorkspace?.pairingAuditRows?.(inventory,live,sales,errors);
      if(!audit?.rows?.length){showToast('当前没有可导出的配对核对记录');return;}
      downloadInventoryRows(audit.rows,`库存销量配对核对-${endDate}.csv`);
      showToast(`已导出库存未配对 ${audit.counts.stock}、销量未配对 ${audit.counts.sales}、有库存未预测 ${audit.counts.pending} 条${audit.partial?'；请查看表内范围提醒':''}`);
    }catch(error){showToast('配对核对表导出失败：'+String(error?.message||error));}
    finally{pairingAuditBusy=false;}
  }
  function exportCurrentTable(){
    if(currentView==='inventory'){
      if(window.InventoryWorkspace?.getFilters?.().source==='all'){showToast('请进入具体来源查看并导出明细');return;}
      const rows=window.InventoryWorkspace?.exportRows?.()||[];
      if(!rows.length){showToast('当前筛选没有可导出的库存明细');return;}
      downloadInventoryRows(rows,'库存明细-'+(selectedDateRange.end||todayIso())+'.csv');
      showToast(`已导出当前筛选的 ${rows.length} 条已加载明细`);return;
    }
    const table=$('.sales-detail-table',app)||$('.data-table',app);if(!table){showToast('当前页面没有可导出的明细');return}
    const csv=$$('tr',table).filter(row=>row.dataset.filterExcluded!=='true').map(row=>$$('th,td',row).map(cell=>`"${cell.textContent.trim().replaceAll('"','""')}"`).join(',')).join('\r\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${routeNames[currentView]}-明细.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);showToast('已导出当前明细');
  }

  function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2400)}

  function dashboardScope(){
    const store=currentView==='inventory'?null:activeStore();
    return {
      view:currentView,
      viewLabel:routeNames[currentView],
      period:$('#periodSwitch button.active')?.dataset.period||'custom',
      startDate:selectedDateRange.start,
      endDate:selectedDateRange.end,
      store:store?store.name:'',
      country:store?.country||'',
      stores:store?[store.name]:[],
      ...(currentView==='inventory'?{inventoryFilters:window.InventoryWorkspace?.getFilters?.()||{},storeFilterLocation:'inventoryFilters'}:{})
    };
  }

  function registerWebMcpTools(){
    const context=document.modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const storeNames=liveStores().map(item=>item.name);
    const registrations=[
      {
        name:'read_dashboard_scope',
        title:'读取经营看板范围',
        description:'读取当前经营看板的页面、统计周期和已选店铺，不改变页面状态。',
        inputSchema:{type:'object',properties:{},additionalProperties:false},
        annotations:{readOnlyHint:true,untrustedContentHint:false},
        execute(){return dashboardScope()}
      },
      {
        name:'set_dashboard_scope',
        title:'设置经营看板范围',
        description:'一次设置经营看板的分析页面、统计周期、日期范围和店铺范围，并重新加载对应数据。库存页的店铺、平台及仓库使用页面内独立筛选，不接受 stores 参数。',
        inputSchema:{
          type:'object',
          properties:{
            view:{type:'string',enum:Object.keys(routeNames),description:'要打开的分析页面'},
            period:{type:'string',enum:periodKeys,description:'统计周期'},
            startDate:{type:'string',format:'date',description:'自选开始日期，格式为 YYYY-MM-DD'},
            endDate:{type:'string',format:'date',description:'自选结束日期，格式为 YYYY-MM-DD'},
            stores:{type:'array',items:{type:'string'},minItems:0,maxItems:1,uniqueItems:true,description:'要纳入分析的单个店铺；传空数组代表全部店铺'}
          },
          minProperties:1,
          additionalProperties:false
        },
        annotations:{readOnlyHint:false,untrustedContentHint:false},
        async execute(input){
          if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('输入必须是对象');
          const unknown=Object.keys(input).filter(key=>!['view','period','startDate','endDate','stores'].includes(key));
          if(unknown.length)throw new TypeError(`不支持的字段：${unknown.join('、')}`);
          if(!Object.keys(input).length)throw new TypeError('至少需要设置一个范围字段');
          if(input.view!==undefined&&!routeNames[input.view])throw new RangeError('未知页面');
          if(input.period!==undefined&&!periodKeys.includes(input.period))throw new RangeError('未知统计周期');
          if((input.view||currentView)==='inventory'&&input.stores!==undefined)throw new RangeError('库存页使用页面内的平台、店铺与仓库筛选，请在库存筛选区操作。');
          const hasCustomDate=input.startDate!==undefined||input.endDate!==undefined;
          if(input.period!==undefined&&hasCustomDate)throw new RangeError('统计周期和自选日期不能同时设置');
          scopeTouched=true;
          if(hasCustomDate){
            logisticsAllDates=false;
            const start=input.startDate??selectedDateRange.start,end=input.endDate??selectedDateRange.end;
            if(!isIsoDate(start)||!isIsoDate(end))throw new RangeError('日期格式应为 YYYY-MM-DD');
            if(start>end)throw new RangeError('开始日期不能晚于结束日期');
            setDateRange(start,end);
          }else if(input.period!==undefined){
            logisticsAllDates=false;
            const range=periodRange(input.period);setDateRange(range.start,range.end,input.period);
          }
          if(input.stores!==undefined){
            if(!Array.isArray(input.stores))throw new RangeError('店铺范围必须是数组');
            if(!input.stores.length){selectedStores=new Set()}
            else{
              if(input.stores.length>1)throw new RangeError('当前接口仅支持按单个店铺筛选，请只传一个店铺');
              const invalid=input.stores.filter(name=>!liveStores().some(store=>store.name===name));
              if(invalid.length)throw new RangeError(`未知店铺：${invalid.join('、')}`);
              selectedStores=new Set(input.stores);
            }
            updateStoreButton();
          }
          if(input.view!==undefined)navigate(input.view);
          await reloadCurrentView({bypassCache:false});
          return dashboardScope();
        }
      }
    ];
    registrations.forEach(tool=>{
      try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(error=>console.warn('WebMCP tool registration failed',error))}
      catch(error){console.warn('WebMCP tool registration failed',error)}
    });
  }

  $$('.nav-item').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.view)));
  $('#menuButton').addEventListener('click',openSidebar);$('#scrim').addEventListener('click',closeSidebar);
  $('#exportButton').addEventListener('click',exportCurrentTable);
  $('#platformButton').addEventListener('click',()=>$('#platformPopover').hidden?openPlatformPopover():closePlatformPopover());$('#closePlatform').addEventListener('click',closePlatformPopover);$('#platformSearch').addEventListener('input',event=>renderPlatformOptions(event.target.value));$('#selectAllPlatforms').addEventListener('click',()=>$$('#platformList input[name="storeScope"]').forEach(input=>{input.checked=input.value===''}));$('#applyPlatforms').addEventListener('click',applyPlatformScope);
  $('#periodSwitch').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;closeDatePopover(false);closePlatformPopover(false);applyPresetPeriod(button.dataset.period)});
  $('#dateButton').addEventListener('click',()=>$('#datePopover').hidden?openDatePopover():closeDatePopover());$('#closeDate').addEventListener('click',()=>closeDatePopover());$('#applyDate').addEventListener('click',applySelectedDates);$('#resetDate').addEventListener('click',()=>{applyPresetPeriod('week');closeDatePopover()});
  $('#themeButton').addEventListener('click',()=>{const root=document.documentElement;const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;localStorage.setItem('ops-theme',next)});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if($('.drill-backdrop'))closeDrilldown();closeSidebar();if(!$('#platformPopover').hidden)closePlatformPopover();if(!$('#datePopover').hidden)closeDatePopover()}});
  window.addEventListener('resize',()=>{if(!$('#datePopover').hidden)positionDatePopover();if(!$('#platformPopover').hidden)positionPlatformPopover()});
  window.addEventListener('hashchange',()=>{const state=routeState();renderView(state.view,state.detail,state.openSeasonality)});
  window.addEventListener('beforeunload',()=>stopLogisticsPolling());
  window.addEventListener('analytics-auth-changed',()=>{
    bootstrapDone=false;
    cancelScopeReads();dataScopeVersion++;salesToken++;advertisingToken++;inventoryToken++;seasonalityToken++;multiplatformToken++;
    window.SalesCockpit?.reset?.();
    pendingDataPaint=null;closeDrilldown();
    Object.keys(loadedModuleScopes).forEach(key=>delete loadedModuleScopes[key]);
    Object.keys(loadedModuleAt).forEach(key=>delete loadedModuleAt[key]);
    Object.keys(moduleAttemptAt).forEach(key=>delete moduleAttemptAt[key]);
    Object.keys(logisticsPartState).forEach(key=>delete logisticsPartState[key]);
    liveData.sales=null;liveData.advertising=null;liveData.inventory=null;liveData.seasonality=null;liveData.multiplatform=null;
    liveData.options=null;liveData.status=null;liveData.exchangeRate=null;selectedStores=new Set();updateStoreButton();renderExchangeRateChrome();
    Object.keys(loadState).forEach(name=>loadState[name]={phase:'idle',error:''});
    logisticsToken++;stopLogisticsPolling(true);logisticsLoadedScope='';
    liveData.logisticsStatus=null;liveData.logisticsOverview=null;liveData.logisticsTrend=null;liveData.logisticsBreakdown=null;liveData.logisticsItems=null;liveData.logisticsAnomalies=null;
    loadState.logistics={phase:'idle',error:''};
    renderView(currentView);
    void bootstrapData();
  });
  $('#exchangeRateRefresh')?.addEventListener('click',async()=>{
    const button=$('#exchangeRateRefresh');
    if(!button)return;
    button.disabled=true;
    showToast('正在抓取最新人民币汇率');
    try{
      liveData.exchangeRate=await window.AnalyticsApi.exchangeRateRefresh();
      renderExchangeRateChrome();
      await reloadCurrentView();
      showToast('汇率已更新，经营金额已重新计算');
    }catch(error){
      showToast(error?.message||'汇率更新失败，继续使用上次成功汇率');
      renderExchangeRateChrome();
    }finally{button.disabled=false;}
  });
  document.documentElement.dataset.theme=localStorage.getItem('ops-theme')||'light';
  selectedDateRange=periodRange('week');
  syncDateControls('week');
  updateStoreButton();
  renderPlatformOptions();
  const initialRoute=routeState();
  renderView(initialRoute.view,initialRoute.detail,initialRoute.openSeasonality);
  void bootstrapData().then(()=>{
    registerWebMcpTools();
  });
})();


