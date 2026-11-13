(function () {
  'use strict';

  const SOURCES = [{id:'all'},{id:'analysis'},{id:'monthly-analysis'},{id:'unified'},{id:'amazon'},{id:'overseas'},{id:'walmart-live'},{id:'tiktok-live'},{id:'temu-live'},{id:'age'},{id:'import'},{id:'excluded'}];
  const SOURCE_NAMES = {amazon:'Amazon · FBA库存',overseas:'Excel · 其他海外仓月度报表', 'walmart-live':'沃尔玛 · 美国 WFS','tiktok-live':'TikTok · 美国 FBT','temu-live':'TEMU · 全托管仓'};
  const LIVE_SOURCE_REPORTS = {'walmart-live':'walmartUs','tiktok-live':'tikTokUs','temu-live':'temu'};
  const ANALYSIS_PAGES = [
    {id:'amazon',title:'Amazon · FBA库存',kind:'FBA库存'},
    {id:'walmart-live',title:'沃尔玛 · 美国 WFS',kind:'领星 API 实时库存'},
    {id:'tiktok-live',title:'TikTok · 美国 FBT',kind:'领星 API 实时库存'},
    {id:'temu-live',title:'TEMU · 全托管',kind:'领星 API 实时库存'},
    {id:'excel',title:'Excel 其他海外仓',kind:'月度账面库存'}
  ];
  const EMPTY = '__iw_unassigned__';
  const collator = new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  let context = {}, records = [], root = null, binding = null, callbacks = {}, savedDom = null;
  let marketplace = {data:null,loading:false,error:'',request:0};
  let unified = {monthly:null,loading:false,error:'',request:0};
  let scopeKey = null;
  let ui = defaultUi();

  function defaultUi(){return {source:'all',overviewDataset:'api',overviewPlatform:'amazon',overviewKeyword:'',overviewSorts:[],overviewColumnFilters:{},overviewFilterOpen:'',overviewFilterDraft:[],overviewRangeDraft:{min:'',max:''},overviewRangeError:'',overviewFilterSearch:'',overviewPage:1,overviewSize:50,overviewMoreOpen:false,analysisPage:'amazon',riskFilter:'all',drawerKey:'',drawerSource:'',platform:'all',seller:'all',country:'all',warehouse:'all',keyword:'',view:'detail',sort:'sku',direction:1,page:1,size:50,infoOpen:false,moreOpen:false,expanded:new Set(),groups:new Set(),unifiedSource:'all',unifiedPeriod:'',unifiedSort:'',unifiedDirection:0,unifiedFilters:{},unifiedFilterDraft:null,unifiedFilterOpen:false,unifiedFilterFocus:'',unifiedFilterSearch:{},unifiedSortOpen:false,unifiedSortDraft:null,unifiedColumnsOpen:false,unifiedColumns:{}};}
  function escape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function numeric(value){if(value===null||value===undefined||(typeof value==='string'&&value.trim()==='')||typeof value==='boolean')return null;const number=Number(value);return Number.isFinite(number)?number:null;}
  function text(value){return value===null||value===undefined?'':String(value).trim();}
  function number(value,digits=0){const parsed=numeric(value);return parsed===null?'—':parsed.toLocaleString('zh-CN',{maximumFractionDigits:digits,minimumFractionDigits:digits});}
  function count(value,unit='件',digits=0){const rendered=number(value,digits);return rendered==='—'?'—':`${rendered} ${unit}`;}
  function date(value){if(Array.isArray(value)&&value.length>=3)return `${value[0]}-${String(value[1]).padStart(2,'0')}-${String(value[2]).padStart(2,'0')}`;return text(value).slice(0,10)||'—';}
  function dateAfter(value,days){const source=date(value),amount=numeric(days);if(source==='—'||amount===null)return '';const parsed=new Date(`${source}T00:00:00`);if(Number.isNaN(parsed.getTime()))return '';parsed.setDate(parsed.getDate()+Math.max(0,Math.ceil(amount)));return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;}
  function forecastRisk(sellable,days,status){if(status==='INVALID_STOCK')return status;if(sellable!==null&&sellable===0)return 'STOCKOUT';if(['SALES_SOURCE_UNAVAILABLE','SALES_NOT_MATCHED','SALES_NOT_LINKED'].includes(status))return status;if(status==='NO_RECENT_SALES')return 'NO_RECENT_SALES';if(days!==null&&days<=7)return 'CRITICAL';if(days!==null&&days<14)return 'WATCH';return days!==null?'OK':'';}
  function splitStoreSite(value){const raw=text(value),match=raw.match(/^(.*?)[\s_-]([a-z]{2})$/i);return match&&text(match[1])?{name:text(match[1]),site:match[2].toUpperCase(),raw}:{name:raw,site:'',raw};}
  function snapshot(id){return id==='amazon'?(context.data?.amazonSnapshot||{}):{};}
  function liveSource(id){return Object.prototype.hasOwnProperty.call(LIVE_SOURCE_REPORTS,id);}
  function liveReport(id){return marketplace.data?.[LIVE_SOURCE_REPORTS[id]]||null;}
  function pending(){return false;}
  function overview(){return ui.source==='all';}
  function combinedAnalysis(){return ['analysis','monthly-analysis'].includes(ui.source);}
  function canExport(){return ui.source==='amazon'&&filtered().length>0||ui.source==='unified'&&unifiedRows().length>0;}
  function notifyState(){callbacks.onStateChange?.({source:ui.source,canExport:canExport()});}
  function presentData(){return !!context.data&&Object.prototype.hasOwnProperty.call(context.data,'amazonSnapshot');}
  function loading(){return !presentData()&&context.state?.phase!=='ready'&&context.state?.phase!=='error';}
  function sourceRecords(){return overview()||combinedAnalysis()?records:records.filter(row=>row.source===ui.source);}

  function normalize(data){
    const snap=data?.amazonSnapshot||{},source='amazon';
    if(snap.supported===false)return [];
    return (Array.isArray(snap.products)?snap.products:[]).flatMap((raw,index)=>{
      if(!raw||typeof raw!=='object')return [];
      const observed=numeric(raw.salesObservedDays30d),sales=numeric(raw.sales30d),available=numeric(raw.fbaSellable);
      const forecastDaily=observed>0&&sales!==null?sales/observed:null,forecastReady=forecastDaily!==null&&forecastDaily>0;
      const store=splitStoreSite(raw.sellerName),country=text(raw.country)||store.site;
      const sharedWarehouse=Number(raw.sharedWarehouse)===1||Number(raw.sid)===0;
      const sellerSkuDetails=Array.isArray(raw.sellerSkuDetails)?raw.sellerSkuDetails:[];
      const sellerSkuNames=[...new Set(sellerSkuDetails.map(item=>text(item.sellerSku)).filter(Boolean))];
      const forecastDays=forecastReady&&available!==null&&available>=0?available/forecastDaily:null;
      const forecastStatus=sharedWarehouse?'SHARED_WAREHOUSE':snap.salesStatsAvailable===false?'SALES_SOURCE_UNAVAILABLE':available!==null&&available<0?'INVALID_STOCK':forecastDaily===null?'SALES_NOT_MATCHED':forecastDaily<=0?'NO_RECENT_SALES':'READY_30D';
      return [{key:JSON.stringify([source,raw.localSku,raw.asin,raw.sid,raw.mid,raw.sellerName,raw.country,raw.warehouseScope,raw.sellerGroupName,index]),source,platform:'Amazon',sku:text(raw.localSku),name:text(raw.productName||raw.localName||raw.itemName),asin:text(raw.asin),seller:sharedWarehouse?'共享仓':store.name,sellerRaw:store.raw,country:sharedWarehouse?'':country,warehouse:source,warehouseLabel:sharedWarehouse?text(raw.warehouseScope||raw.warehouseNames)||'Amazon 共享仓':text(raw.warehouseNames)||'Amazon · FBA平台仓',physicalWarehouses:text(raw.warehouseNames||raw.warehouseScope),sharedWarehouse,sellerGroupName:text(raw.sellerGroupName),sellerSkuDetails,sellerSkuNames,dataDate:date(snap.dataDate||snap.snapshotDate),available,fbm:numeric(raw.fbmAvailable),occupied:numeric(raw.reserved),unsellable:numeric(raw.unsellable),inbound:numeric(raw.inbound),daily:forecastDaily,observed,sales,forecastDailySales:forecastDaily,forecastSellableDays:forecastDays,forecastWithInboundDays:forecastDays!==null&&numeric(raw.inbound)!==null&&numeric(raw.inbound)>=0?(available+numeric(raw.inbound))/forecastDaily:null,forecastMethod:'LAST_30D_FALLBACK',forecastStatus,stockRisk:forecastRisk(available,forecastDays,forecastStatus),estimatedStockoutDate:forecastDays!==null?dateAfter(snap.dataDate||snap.snapshotDate,forecastDays):'',raw}];
    });
  }

  function loadMarketplace(){
    if(marketplace.loading||marketplace.data)return;
    const load=window.MarketplaceInventory?.load;
    if(typeof load!=='function'){marketplace.error='实时库存模块尚未加载，请刷新页面。';repaint();return;}
    const request=++marketplace.request;
    marketplace.loading=true;marketplace.error='';repaint();
    load().then(data=>{
      if(request!==marketplace.request)return;
      marketplace={...marketplace,data:data||{},loading:false,error:''};
      if(liveSource(ui.source)||overview()||combinedAnalysis())repaint();
    }).catch(error=>{
      if(request!==marketplace.request)return;
      marketplace={...marketplace,loading:false,error:text(error?.message)||'实时平台仓库存读取失败。'};
      if(liveSource(ui.source)||overview()||combinedAnalysis())repaint();
    });
  }

  function filtered(){
    const term=ui.keyword.trim().toLocaleLowerCase();
    return sourceRecords().filter(row=>(ui.platform==='all'||row.platform===ui.platform)&&(ui.seller==='all'||(row.seller||EMPTY)===ui.seller)&&(ui.country==='all'||(row.country||EMPTY)===ui.country)&&(ui.warehouse==='all'||row.warehouse===ui.warehouse)&&(!term||[row.sku,row.name,row.asin,...(row.sellerSkuNames||[])].some(value=>text(value).toLocaleLowerCase().includes(term)))&&(ui.source==='amazon'?passesRisk(row):true));
  }
  function compare(a,b){if(a===null||a===undefined||a==='')return b===null||b===undefined||b===''?0:1;if(b===null||b===undefined||b==='')return -1;return (typeof a==='number'&&typeof b==='number'?a-b:collator.compare(String(a),String(b)))*ui.direction;}
  function sorted(rows){return rows.slice().sort((a,b)=>compare(a[ui.sort],b[ui.sort])||collator.compare(a.key,b.key));}
  function groups(rows){
    const result=new Map();
    rows.forEach(row=>{const key=row.sku?`sku:${row.sku}`:`missing:${row.key}`;if(!result.has(key))result.set(key,{key,sku:row.sku,rows:[],name:row.name});const group=result.get(key);group.rows.push(row);if(!group.name)group.name=row.name;});
    return [...result.values()].map(group=>({...group,count:group.rows.length,sources:new Set(group.rows.map(row=>row.source)).size})).sort((a,b)=>compare(a[ui.sort==='count'||ui.sort==='sources'?ui.sort:'sku'],b[ui.sort==='count'||ui.sort==='sources'?ui.sort:'sku'])||collator.compare(a.key,b.key));
  }

  function options(values,selected,allLabel){return `<option value="all">${escape(allLabel)}</option>`+values.map(([value,label])=>`<option value="${escape(value)}"${selected===value?' selected':''}>${escape(label)}</option>`).join('');}
  function distinct(rows,key,emptyLabel){return [...new Set(rows.map(row=>row[key]||EMPTY))].sort(collator.compare).map(value=>[value,value===EMPTY?emptyLabel:value]);}
  function selectFilter(name,label,values,allLabel,disabled=false){const current=ui[name],choices=values.slice();if(current!=='all'&&!choices.some(([value])=>value===current)){const missingLabel=current===EMPTY?(name==='seller'?'未关联店铺':'未标注国家'):name==='warehouse'?`${SOURCE_NAMES[current]||current} · 仓库未细分`:current;choices.push([current,`${missingLabel}（本次无记录）`]);}return `<label class="iw-filter"><span>${escape(label)}</span><select data-iw-filter="${name}" aria-label="${escape(label)}"${disabled?' disabled':''}>${options(choices,current,allLabel)}</select></label>`;}
  function sourceRail(){const detail=['unified','amazon','overseas','walmart-live','tiktok-live','temu-live'].includes(ui.source),analysis=['analysis','monthly-analysis','age'].includes(ui.source);return `<nav class="iw-source-rail" aria-label="库存中心导航"><div class="iw-nav-primary">${[['all','库存总览'],['analysis','库存分析'],['unified','商品明细']].map(([id,title])=>{const active=id==='unified'?detail:id==='analysis'?analysis:ui.source===id;return `<button type="button" class="iw-source${active?' is-active':''}" data-iw-source="${id==='analysis'&&['unified','overseas','monthly-analysis','age','import','excluded'].includes(ui.source)?'monthly-analysis':id}" aria-pressed="${active}">${title}</button>`;}).join('')}</div><div class="iw-nav-secondary"><details><summary>数据管理 ⌄</summary><div class="iw-nav-menu">${[['import','导入与对账'],['excluded','电子琴独立列表']].map(([id,title])=>`<button type="button" class="iw-source${ui.source===id?' is-active':''}" data-iw-source="${id}">${title}</button>`).join('')}</div></details><a class="iw-source iw-nav-last" href="#replenishment">采购与补货</a></div></nav>`;}
  function analysisPageSource(){return LIVE_SOURCE_REPORTS[ui.analysisPage]?ui.analysisPage:null;}
  function analysisHeader(){const page=ANALYSIS_PAGES.find(item=>item.id===ui.analysisPage)||ANALYSIS_PAGES[0],index=ANALYSIS_PAGES.indexOf(page)+1;return `<div class="iw-mode-header"><div><h2>库存分析</h2><p>领星实时库存与 Excel 其他海外仓分别成页，左右切换；各自保留日期、筛选与统计口径。</p></div><nav class="iw-analysis-pages" role="tablist" aria-label="库存分析分页">${ANALYSIS_PAGES.map((item,position)=>`<button type="button" role="tab" aria-selected="${item.id===page.id}" data-iw-analysis-page="${item.id}"><b>${String(position+1).padStart(2,'0')}</b> ${escape(item.title)}</button>`).join('')}<span>第 ${index} / ${ANALYSIS_PAGES.length} 页</span></nav></div>`;}
  function amazonAnalysis(){
    const charts=loading()?'<div class="iw-empty" role="status">正在读取 Amazon 库存分析数据…</div>':!presentData()||snapshot('amazon').supported===false?'<div class="iw-empty"><h3>当前范围暂无可分析的 Amazon 库存</h3><p>请检查店铺范围并重新读取。下方 Excel 月度库存可独立查看。</p><button type="button" class="iw-button" data-iw-action="retry">重新读取 Amazon</button></div>':!filtered().length?'<div class="iw-empty"><h3>当前 Amazon 快照没有匹配商品</h3><p>这不代表库存为 0。Excel 平台 SKU 可在下方月度库存区块查询。</p></div>':window.InventoryAnalysis?.render(filtered(),snapshot('amazon'),{complete:completeSource('amazon')})||'<div class="iw-empty">库存分析文件尚未加载，请刷新页面。</div>';
    return stateNotice()+filters()+charts;
  }
  function switchAnalysisPage(page){const next=ANALYSIS_PAGES.some(item=>item.id===page)?page:'amazon';if(ui.analysisPage===next)return;ui.analysisPage=next;ui.riskFilter='all';repaint(true);requestAnimationFrame(()=>root?.querySelector(`[data-iw-analysis-page="${next}"]`)?.focus({preventScroll:true}));}
  function liveAnalysis(id){const title=SOURCE_NAMES[id]||'实时平台仓';if(marketplace.loading)return `<div class="iw-empty" role="status"><span class="iw-loader" aria-hidden="true"></span><h3>正在读取${escape(title)}库存</h3><p>仅使用领星 API 当前快照，不回落到 Excel 月报。</p></div>`;if(marketplace.error)return `<div class="iw-notice iw-notice-error" role="alert"><div><strong>实时库存读取失败</strong><p>${escape(marketplace.error)}</p></div><button type="button" class="iw-button" data-iw-action="retry-live">重新读取</button></div>`;const status=liveStatus(id);if(!status.ready)return `<div class="iw-empty"><h3>${escape(title)}尚未读取</h3><p>此页只使用领星 API 实时库存，不显示 Excel 数据。</p><button type="button" class="iw-button" data-iw-action="retry-live">读取实时库存</button></div>`;return `<section class="iw-api-overview iw-live-analysis-page"><div class="iw-analysis-page-note">${escape(title)} · 领星 API 实时库存 · 快照 ${escape(status.updatedAt)}</div>${overviewMetrics(status)}${linkedAnalysis(status)}</section>`;}
  function analysisSlides(){const pages=ANALYSIS_PAGES,active=pages.find(item=>item.id===ui.analysisPage)||pages[0],index=pages.indexOf(active),basis=100/pages.length,shift=index*basis;const pageContent=page=>page.id==='amazon'?`<div data-iw-amazon-content>${amazonAnalysis()}</div>`:page.id==='excel'?'<div data-overseas-detail data-overseas-mode="analysis"></div>':liveAnalysis(page.id);const description=page=>page.id==='amazon'?'沿用顶部店铺及日期范围；以下商品筛选只作用于 Amazon。':page.id==='excel'?'仅分析非 Amazon、沃尔玛、TikTok、TEMU 的 Excel 记录；与领星实时快照分别统计，不合并数量。':`${page.title} 只读取领星 API 实时库存；与 Excel 月度账面不相加。`;return `<section class="iw-list-panel iw-analysis-pager" data-iw-combined-analysis><header class="iw-list-head">${sourceRail()}</header>${analysisHeader()}<div class="iw-analysis-deck"><div class="iw-analysis-track" style="width:${pages.length*100}%;transform:translateX(-${shift}%);">${pages.map(page=>{const visible=page.id===active.id;return `<section id="inventory-analysis-${escape(page.id)}" class="iw-analysis-page" style="flex-basis:${basis}%;" aria-hidden="${!visible}"${visible?'':' inert'} aria-labelledby="iw-${escape(page.id)}-analysis-title"><header class="iw-analysis-section-head"><div><span class="iw-analysis-source">${escape(page.kind)}</span><h3 id="iw-${escape(page.id)}-analysis-title">${escape(page.title)}</h3><p>${escape(description(page))}</p></div></header>${pageContent(page)}</section>`;}).join('')}</div></div></section>`;}
  function sourceSelector(){return `<div class="iw-filters iw-source-selector"><label class="iw-filter"><span>显示来源</span><select data-iw-unified-source aria-label="筛选库存来源"><option value="all"${ui.unifiedSource==='all'?' selected':''}>全部来源（统一查询）</option><option value="overseas"${ui.unifiedSource==='overseas'?' selected':''}>Excel 月度账面库存</option><option value="amazon"${ui.unifiedSource==='amazon'?' selected':''}>Amazon · FBA库存</option><optgroup label="实时库存（领星 API）"><option value="walmart-live"${ui.unifiedSource==='walmart-live'?' selected':''}>沃尔玛 · 美国 WFS</option><option value="tiktok-live"${ui.unifiedSource==='tiktok-live'?' selected':''}>TikTok · 美国 FBT</option><option value="temu-live"${ui.unifiedSource==='temu-live'?' selected':''}>TEMU · 全托管仓</option></optgroup></select></label><span class="iw-overview-note">同一 SKU 按来源分行展示；Excel 月度账面与领星实时库存不相加。</span></div>`;}
  function sourceCoverage(id){
    const snap=snapshot(id),rows=records.filter(row=>row.source===id),returned=numeric(snap.returnedCount),total=numeric(snap.total);
    if(!presentData())return loading()?'正在读取快照':'快照尚未读取';
    if(snap.supported===false)return text(snap.message)||'当前范围不支持此来源';
    if(returned===null&&total===null)return `已加载 ${number(rows.length)} 条 · 来源总数未提供`;
    return `已返回 ${number(returned??rows.length)} 条${total===null?' · 来源总数未提供':` / 来源总记录 ${number(total)} 条`}${snap.hasMore===true?' · 还有记录未加载':''}`;
  }
  function liveDays(value){const parsed=numeric(value);return parsed===null?'—':`${number(parsed,1)} 天`;}
  function liveRisk(value){return ({STOCKOUT:['已缺货','danger'],CRITICAL:['预测≤7天缺货风险','danger'],WATCH:['预测8–14天关注','warn'],OK:['预测库存正常','ok'],INVALID_STOCK:['库存负值待核对','warn'],NO_RECENT_SALES:['近30天无有效销量','muted'],SALES_SOURCE_UNAVAILABLE:['销量统计不可用','muted'],SALES_NOT_MATCHED:['销量未匹配','muted'],SALES_NOT_LINKED:['销量待接入','muted'],SHARED_WAREHOUSE:['共享仓独立库存','muted']})[value]||['—','muted'];}
  function amazonPendingRow(row){return !row.sharedWarehouse&&numeric(row.available)>0&&numeric(row.forecastSellableDays)===null;}
  function livePendingRow(row){return numeric(row.sellable)>0&&numeric(row.forecastSellableDays)===null;}
  function pendingForecastCount(status){return status.pending||0;}
  function overviewForecastRisk(row){if(row.sharedWarehouse)return '共享仓独立库存';if(row.forecastStatus==='SALES_SOURCE_UNAVAILABLE')return '销量统计不可用';if(row.forecastStatus==='SALES_NOT_MATCHED')return '销量未匹配';if(row.forecastStatus==='SALES_NOT_LINKED')return '销量待接入';if(row.forecastStatus==='NO_RECENT_SALES')return '近30天无销量';const days=numeric(row.forecastSellableDays);return days!==null&&days<14?'预测覆盖不足14天':days!==null&&days>=90?'预测高库存关注':'库存正常';}
  const OVERVIEW_SOURCES=['amazon','walmart-live','tiktok-live','temu-live'];
  function overviewTitle(id){return id==='amazon'?'Amazon':SOURCE_NAMES[id]||'平台库存';}
  function sumRows(rows,key){const values=rows.map(row=>numeric(row[key])).filter(value=>value!==null);return values.length?values.reduce((total,value)=>total+value,0):null;}
  function amazonStatus(){
    const snap=snapshot('amazon'),summary=snap.summary||{},rows=records.filter(row=>row.source==='amazon');
    const metric=(key,rowKey)=>numeric(summary[key])??sumRows(rows,rowKey);
    const confirmed=rows.map(row=>numeric(row.forecastSellableDays)).filter(value=>value!==null);
    const storeRows=rows.filter(row=>!row.sharedWarehouse),sharedRows=rows.filter(row=>row.sharedWarehouse);
    return {id:'amazon',title:'Amazon · FBA库存',kind:'近30天销量预测',forecastNote:snap.salesStatsAvailable===false?text(snap.salesStatsMessage)||'近30天销量统计暂不可用，库存快照已正常返回':'按近30天已记录销量预测',ready:presentData()&&snap.supported!==false,updatedAt:date(snap.dataDate||snap.snapshotDate),sellable:metric('fbaSellable','available'),sharedSellable:numeric(summary.sharedFbaSellable)??sumRows(sharedRows,'available'),sharedCount:numeric(summary.sharedProductCount)??sharedRows.length,inTransit:metric('inbound','inbound'),unfulfillable:metric('unsellable','unsellable'),reserved:metric('reserved','occupied'),low:confirmed.filter(value=>value<14).length,high:confirmed.filter(value=>value>=90).length,pending:storeRows.filter(amazonPendingRow).length,rows,coverageRows:confirmed,details:`${number(rows.length)} 条商品记录`};
  }
  function liveStatus(id){
    const report=liveReport(id),summary=report?.summary||{},sourceSummary=report?.sourceSummary||summary,coverage=report?.coverage||{},rows=Array.isArray(report?.rows)?report.rows:[];
    const unresolved=Number(coverage.unmatchedRows||0)+Number(coverage.ambiguousRows||0);
    const known=rows.map(row=>numeric(row.forecastSellableDays)).filter(value=>value!==null);
    return {id,title:overviewTitle(id),kind:'领星 API · 90天加权预测',forecastNote:'近30天/31–60天/61–90天销量按 50%/30%/20% 加权',ready:!!report,loading:marketplace.loading&&!report,updatedAt:date(report?.updatedAt||report?.sourceSyncAt),sellable:numeric(sourceSummary.sellable),inTransit:numeric(sourceSummary.inTransit),unfulfillable:numeric(sourceSummary.unfulfillable),reserved:numeric(sourceSummary.reserved),low:known.filter(value=>value>=0&&value<14).length,high:known.filter(value=>value>=90).length,pending:rows.filter(livePendingRow).length,sourceUnmatchedRows:unresolved,rows,coverageRows:known,details:report?`${number(coverage.sourceRows)} 条来源记录 · 已配对 ${number(rows.length)} 条`:'等待实时快照'};
  }
  function overviewStatus(id){return id==='amazon'?amazonStatus():liveStatus(id);}
  function riskLabel(value){return ({stockout:'现货为 0',critical:'预计 3 天内耗尽',low:'预测缺货关注',high:'预测高库存关注',pending:'销量 / 配对待核对','coverage-low':'预测覆盖不足14天','coverage-medium':'预测覆盖14–30天','coverage-long':'预测覆盖30–90天','coverage-high':'预测覆盖90天以上'})[value]||'';}
  function overviewRiskLabel(status,value){return status.id==='amazon'&&value==='pending'?'有库存 · 暂无预测':riskLabel(value);}
  function passesRisk(row){
    const filter=ui.riskFilter;
    if(!filter||filter==='all')return true;
    const days=numeric(row.forecastSellableDays);
    if(filter==='low'||filter==='coverage-low')return days!==null&&days<14;
    if(filter==='high'||filter==='coverage-high')return days!==null&&days>=90;
    if(filter==='coverage-medium')return days!==null&&days>=14&&days<30;
    if(filter==='coverage-long')return days!==null&&days>=30&&days<90;
    if(filter==='pending')return amazonPendingRow(row);
    return true;
  }
  function passesLiveRisk(row){
    const filter=ui.riskFilter;
    if(!filter||filter==='all')return true;
    const days=numeric(row.forecastSellableDays);
    if(filter==='low'||filter==='coverage-low')return ['STOCKOUT','CRITICAL','WATCH'].includes(row.stockRisk)||days!==null&&days<14;
    if(filter==='high'||filter==='coverage-high')return days!==null&&days>=90;
    if(filter==='coverage-medium')return days!==null&&days>=14&&days<30;
    if(filter==='coverage-long')return days!==null&&days>=30&&days<90;
    if(filter==='pending')return numeric(row.sellable)>0&&['SALES_SOURCE_UNAVAILABLE','SALES_NOT_MATCHED','SALES_NOT_LINKED','NO_RECENT_SALES'].includes(text(row.forecastStatus));
    return true;
  }
  function overviewPlatformTabs(){const active=OVERVIEW_SOURCES.includes(ui.overviewPlatform)?ui.overviewPlatform:OVERVIEW_SOURCES[0];return `<nav class="iw-platform-tabs" aria-label="选择库存分析平台"><span>库存分析平台</span><div role="tablist" aria-label="实时库存平台">${OVERVIEW_SOURCES.map(id=>`<button type="button" role="tab" data-iw-overview-platform-page="${id}" aria-selected="${id===active?'true':'false'}" tabindex="${id===active?'0':'-1'}"><b>${escape(overviewTitle(id))}</b><small>${id==='amazon'?'FBA库存 · 近30天预测':'领星 API · 90天预测'}</small></button>`).join('')}</div></nav>`;}
  function overviewSourceSwitch(){return `<section class="iw-overview-controls" aria-label="库存数据来源"><div class="iw-dataset-tabs" role="group" aria-label="选择库存来源"><button type="button" data-iw-overview-dataset="api" aria-pressed="${ui.overviewDataset==='api'}">实时库存（API）</button><button type="button" data-iw-overview-dataset="monthly" aria-pressed="${ui.overviewDataset==='monthly'}">海外仓与月度账面</button></div>${ui.overviewDataset==='api'?overviewPlatformTabs():''}</section>`;}
  function overviewMetrics(status){
    const metric=(label,value,note,tone='',unit='件')=>{const rendered=number(value);return `<button type="button" class="iw-overview-metric ${tone}" data-iw-overview-action="${tone||'details'}"><span>${escape(label)}</span><strong>${rendered}${rendered==='—'?'':`<em>${unit}</em>`}</strong><small>${escape(note)}</small></button>`;};
    const classifiedUnit=status.id==='amazon'?'条记录':'个 SKU';
    const sourceNote=status.id==='amazon'?`${status.title} · 共享仓 ${count(status.sharedSellable,'件')} / ${count(status.sharedCount,'条商品')} 独立列出`:'领星源快照 · 含待配对记录';
    return `<div class="iw-overview-metrics" aria-label="${escape(status.title)}库存关键指标">${metric('可售库存',status.sellable,sourceNote,'details','件')}${metric('在途 / 入库中',status.inTransit,'保留来源原字段','details','件')}${metric('低库存关注',status.low,'仅已成功配对的可分类记录','low',classifiedUnit)}${metric('有库存未预测',pendingForecastCount(status),'可售大于 0；销量或配对未确认','pending','条记录')}</div>`;
  }
  function coverageDistribution(status){
    const bins=[['coverage-low','0–14天',value=>value!==null&&value>=0&&value<14],['coverage-medium','14–30天',value=>value!==null&&value>=14&&value<30],['coverage-long','30–90天',value=>value!==null&&value>=30&&value<90],['coverage-high','90天以上',value=>value!==null&&value>=90]];
    const rows=status.rows.map(row=>numeric(row.forecastSellableDays)).filter(value=>value!==null);
    const unknown=pendingForecastCount(status),unknownLabel=status.id==='amazon'?(snapshot('amazon').salesStatsAvailable===false?'有库存 · 销量暂不可用':'有库存 · 暂无预测'):'销量 / 配对待核对';
    const max=Math.max(1,unknown,...bins.map(([, ,test])=>rows.filter(test).length));
    const classifiedUnit=status.id==='amazon'?'条记录':'个 SKU';
    return `<section class="iw-linked-coverage"><header><div><h3>预测可售天数分布</h3><p>${escape(status.forecastNote||status.title)} · 点击区间后，下方关联商品清单立即同步</p></div><span class="iw-linked-state" aria-live="polite">当前：${escape(overviewRiskLabel(status,ui.riskFilter)||'全部商品')}</span></header><div class="iw-coverage-bars">${bins.map(([key,label,test])=>{const bucketCount=rows.filter(test).length;return `<button type="button" data-iw-overview-action="${key}"><span>${label}</span><i><b style="width:${Math.max(bucketCount?7:0,bucketCount/max*100)}%"></b></i><strong>${count(bucketCount,classifiedUnit)}</strong></button>`;}).join('')}<button type="button" class="is-muted" data-iw-overview-action="pending"><span>${escape(unknownLabel)}</span><i><b style="width:${Math.max(unknown?7:0,unknown/max*100)}%"></b></i><strong>${count(unknown,'条记录')}</strong></button></div></section>`;
  }
  function forecastQuality(status){
    const rows=status.id==='amazon'?(status.rows||[]).filter(row=>!row.sharedWarehouse):(status.rows||[]),ready=rows.filter(row=>/^READY/.test(text(row.forecastStatus))).length,noRecent=rows.filter(row=>row.forecastStatus==='NO_RECENT_SALES').length,unlinked=rows.filter(row=>['SALES_SOURCE_UNAVAILABLE','SALES_NOT_MATCHED','SALES_NOT_LINKED'].includes(text(row.forecastStatus))).length,stockout=rows.filter(row=>row.stockRisk==='STOCKOUT').length,total=Math.max(1,rows.length),sourceUnavailable=status.id==='amazon'&&snapshot('amazon').salesStatsAvailable===false;
    const item=(label,value,tone,note)=>`<div class="iw-forecast-quality-item is-${tone}"><span>${escape(label)}</span><strong>${count(value,'个 SKU')}</strong><i><b style="width:${Math.max(value?7:0,value/total*100)}%"></b></i><small>${escape(note)}</small></div>`;
    return `<section class="iw-overview-card iw-forecast-quality"><header><div><h3>预测与数据质量</h3><p>销量统计不可用、未匹配与真实 0 分开显示。</p></div></header><div>${item('可预测',ready,'ok',status.id==='amazon'?'近30天销量预测':'90天加权销量')}${item('近30天无销量',noRecent,'muted','已匹配销量但近30天为 0')}${item(sourceUnavailable?'销量统计不可用':'销量未匹配',unlinked,'pending',sourceUnavailable?'Amazon 库存已读取，近30天销量汇总需修复':'销量源已读取，但未命中唯一 SKU / 店铺')}${item('已缺货',stockout,'danger','当前可售为 0')}</div></section>`;
  }
  function priorityTasks(status){const classifiedUnit=status.id==='amazon'?'条记录':'个 SKU';return `<section class="iw-overview-card iw-priority-card"><header><div><h3>优先处理</h3><p>点击任务后，左侧关联商品清单立即同步；任务可重叠，不相加。</p></div></header><div class="iw-priority-list"><button type="button" data-iw-overview-action="low"><span><i class="is-danger">!</i>优先核查补货</span><b>${count(status.low,classifiedUnit)}</b><em>›</em></button><button type="button" data-iw-overview-action="high"><span><i class="is-warn">↗</i>高库存关注</span><b>${count(status.high,classifiedUnit)}</b><em>›</em></button><button type="button" data-iw-overview-action="pending"><span><i class="is-muted">?</i>${status.id==='amazon'?'有库存 · 暂无预测':'销量 / 配对待核对'}</span><b>${count(pendingForecastCount(status),'条记录')}</b><em>›</em></button></div></section>`;}
  function overviewProducts(status){
    const rows=status.id==='amazon'?status.rows.filter(passesRisk).map(row=>({key:row.key,sku:row.sku,platformSku:row.asin,location:row.sharedWarehouse?row.warehouseLabel:[row.seller,row.country].filter(Boolean).join(' · '),stock:row.available,sales:row.sales,days:numeric(row.forecastSellableDays),risk:overviewForecastRisk(row),drawer:true})):status.rows.filter(passesLiveRisk).map((row,index)=>({key:String(index),sku:row.sku,platformSku:(row.platformSkus||[]).join('、'),location:(row.warehouses||[]).join('、'),stock:row.sellable,sales:row.sales30d,days:numeric(row.forecastSellableDays),risk:liveRisk(row.stockRisk)[0],live:true}));
    const label=overviewRiskLabel(status,ui.riskFilter)||'当前平台';
    const rowCount=status.id==='amazon'?count(rows.length,'条商品记录'):`${number(rows.length)} 个 SKU`;
    const previewHint=rows.length>6?(status.id==='amazon'?'，展示前 6 条':'，展示前 6 个 SKU'):'';
    return `<section class="iw-related-section" aria-live="polite"><header><div><h3>关联商品清单</h3><p>由左侧分布区间与右侧优先任务联动 · ${escape(status.title)} · ${escape(label)} · 共 ${rowCount}${previewHint}</p></div><button type="button" class="iw-text-button" data-iw-overview-source="${status.id}">查看全部 ↗</button></header><div class="iw-table-scroll"><table><thead><tr><th>主 SKU</th><th>平台 SKU</th><th>店铺 / 仓库</th><th>可售（件）</th><th>近30天销量（件）</th><th>预测可售天数</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.slice(0,6).map(row=>`<tr><td><strong>${escape(row.sku||'—')}</strong></td><td>${escape(row.platformSku||'—')}</td><td>${escape(row.location||'—')}</td><td class="iw-number">${count(row.stock,'件')}</td><td class="iw-number">${count(row.sales,'件')}</td><td class="iw-number">${row.days===null?'—':number(row.days,1)+' 天'}</td><td><span class="iw-overview-status">${escape(row.risk)}</span></td><td class="iw-table-action">${row.drawer?`<button type="button" class="iw-text-button" data-iw-overview-row="${escape(row.key)}">查看明细 →</button>`:`<button type="button" class="iw-text-button" data-iw-overview-source="${status.id}">查看明细 →</button>`}</td></tr>`).join('')||'<tr><td colspan="8" class="iw-missing">当前条件下没有可展示的商品记录。</td></tr>'}</tbody></table></div></section>`;
  }
  function linkedAnalysis(status){return `<div class="iw-linked-analysis-layout"><section class="iw-overview-card iw-linked-product-card">${coverageDistribution(status)}${overviewProducts(status)}</section><aside class="iw-linked-analysis-side">${priorityTasks(status)}${forecastQuality(status)}</aside></div>`;}
  const OVERVIEW_MISSING='__iw_missing_value__';
  const OVERVIEW_COLUMNS=[['asin','商品 / ASIN'],['location','店铺 / 仓库'],['stock','可售'],['inbound','在途'],['sales','近30天销量'],['days','预测可售天数'],['advice','处理提示']];
  const OVERVIEW_RANGE_KEYS=new Set(['stock','inbound','sales','days']);
  function overviewFilterCount(value){return Array.isArray(value)?value.length:value&&typeof value==='object'?Number(value.min!==null&&value.min!==undefined)+Number(value.max!==null&&value.max!==undefined):0;}
  function overviewMetric(status,row,key){const field={stock:status.id==='amazon'?'available':'sellable',inbound:status.id==='amazon'?'inbound':'inTransit',sales:status.id==='amazon'?'sales':'sales30d',days:'forecastSellableDays'}[key];return field?numeric(row[field]):null;}
  function overviewRangeLabel(value){return value.min!==null&&value.max!==null?`${value.min}–${value.max}`:value.min!==null?`≥ ${value.min}`:`≤ ${value.max}`;}
  function overviewLocation(status,row){return status.id==='amazon'?(row.sharedWarehouse?text(row.warehouseLabel):[row.seller,row.country].filter(Boolean).join(' · ')):((row.warehouses||[]).join('、')||(row.storeNames||row.stores||[]).join('、'));}
  function overviewColumnValues(status,row,key){
    if(key==='asin'){const values=status.id==='amazon'?[row.asin]:(row.platformSkus||[]);return [...new Set((values.length?values:['']).map(value=>text(value)||OVERVIEW_MISSING))];}
    if(key==='location')return [overviewLocation(status,row)||OVERVIEW_MISSING];
    if(key==='advice')return [overviewOperationalAdvice(status,row)||OVERVIEW_MISSING];
    const value=overviewMetric(status,row,key);return [value===null?OVERVIEW_MISSING:key==='days'?value.toFixed(1):String(value)];
  }
  function overviewColumnValueLabel(key,value){return value===OVERVIEW_MISSING?'缺失':(['stock','inbound','sales','days'].includes(key)?number(Number(value),key==='days'?1:0):value);}
  function overviewColumnOptions(status,key){
    const counts=new Map();(status.rows||[]).forEach(row=>overviewColumnValues(status,row,key).forEach(value=>counts.set(value,(counts.get(value)||0)+1)));
    const selected=new Set(ui.overviewFilterDraft),term=text(ui.overviewFilterSearch).toLocaleLowerCase();
    const options=[...counts].filter(([value])=>!term||overviewColumnValueLabel(key,value).toLocaleLowerCase().includes(term));
    options.sort((a,b)=>Number(selected.has(b[0]))-Number(selected.has(a[0]))||(a[0]===OVERVIEW_MISSING?1:b[0]===OVERVIEW_MISSING?-1:['stock','inbound','sales','days'].includes(key)?Number(a[0])-Number(b[0]):collator.compare(a[0],b[0])));
    return {total:options.length,visible:options.slice(0,100)};
  }
  function overviewOperationalBase(status){
    const term=text(ui.overviewKeyword).toLocaleLowerCase();
    const filters=Object.entries(ui.overviewColumnFilters).filter(([,value])=>overviewFilterCount(value)).map(([key,value])=>[key,Array.isArray(value)?new Set(value):value]);
    return (status.rows||[]).map((row,index)=>({row,index})).filter(({row})=>{
      if(filters.some(([key,value])=>{
        if(OVERVIEW_RANGE_KEYS.has(key)){
          const metric=overviewMetric(status,row,key);
          return metric===null||(value.min!==null&&metric<value.min)||(value.max!==null&&metric>value.max);
        }
        return !overviewColumnValues(status,row,key).some(item=>value.has(item));
      }))return false;
      if(!term)return true;
      const fields=status.id==='amazon'?[row.sku,row.asin,row.name,row.seller,...(row.sellerSkuNames||[])]:[row.sku,row.name,...(row.platformSkus||[]),...(row.storeNames||row.stores||[])];
      return fields.some(value=>text(value).toLocaleLowerCase().includes(term));
    });
  }
  function overviewOperationalSort(status,a,b){
    const sorts=ui.overviewSorts||[];
    if(!sorts.length)return overviewOperationalRank(status,a.row)-overviewOperationalRank(status,b.row)||collator.compare(text(a.row.sku),text(b.row.sku))||a.index-b.index;
    for(const {key,direction} of sorts){
      const descending=direction==='desc';
      if(['asin','location','advice'].includes(key)){
        const left=overviewColumnValues(status,a.row,key)[0],right=overviewColumnValues(status,b.row,key)[0];
        if(left===OVERVIEW_MISSING||right===OVERVIEW_MISSING){if(left!==right)return left===OVERVIEW_MISSING?1:-1;continue;}
        const result=collator.compare(left,right)*(descending?-1:1);if(result)return result;
      }else{
        const field={stock:status.id==='amazon'?'available':'sellable',inbound:status.id==='amazon'?'inbound':'inTransit',sales:status.id==='amazon'?'sales':'sales30d',days:'forecastSellableDays'}[key];if(!field)continue;
        const left=numeric(a.row[field]),right=numeric(b.row[field]);
        if(left===null||right===null){if(left!==right)return left===null?1:-1;continue;}
        const result=descending?right-left:left-right;if(result)return result;
      }
    }
    return collator.compare(text(a.row.sku),text(b.row.sku))||a.index-b.index;
  }
  function overviewOperationalRisk(status,row,risk){
    const days=numeric(row.forecastSellableDays);
    if(risk==='all')return true;
    if(risk==='stockout')return numeric(status.id==='amazon'?row.available:row.sellable)===0&&!row.sharedWarehouse;
    if(risk==='critical')return !row.sharedWarehouse&&numeric(status.id==='amazon'?row.available:row.sellable)>0&&days!==null&&days>=0&&days<=3;
    if(risk==='low')return !row.sharedWarehouse&&days!==null&&days>=0&&days<14;
    if(risk==='high')return !row.sharedWarehouse&&days!==null&&days>=90;
    if(risk==='pending')return status.id==='amazon'?amazonPendingRow(row):livePendingRow(row);
    return status.id==='amazon'?passesRisk(row):passesLiveRisk(row);
  }
  function overviewOperationalRank(status,row){
    if(row.sharedWarehouse)return 6;
    const days=numeric(row.forecastSellableDays),quantity=numeric(status.id==='amazon'?row.available:row.sellable);
    if(quantity===0)return 0;
    if(days!==null&&days<=3)return 1;
    if(days!==null&&days<14)return 2;
    if(quantity>0&&days===null)return 3;
    if(days!==null&&days>=90)return 4;
    return 5;
  }
  function overviewOperationalAdvice(status,row){
    if(row.sharedWarehouse)return '共享仓单列';
    const quantity=numeric(status.id==='amazon'?row.available:row.sellable),days=numeric(row.forecastSellableDays);
    if(quantity===0)return '核查现货与在途';
    if(days!==null&&days<=3)return '优先核查补货';
    if(days!==null&&days<14)return '核对在途和补货';
    if(quantity>0&&days===null)return '核查销量或配对';
    if(days!==null&&days>=90)return '关注高库存';
    return '—';
  }
  function overviewFilterPanel(status,key,label){
    if(OVERVIEW_RANGE_KEYS.has(key)){
      const draft=ui.overviewRangeDraft;
      return `<div class="iw-ops-filter-panel" role="dialog" aria-label="筛选${escape(label)}区间">
        <strong>筛选${escape(label)} · 区间</strong>
        <div class="iw-ops-range"><label>最小值<input type="number" min="0" step="any" data-iw-overview-range="min" value="${escape(draft.min)}" placeholder="不限" aria-label="${escape(label)}最小值"></label><label>最大值<input type="number" min="0" step="any" data-iw-overview-range="max" value="${escape(draft.max)}" placeholder="不限" aria-label="${escape(label)}最大值"></label></div>
        <small>包含边界；缺失值不会算作 0。</small>${ui.overviewRangeError?`<p class="iw-ops-range-error" role="alert">${escape(ui.overviewRangeError)}</p>`:''}
        <div class="iw-ops-filter-actions"><button type="button" data-iw-overview-cancel-filter>取消</button><button type="button" data-iw-overview-clear-range>清空</button><button type="button" data-iw-overview-apply-filter>应用</button></div>
      </div>`;
    }
    const {total,visible}=overviewColumnOptions(status,key),selected=new Set(ui.overviewFilterDraft);
    return `<div class="iw-ops-filter-panel" role="dialog" aria-label="筛选${escape(label)}">
      <strong>筛选${escape(label)} · 可多选</strong>
      <input type="search" class="iw-ops-filter-search" data-iw-overview-filter-search value="${escape(ui.overviewFilterSearch)}" placeholder="${key==='asin'?'搜索 ASIN':'搜索选项'}" aria-label="搜索${escape(label)}选项">
      <div class="iw-ops-filter-options" data-iw-scroll="overview-filter-options">${visible.map(([value,count])=>`<label><input type="checkbox" data-iw-overview-choice="${key}" value="${escape(value)}"${selected.has(value)?' checked':''}><span>${escape(overviewColumnValueLabel(key,value))} <small>(${number(count)})</small></span></label>`).join('')||'<p>没有匹配的选项。</p>'}</div>
      <small>显示 ${number(visible.length)} / ${number(total)} 项；可搜索后继续勾选。</small>
      <div class="iw-ops-filter-actions"><button type="button" data-iw-overview-select-visible>全选当前显示</button><button type="button" data-iw-overview-clear-draft>清空勾选</button><button type="button" data-iw-overview-cancel-filter>取消</button><button type="button" data-iw-overview-apply-filter>应用</button></div>
    </div>`;
  }
  function overviewColumnHeader(status,key,label){
    const open=ui.overviewFilterOpen===key,active=overviewFilterCount(ui.overviewColumnFilters[key]),rank=(ui.overviewSorts||[]).findIndex(item=>item.key===key),sort=rank>=0?ui.overviewSorts[rank].direction:'';
    const sortHint=sort==='asc'?'升序，点击改为降序':sort==='desc'?'降序，点击移除这列排序':'点击加入多列排序';
    return `<th${open?' class="is-filter-open"':''}><div class="iw-ops-th-controls"><span>${escape(label)}</span><button type="button" class="iw-ops-sort-button" data-iw-overview-sort="${key}" aria-label="按${escape(label)}排序${rank>=0?'，第'+(rank+1)+'优先级，'+(sort==='asc'?'升序':'降序'):''}" aria-pressed="${!!sort}" title="${sortHint}"><span aria-hidden="true">${sort==='asc'?'↑':sort==='desc'?'↓':'↕'}</span>${rank>=0?`<b class="iw-ops-sort-rank">${rank+1}</b>`:''}</button><button type="button" class="iw-ops-filter-button" data-iw-overview-filter="${key}" aria-label="筛选${escape(label)}${active?'，已选'+active+'项':''}" aria-expanded="${open}" title="筛选${escape(label)}"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 3h12l-4.7 5.2v3.5l-2.6 1.4V8.2L2 3z" fill="currentColor"/></svg>${active?`<b class="iw-ops-filter-count">${active}</b>`:''}</button></div>${open?overviewFilterPanel(status,key,label):''}</th>`;
  }
  function overviewOperational(status){
    const base=overviewOperationalBase(status),risk=ui.riskFilter||'all';
    const tabs=[['all','全部'],['stockout','现货为 0'],['critical','预计 3 天内'],['low','预计 14 天内'],['high','预计 90 天以上'],['pending','有库存未预测']];
    const selected=base.filter(({row})=>overviewOperationalRisk(status,row,risk)).sort((a,b)=>overviewOperationalSort(status,a,b));
    const size=ui.overviewSize,pageCount=Math.max(1,Math.ceil(selected.length/size));ui.overviewPage=Math.min(Math.max(1,ui.overviewPage),pageCount);
    const start=(ui.overviewPage-1)*size,visible=selected.slice(start,start+size);
    const scope=status.id==='amazon'?`快照 ${escape(status.updatedAt)} · 店铺与共享仓分别展示 · ${escape(status.forecastNote)}`:`快照 ${escape(status.updatedAt)} · ${escape(status.forecastNote)}${status.sourceUnmatchedRows?` · 另有 ${number(status.sourceUnmatchedRows)} 条来源配对待核对，未并入商品行`:''}`;
    const rowHtml=({row,index})=>{
      const amazon=status.id==='amazon',quantity=amazon?row.available:row.sellable,inbound=amazon?row.inbound:row.inTransit,sales=amazon?row.sales:row.sales30d;
      const location=overviewLocation(status,row);
      const name=text(row.name||row.productName),identifier=amazon?row.asin:(row.platformSkus||[]).join('、');
      const action=amazon?`data-iw-overview-row="${escape(row.key)}"`:`data-iw-overview-live-row="${index}"`;
      return `<tr><td><strong>${escape(row.sku||'未标注 SKU')}</strong><small>${escape(identifier||'—')}</small>${name?`<span title="${escape(name)}">${escape(name)}</span>`:''}</td><td>${escape(location||'—')}${row.sharedWarehouse?'<small>独立库存</small>':''}</td><td class="iw-number">${number(quantity)}</td><td class="iw-number">${number(inbound)}</td><td class="iw-number">${number(sales)}</td><td class="iw-number">${liveDays(row.forecastSellableDays)}</td><td><span class="iw-ops-advice">${escape(overviewOperationalAdvice(status,row))}</span></td><td><button type="button" class="iw-text-button" ${action}>查看 →</button></td></tr>`;
    };
    const applied=OVERVIEW_COLUMNS.filter(([key])=>overviewFilterCount(ui.overviewColumnFilters[key]));
    return `<section class="iw-ops-panel" aria-label="${escape(status.title)}商品库存">
      <header><div><h3>商品库存</h3><p>${scope}</p></div><span>${number(selected.length)} / ${number((status.rows||[]).length)} 条商品</span></header>
      <div class="iw-ops-filters"><label class="iw-ops-search"><span class="iw-visually-hidden">搜索商品</span><input type="search" data-iw-overview-keyword value="${escape(ui.overviewKeyword)}" placeholder="搜索 SKU / ASIN / 卖家 SKU / 品名"></label></div>
      <div class="iw-ops-risk" role="group" aria-label="按库存状态筛选">${tabs.map(([key,label])=>`<button type="button" data-iw-overview-risk="${key}" aria-pressed="${risk===key}">${label}<b>${number(base.filter(({row})=>overviewOperationalRisk(status,row,key)).length)}</b></button>`).join('')}</div>
      ${applied.length?`<div class="iw-ops-active-filters"><span>已筛选：</span>${applied.map(([key,label])=>`<button type="button" data-iw-overview-remove-filter="${key}" aria-label="移除${escape(label)}筛选">${escape(key==='asin'&&status.id==='amazon'?'ASIN':label)} ${OVERVIEW_RANGE_KEYS.has(key)?escape(overviewRangeLabel(ui.overviewColumnFilters[key])):number(ui.overviewColumnFilters[key].length)+' 项'} ×</button>`).join('')}<button type="button" data-iw-overview-clear-all>清除全部</button></div>`:''}
      <div class="iw-ops-table-scroll" data-iw-scroll="overview-list"><table><thead><tr>${OVERVIEW_COLUMNS.map(([key,label])=>overviewColumnHeader(status,key,key==='asin'&&status.id!=='amazon'?'商品 / 平台 SKU':label)).join('')}<th>详情</th></tr></thead><tbody>${visible.map(rowHtml).join('')||'<tr><td colspan="8" class="iw-missing">此条件下没有商品。可清除表头筛选或搜索词。</td></tr>'}</tbody></table></div>
      <footer><span>显示 ${selected.length?number(start+1):0}–${number(Math.min(start+size,selected.length))} 条，共 ${number(selected.length)} 条</span><div><label>每页 <select data-iw-overview-size><option value="50"${size===50?' selected':''}>50 条</option><option value="100"${size===100?' selected':''}>100 条</option></select></label><button type="button" data-iw-overview-page="prev" ${ui.overviewPage===1?'disabled':''}>上一页</button><b>${number(ui.overviewPage)} / ${number(pageCount)}</b><button type="button" data-iw-overview-page="next" ${ui.overviewPage===pageCount?'disabled':''}>下一页</button></div></footer>
    </section><details class="iw-ops-more" data-iw-disclosure="overviewMoreOpen"${ui.overviewMoreOpen?' open':''}><summary>查看预测分布与数据质量</summary><div>${coverageDistribution(status)}${forecastQuality(status)}</div></details>`;
  }
  function apiOverview(){const statuses=OVERVIEW_SOURCES.map(overviewStatus),active=statuses.find(status=>status.id===ui.overviewPlatform)||statuses[0],liveError=marketplace.error?`<div class="iw-notice iw-notice-error" role="alert"><div><strong>部分实时平台仓未能读取</strong><p>${escape(marketplace.error)}</p></div><button type="button" class="iw-button" data-iw-action="retry-live">重新读取</button></div>`:'';const content=active.ready?`${overviewMetrics(active)}${overviewOperational(active)}`:`<div class="iw-empty" role="status"><h3>${escape(active.title)}快照尚未就绪</h3><p>${active.loading?'正在读取库存快照。':'当前平台没有可用快照，请重新读取。'}</p>${active.loading?'':`<button type="button" class="iw-button" data-iw-action="${active.id==='amazon'?'retry':'retry-live'}">重新读取</button>`}</div>`;return `<section class="iw-api-overview">${liveError}${content}</section>${productDrawer()}`;}
  function liveDetails(){
    const title=SOURCE_NAMES[ui.source]||'实时平台仓';
    if(marketplace.loading)return `<section class="iw-live-detail"><div class="iw-empty" role="status"><span class="iw-loader" aria-hidden="true"></span><h3>正在读取${escape(title)}库存</h3><p>将按领星当前快照展示，不回落到 Excel 月报。</p></div></section>`;
    if(marketplace.error)return `<section class="iw-live-detail"><div class="iw-notice iw-notice-error"><div><strong>实时库存读取失败</strong><p>${escape(marketplace.error)}</p></div><button type="button" class="iw-button" data-iw-action="retry-live">重新读取</button></div></section>`;
    const report=liveReport(ui.source);
    if(!report)return `<section class="iw-live-detail"><div class="iw-empty"><h3>实时库存尚未读取</h3><p>此来源不会显示 Excel 数据。</p><button type="button" class="iw-button" data-iw-action="retry-live">读取实时库存</button></div></section>`;
    const summary=report.summary||{},coverage=report.coverage||{},sales=report.sales||{},allRows=Array.isArray(report.rows)?report.rows:[],rows=allRows.filter(passesLiveRisk),salesConnected=Number(sales.sourceGroups||0)>0,salesKnown=numeric(sales.pairedUnits);
    const unresolved=Number(coverage.unmatchedRows||0)+Number(coverage.ambiguousRows||0),forecasted=allRows.filter(row=>numeric(row.forecastSellableDays)!==null).length;
    return `<section class="iw-live-detail" aria-label="${escape(title)}实时库存"><header class="iw-live-detail-head"><div><span>实时库存 · 领星 API</span><h2>${escape(title)}</h2><p>${escape(report.quantitySemantics||'当前库存快照')}</p></div><button type="button" class="iw-text-button" data-iw-source="all">返回库存总览 ↗</button></header><dl class="iw-live-detail-metrics"><div><dt>可售</dt><dd>${number(summary.sellable)}<em>件</em></dd></div><div><dt>在途</dt><dd>${number(summary.inTransit)}<em>件</em></dd></div><div><dt>不可售</dt><dd>${number(summary.unfulfillable)}<em>件</em></dd></div><div><dt>近30天有效销量</dt><dd>${salesConnected?number(salesKnown):'—'}${salesConnected?'<em>件</em>':''}</dd><small>${salesConnected?`截至 ${escape(date(sales.windowEnd))}`:'销量源不可用'}</small></div><div><dt>可预测 SKU</dt><dd>${number(forecasted)}<em>个</em></dd><small>近30天、31–60天、61–90天按 50% / 30% / 20% 加权</small></div><div><dt>当前 SKU 数</dt><dd>${number(rows.length)}<em>个</em></dd><small>${ui.riskFilter!=='all'?'已按风险条件筛选；':''}来源记录 ${count(coverage.sourceRows,'条')}</small></div></dl>${ui.riskFilter!=='all'?`<div class="iw-active-risk">当前筛选：${escape(riskLabel(ui.riskFilter))}<button type="button" data-iw-action="clear-risk">清除条件</button></div>`:''}<p class="iw-live-detail-note">${escape(sales.quantitySemantics||'')}${unresolved?`；${count(unresolved,'条')}库存记录未配对或一对多配对，未进入 SKU 汇总。`:''}</p><div class="iw-table-scroll iw-live-table"><table class="iw-table"><thead><tr><th>内部 SKU</th><th>可售（件）</th><th>在途（件）</th><th>不可售（件）</th><th>近30天销量（件）</th><th>预测日销（件）</th><th>预测可售天数</th><th>预计断货日</th><th>风险</th><th>平台仓</th><th>操作</th></tr></thead><tbody>${rows.length?rows.map(row=>{const [riskText,riskTone]=liveRisk(row.stockRisk),index=allRows.indexOf(row);return `<tr><td><strong>${escape(row.sku||'—')}</strong></td><td class="iw-number">${number(row.sellable)}</td><td class="iw-number">${number(row.inTransit)}</td><td class="iw-number">${number(row.unfulfillable)}</td><td class="iw-number">${number(row.sales30d)}</td><td class="iw-number">${number(row.forecastDailySales,2)}</td><td class="iw-number">${liveDays(row.forecastSellableDays)}${numeric(row.forecastWithInboundDays)!==null?`<small>含在途 ${liveDays(row.forecastWithInboundDays)}</small>`:`<small>${escape(forecastStatusLabel(row.forecastStatus))}</small>`}</td><td>${escape(date(row.estimatedStockoutDate))}</td><td><span class="iw-live-risk is-${riskTone}">${escape(riskText)}</span></td><td title="${escape((row.warehouses||[]).join('、'))}">${escape((row.warehouses||[]).join('、')||'—')}</td><td><button type="button" class="iw-text-button" data-iw-live-drawer="${index}" aria-haspopup="dialog">查看明细 →</button></td></tr>`;}).join(''):`<tr><td colspan="11" class="iw-missing">当前筛选下暂无成功配对的 SKU。</td></tr>`}</tbody></table></div></section>`;
  }
  const UNIFIED_SOURCE_ORDER=['overseas','amazon','walmart-live','tiktok-live','temu-live'];
  function unifiedPeriod(){return ui.unifiedPeriod||text(unified.monthly?.period);}
  function sourceTitle(id){return SOURCE_NAMES[id]||'库存来源待确认';}
  function sourceFilterValue(rowOrSource){
    const source=typeof rowOrSource==='string'?rowOrSource:text(rowOrSource?.source);
    if(source==='overseas'){
      const warehouse=typeof rowOrSource==='string'?'*':(text(rowOrSource?.warehouse)||'未标注仓库');
      return `excel:${warehouse}`;
    }
    return `api:${source}`;
  }
  function sourceFilterLabel(value){
    const raw=text(value);
    if(raw==='excel:*')return 'Excel · 全部海外仓';
    if(raw.startsWith('excel:'))return `Excel · ${raw.slice(6)||'未标注仓库'}`;
    if(raw.startsWith('api:'))return sourceTitle(raw.slice(4));
    return sourceTitle(raw);
  }
  function unifiedSourceDetail(row){
    if(row.source==='overseas')return `Excel · ${text(row.warehouse)||'未标注仓库'}`;
    if(row.source==='amazon')return 'Amazon · FBA库存';
    return `${sourceTitle(row.source)} · 领星 API 实时库存`;
  }
  const EXCEL_API_EXCLUDED_PLATFORMS=new Set(['amazon','亚马逊','walmart','沃尔玛','tiktok','tik tok','temu']);
  const PHYSICAL_OVERSEAS_WAREHOUSES=new Set(['速星海外仓','FLash海外仓','中南通达海外仓','天屹海外仓','友乐海外仓','谷仓海外仓','金仓海外仓','神户海外仓','日本大阪自建仓','佑美顺海外仓','天瞳海外仓','海源一件代发海外仓','佑美顺一件代发海外仓']);
  function isPhysicalOverseasWarehouse(raw){return PHYSICAL_OVERSEAS_WAREHOUSES.has(text(raw.warehouse||raw.rawWarehouse||raw.warehouseName));}
  function keepMonthlyUnifiedRow(raw){return isPhysicalOverseasWarehouse(raw)||!EXCEL_API_EXCLUDED_PLATFORMS.has(text(raw.platform).toLocaleLowerCase());}
  function monthlyUnifiedRows(){return (unified.monthly?.rows||[]).filter(keepMonthlyUnifiedRow).map((raw,index)=>({
    key:`overseas:${raw.id||raw.sourceRow||index}:${raw.localSku||raw.platformSku||''}`,
    source:'overseas', sku:text(raw.localSku||raw.platformSku||raw.sku), platformSku:text(raw.platformSku),
    name:text(raw.localName||raw.productName||raw.name), platform:text(raw.platform)||'待确认', seller:text(raw.shop),
    country:text(raw.country||raw.marketScope), warehouse:text(raw.warehouse||raw.rawWarehouse),
    quantity:numeric(raw.quantity), inTransit:null, unfulfillable:null, reserved:null, sales:null,
    forecastDailySales:null,forecastSellableDays:null,forecastWithInboundDays:null,forecastMethod:null,forecastStatus:'SALES_NOT_LINKED',stockRisk:'SALES_NOT_LINKED',estimatedStockoutDate:'',
    dataDate:text(raw.period||unified.monthly?.period), stockLabel:'账面数量', detail:'月度报表原始值 · 销量待接入', raw
  }));}
  function amazonUnifiedRows(){return records.map(row=>({
    key:row.key, source:'amazon', sku:row.sku, platformSku:row.asin, name:row.name, platform:'Amazon',
    seller:row.seller, country:row.country, warehouse:row.warehouseLabel, sharedWarehouse:row.sharedWarehouse,sellerSkuNames:row.sellerSkuNames, quantity:row.available,
    inTransit:row.inbound, unfulfillable:row.unsellable, reserved:row.occupied, sales:row.sales,
    forecastDailySales:row.forecastDailySales,forecastSellableDays:row.forecastSellableDays,forecastWithInboundDays:row.forecastWithInboundDays,forecastMethod:row.forecastMethod,forecastStatus:row.forecastStatus,stockRisk:row.stockRisk,estimatedStockoutDate:row.estimatedStockoutDate,
    dataDate:row.dataDate, stockLabel:'FBA 可售', detail:'当前 API 快照 · 近30天预测', raw:row.raw
  }));}
  function liveUnifiedRows(id){
    const report=liveReport(id),rows=Array.isArray(report?.rows)?report.rows:[],platform={
      'walmart-live':'Walmart','tiktok-live':'TikTok','temu-live':'TEMU · 全托管'
    }[id]||'待确认';
    return rows.map((row,index)=>({
      key:`${id}:${index}:${text(row.sku)}`,source:id,sku:text(row.sku),platformSku:text((row.platformSkus||[]).join('、')),
      name:text(row.name||row.productName),platform,seller:text((row.stores||row.storeNames||[])[0]||row.storeName),
      country:text(row.country||row.market),warehouse:text((row.warehouses||[])[0]||'平台仓'),quantity:numeric(row.sellable),
      inTransit:numeric(row.inTransit),unfulfillable:numeric(row.unfulfillable),reserved:numeric(row.reserved),sales:numeric(row.sales30d),
      forecastDailySales:numeric(row.forecastDailySales),forecastSellableDays:numeric(row.forecastSellableDays),forecastWithInboundDays:numeric(row.forecastWithInboundDays),forecastMethod:text(row.forecastMethod),forecastStatus:text(row.forecastStatus)||'SALES_NOT_LINKED',stockRisk:text(row.stockRisk),estimatedStockoutDate:date(row.estimatedStockoutDate),
      dataDate:date(report?.updatedAt||report?.sourceSyncAt),stockLabel:'可售',detail:`当前 API 快照 · ${text(row.forecastMethod)==='WEIGHTED_90D'?'90天加权预测':forecastStatusLabel(text(row.forecastStatus))}`,raw:row
    }));
  }
  function allUnifiedRows(){return [...monthlyUnifiedRows(),...amazonUnifiedRows(),...liveUnifiedRows('walmart-live'),...liveUnifiedRows('tiktok-live'),...liveUnifiedRows('temu-live')];}
  const UNIFIED_FILTER_META={source:{label:'数据来源',type:'choice'},platform:{label:'平台',type:'choice'},country:{label:'国家 / 区域',type:'choice'},quantity:{label:'可售 / 账面数量（件）',type:'number',unit:'件'},inTransit:{label:'在途（件）',type:'number',unit:'件'},unfulfillable:{label:'不可售（件）',type:'number',unit:'件'},sales:{label:'近30天销量（件）',type:'number',unit:'件'},forecastSellableDays:{label:'预测可售天数',type:'number',unit:'天'},forecastStatus:{label:'预测数据状态',type:'choice'},stockRisk:{label:'库存风险',type:'choice'},dataDate:{label:'快照 / 月份',type:'date'}};
  const UNIFIED_COLUMNS=[
    {key:'sku',label:'主 SKU / 品名',filterKey:'',sortable:true},
    {key:'platform',label:'平台 · 数据来源',filterKey:'',sortable:true},
    {key:'seller',label:'店铺 / 国家',filterKey:'',sortable:true},
    {key:'warehouse',label:'平台仓',filterKey:'',sortable:true},
    {key:'quantity',label:'可售 / 账面数量（件）',filterKey:'',sortable:true,numeric:true},
    {key:'inTransit',label:'在途（件）',filterKey:'',sortable:true,numeric:true},
    {key:'unfulfillable',label:'不可售（件）',filterKey:'',sortable:true,numeric:true},
    {key:'sales',label:'近30天销量（件）',filterKey:'',sortable:true,numeric:true},
    {key:'forecastSellableDays',label:'预测可售天数',filterKey:'',sortable:true,numeric:true},
    {key:'stockRisk',label:'库存风险',filterKey:'',sortable:true},
    {key:'estimatedStockoutDate',label:'预计断货日',filterKey:'',sortable:true},
    {key:'forecastStatus',label:'预测数据状态',filterKey:'',sortable:true},
    {key:'dataDate',label:'快照 / 月份',filterKey:'',sortable:true}
  ];
  const UNIFIED_TEXT_SORTS=new Set(['sku','platform','seller','warehouse','forecastStatus','stockRisk']);
  const clone=value=>JSON.parse(JSON.stringify(value||{}));
  const filterLabel=(key,value)=>key==='source'?sourceFilterLabel(value):key==='forecastStatus'?forecastStatusLabel(text(value)):key==='stockRisk'?liveRisk(text(value))[0]:text(value)||'未标注';
  function unifiedColumnValue(row,key){
    if(key==='source')return sourceFilterValue(row);
    if(key==='sku')return text(row.sku)||'未标注 SKU';
    if(key==='platform')return text(row.platform)||'待确认平台';
    if(key==='seller')return text(row.seller)||'未标注店铺';
    if(key==='country')return text(row.country)||'未标注国家 / 区域';
    if(key==='warehouse')return text(row.warehouse)||'未标注平台仓';
    if(key==='forecastStatus')return text(row.forecastStatus)||'SALES_NOT_LINKED';
    if(key==='stockRisk')return text(row.stockRisk)||'SALES_NOT_LINKED';
    if(key==='estimatedStockoutDate')return text(row.estimatedStockoutDate)||'';
    if(key==='dataDate')return text(row.dataDate)||'未标注日期';
    return numeric(row[key]);
  }
  function unifiedBaseRows(){
    const term=text(ui.keyword).toLocaleLowerCase();
    return allUnifiedRows().filter(row=>!term||[row.sku,row.platformSku,row.name,...(row.sellerSkuNames||[])].some(value=>text(value).toLocaleLowerCase().includes(term)));
  }
  function hasNumericCondition(condition){return !!condition&&(text(condition.min)!==''||text(condition.max)!==''||condition.includeMissing===true);}
  function hasDateCondition(condition){return !!condition&&(text(condition.from)!==''||text(condition.to)!=='');}
  function isFilterActive(key,condition){return UNIFIED_FILTER_META[key]?.type==='choice'?Array.isArray(condition):UNIFIED_FILTER_META[key]?.type==='number'?hasNumericCondition(condition):hasDateCondition(condition);}
  function numericPass(value,condition){
    if(!hasNumericCondition(condition))return true;
    if(value===null)return condition.includeMissing===true;
    const min=numeric(condition.min),max=numeric(condition.max),op=condition.op||'between';
    if(op==='eq')return min===null?true:value===min;
    if(op==='gt')return min===null?true:value>min;
    if(op==='lt')return max===null?true:value<max;
    return (min===null||value>=min)&&(max===null||value<=max);
  }
  function datePass(value,condition){
    if(!hasDateCondition(condition))return true;
    const current=text(value);if(!current)return false;
    // Excel month values use YYYY-MM while live snapshots use YYYY-MM-DD.
    // Treat a month as its whole calendar range so a date-range filter does
    // not accidentally exclude an otherwise matching accounting month.
    const monthOnly=/^\d{4}-\d{2}$/.test(current);
    const first=monthOnly?`${current}-01`:current;
    const last=monthOnly?`${current}-31`:current;
    return (!condition.from||last>=condition.from)&&(!condition.to||first<=condition.to);
  }
  function unifiedRows(excludedKey=''){
    const filters=ui.unifiedFilters||{};
    return unifiedBaseRows().filter(row=>Object.entries(filters).every(([key,condition])=>{
      if(key===excludedKey||!UNIFIED_FILTER_META[key]||!isFilterActive(key,condition))return true;
      if(UNIFIED_FILTER_META[key]?.type==='choice')return condition.includes(String(unifiedColumnValue(row,key)))||(key==='source'&&row.source==='overseas'&&condition.includes('excel:*'));
      if(UNIFIED_FILTER_META[key]?.type==='number')return numericPass(numeric(row[key]),condition);
      return datePass(unifiedColumnValue(row,key),condition);
    }));
  }
  function unifiedFacetValues(key){return [...new Set(unifiedRows(key).map(row=>String(unifiedColumnValue(row,key))))].sort(collator.compare);}
  function unifiedFilterCount(){return Object.entries(ui.unifiedFilters||{}).filter(([key,condition])=>UNIFIED_FILTER_META[key]&&isFilterActive(key,condition)).length;}
  function unifiedFilterCountForHeader(key){if(key==='platform')return ['platform','source'].filter(item=>isFilterActive(item,ui.unifiedFilters?.[item])).length;if(key==='seller')return ['seller','country'].filter(item=>isFilterActive(item,ui.unifiedFilters?.[item])).length;return isFilterActive(key,ui.unifiedFilters?.[key])?1:0;}
  function unifiedSortValue(row,key){return unifiedColumnValue(row,key);}
  function unifiedSorted(rows){
    const key=ui.unifiedSort,direction=ui.unifiedDirection;
    if(!key||!direction)return rows.slice();
    return rows.slice().sort((left,right)=>{
      const a=unifiedSortValue(left,key),b=unifiedSortValue(right,key),aMissing=a===null||a===undefined||a==='',bMissing=b===null||b===undefined||b==='';
      if(aMissing||bMissing)return aMissing===bMissing?collator.compare(left.key,right.key):aMissing?1:-1;
      const result=typeof a==='number'&&typeof b==='number'?a-b:collator.compare(String(a),String(b));
      return result*direction||collator.compare(left.key,right.key);
    });
  }
  function sortInitialDirection(key){return UNIFIED_TEXT_SORTS.has(key)?1:-1;}
  function cycleUnifiedSort(key){if(ui.unifiedSort!==key){ui.unifiedSort=key;ui.unifiedDirection=sortInitialDirection(key);}else if(ui.unifiedDirection===sortInitialDirection(key)){ui.unifiedDirection=-ui.unifiedDirection;}else{ui.unifiedSort='';ui.unifiedDirection=0;}ui.page=1;}
  function filterDraft(){return ui.unifiedFilterDraft||{};}
  function draftChoiceSelected(key,value){const selected=filterDraft()[key];return !Array.isArray(selected)||selected.includes(value);}
  function numericError(key,condition){if(!condition)return '';const min=numeric(condition.min),max=numeric(condition.max);return (condition.op||'between')==='between'&&min!==null&&max!==null&&min>max?`${UNIFIED_FILTER_META[key].label}的最小值不能大于最大值。`:'';}
  function dateError(condition){return condition?.from&&condition?.to&&condition.from>condition.to?'开始日期不能晚于结束日期。':'';}
  function unifiedDraftErrors(){return Object.entries(filterDraft()).map(([key,condition])=>UNIFIED_FILTER_META[key]?.type==='number'?numericError(key,condition):UNIFIED_FILTER_META[key]?.type==='date'?dateError(condition):'').filter(Boolean);}
  function svgIcon(name){const paths={search:'<circle cx="11" cy="11" r="6"></circle><path d="m20 20-4-4"></path>',filter:'<path d="M4 5h16l-6.2 7.2v5.3l-3.6 1.8v-7.1z"></path>',sort:'<path d="M8 5v14"></path><path d="m5 8 3-3 3 3"></path><path d="M16 19V5"></path><path d="m13 16 3 3 3-3"></path>',columns:'<rect x="4" y="5" width="16" height="14" rx="1"></rect><path d="M10 5v14M15 5v14"></path>',close:'<path d="m6 6 12 12M18 6 6 18"></path>',funnel:'<path d="M4 5h16l-6.2 7.2v5.3l-3.6 1.8v-7.1z"></path>',chevron:'<path d="m7 10 5 5 5-5"></path>'};return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]||''}</svg>`;}
  function unifiedScope(){
    const periods=(unified.monthly?.periods||[]).map(item=>typeof item==='object'?text(item.period):text(item)).filter(Boolean),selected=unifiedPeriod();
    return `<div class="iw-unified-scope"><span>数据范围：全部库存来源</span><label>Excel 月份 <select data-iw-unified-period aria-label="Excel 月度报表月份">${(periods.length?periods:[selected]).filter(Boolean).map(value=>`<option value="${escape(value)}"${value===selected?' selected':''}>${escape(value)}</option>`).join('')||'<option value="">读取中</option>'}</select></label><small>Excel 月份只影响月度账面记录。</small></div>`;
  }
  function unifiedChoiceEditor(key){
    const query=text(ui.unifiedFilterSearch?.[key]).toLocaleLowerCase(),values=unifiedFacetValues(key).filter(value=>!query||filterLabel(key,value).toLocaleLowerCase().includes(query)),selected=filterDraft()[key],chosen=Array.isArray(selected)?selected.length:unifiedFacetValues(key).length;
    return `<section class="iw-filter-field${ui.unifiedFilterFocus===key?' is-focused':''}"><header><h3>${escape(UNIFIED_FILTER_META[key].label)}</h3><span>${Array.isArray(selected)?`${number(chosen)} 项已选`:'未限定'}</span></header><label class="iw-filter-search"><span class="iw-visually-hidden">搜索${escape(UNIFIED_FILTER_META[key].label)}</span><i>${svgIcon('search')}</i><input type="search" data-iw-unified-filter-search="${escape(key)}" value="${escape(ui.unifiedFilterSearch?.[key]||'')}" placeholder="搜索${escape(UNIFIED_FILTER_META[key].label)}"></label><div class="iw-filter-field-actions"><button type="button" data-iw-draft-choice-action="all" data-iw-filter-key="${escape(key)}">全选</button><button type="button" data-iw-draft-choice-action="none" data-iw-filter-key="${escape(key)}">清空</button><button type="button" data-iw-draft-choice-action="reset" data-iw-filter-key="${escape(key)}">重置</button></div><div class="iw-filter-options">${values.length?values.map(value=>`<label><input type="checkbox" data-iw-draft-choice="${escape(key)}" value="${escape(value)}"${draftChoiceSelected(key,value)?' checked':''}><span>${escape(filterLabel(key,value))}</span></label>`).join(''):'<p>没有匹配的筛选值。</p>'}</div></section>`;
  }
  function unifiedNumberEditor(key){
    const condition=filterDraft()[key]||{op:'between',min:'',max:'',includeMissing:false},op=condition.op||'between',error=numericError(key,condition),first=op==='lt'?'':`<input type="number" inputmode="decimal" data-iw-draft-number="${escape(key)}" data-iw-number-bound="min" value="${escape(condition.min??'')}" placeholder="最小值" aria-label="${escape(UNIFIED_FILTER_META[key].label)}最小值">`,second=op==='eq'||op==='gt'?'':`<input type="number" inputmode="decimal" data-iw-draft-number="${escape(key)}" data-iw-number-bound="max" value="${escape(condition.max??'')}" placeholder="最大值" aria-label="${escape(UNIFIED_FILTER_META[key].label)}最大值">`;
    return `<section class="iw-filter-field iw-filter-number${ui.unifiedFilterFocus===key?' is-focused':''}"><header><h3>${escape(UNIFIED_FILTER_META[key].label)}</h3><button type="button" data-iw-draft-field-reset="${escape(key)}">重置</button></header><select data-iw-draft-number-op="${escape(key)}" aria-label="${escape(UNIFIED_FILTER_META[key].label)}条件"><option value="eq"${op==='eq'?' selected':''}>等于</option><option value="gt"${op==='gt'?' selected':''}>大于</option><option value="lt"${op==='lt'?' selected':''}>小于</option><option value="between"${op==='between'?' selected':''}>介于（包含边界）</option></select><div class="iw-number-range">${first}${first&&second?'<span>至</span>':''}${second}</div><label class="iw-missing-toggle"><input type="checkbox" data-iw-draft-number-missing="${escape(key)}"${condition.includeMissing?' checked':''}><span>包含缺失值</span><small>缺失值不等于 0</small></label>${error?`<p class="iw-filter-error" role="alert">${escape(error)}</p>`:''}</section>`;
  }
  function unifiedDateEditor(){const condition=filterDraft().dataDate||{from:'',to:''},error=dateError(condition);return `<section class="iw-filter-field iw-filter-date${ui.unifiedFilterFocus==='dataDate'?' is-focused':''}"><header><h3>快照 / 月份</h3><button type="button" data-iw-draft-field-reset="dataDate">重置</button></header><div class="iw-date-range"><label>开始<input type="date" data-iw-draft-date="from" value="${escape(condition.from||'')}"></label><label>结束<input type="date" data-iw-draft-date="to" value="${escape(condition.to||'')}"></label></div>${error?`<p class="iw-filter-error" role="alert">${escape(error)}</p>`:''}</section>`;}
  function unifiedFilterPanel(){
    if(!ui.unifiedFilterOpen)return '';
    const errors=unifiedDraftErrors(),valid=!errors.length;
    return `<section id="iw-unified-filter-panel" class="iw-unified-popover iw-unified-filter-panel" role="dialog" aria-modal="false" aria-label="筛选库存商品"><header><div><h3>筛选库存商品</h3><p>同字段多选取并集；不同字段条件取交集。</p></div><button type="button" class="iw-popover-close" data-iw-action="cancel-unified-filter" aria-label="关闭筛选">${svgIcon('close')}</button></header><div class="iw-filter-panel-grid"><section class="iw-filter-cluster iw-filter-cluster-scope"><header><h4>范围与预测状态</h4><p>Excel 月报按海外仓逐项选择；不再单独筛选店铺或平台仓。</p></header><div class="iw-filter-choice-grid">${['source','platform','country','forecastStatus','stockRisk'].map(unifiedChoiceEditor).join('')}</div></section><section class="iw-filter-cluster iw-filter-cluster-metrics"><header><h4>库存、销量与预测</h4><p>空白与真实 0 分开处理。</p></header><div class="iw-filter-number-grid">${['quantity','inTransit','unfulfillable','sales','forecastSellableDays'].map(unifiedNumberEditor).join('')}${unifiedDateEditor()}</div></section></div><footer><span>${errors.length?`请先修正 ${number(errors.length)} 个输入问题。`:'编辑中的条件尚未应用。'}</span><div><button type="button" class="iw-button-subtle" data-iw-action="cancel-unified-filter">取消</button><button type="button" class="iw-button" data-iw-action="apply-unified-filter"${valid?'':' disabled'}>应用筛选</button></div></footer></section>`;
  }
  function unifiedSortPanel(){
    if(!ui.unifiedSortOpen)return '';
    const draft=ui.unifiedSortDraft||{key:ui.unifiedSort||'quantity',direction:ui.unifiedDirection||-1},key=draft.key||'quantity',direction=Number(draft.direction)===1?1:-1;
    return `<section class="iw-unified-popover iw-unified-sort-panel" role="dialog" aria-modal="false" aria-label="排序设置"><header><div><h3>排序设置</h3><p>一次仅按一个字段排序，缺失值始终置后。</p></div><button type="button" class="iw-popover-close" data-iw-action="cancel-unified-sort" aria-label="关闭排序">${svgIcon('close')}</button></header><label>排序字段<select data-iw-unified-sort-draft="key">${UNIFIED_COLUMNS.filter(column=>column.sortable).map(column=>`<option value="${escape(column.key)}"${key===column.key?' selected':''}>${escape(column.label)}</option>`).join('')}</select></label><label>排序方向<select data-iw-unified-sort-draft="direction"><option value="1"${direction===1?' selected':''}>${UNIFIED_TEXT_SORTS.has(key)?'升序（A→Z）':'从低到高'}</option><option value="-1"${direction===-1?' selected':''}>${UNIFIED_TEXT_SORTS.has(key)?'降序（Z→A）':'从高到低'}</option></select></label><footer><button type="button" class="iw-button-subtle" data-iw-action="clear-unified-sort">取消排序</button><span></span><button type="button" class="iw-button-subtle" data-iw-action="cancel-unified-sort">取消</button><button type="button" class="iw-button" data-iw-action="apply-unified-sort">应用</button></footer></section>`;
  }
  function unifiedVisibleColumns(){return UNIFIED_COLUMNS.filter(column=>ui.unifiedColumns?.[column.key]!==false);}
  function unifiedColumnSettings(){if(!ui.unifiedColumnsOpen)return '';const visible=unifiedVisibleColumns();return `<section class="iw-unified-popover iw-unified-columns-panel" role="dialog" aria-modal="false" aria-label="列设置"><header><div><h3>列设置</h3><p>至少保留一列显示。</p></div><button type="button" class="iw-popover-close" data-iw-action="close-unified-columns" aria-label="关闭列设置">${svgIcon('close')}</button></header><div class="iw-column-settings-list">${UNIFIED_COLUMNS.map(column=>`<label><input type="checkbox" data-iw-unified-column="${escape(column.key)}"${ui.unifiedColumns?.[column.key]!==false?' checked':''}${column.key==='sku'&&visible.length===1?' disabled':''}><span>${escape(column.label)}</span></label>`).join('')}</div></section>`;}
  function filterTagText(key,condition){if(UNIFIED_FILTER_META[key].type==='choice'){const values=condition.map(value=>filterLabel(key,value));return `${UNIFIED_FILTER_META[key].label}：${values.slice(0,3).join('、')}${values.length>3?` 等${number(values.length)}项`:''}`;}if(UNIFIED_FILTER_META[key].type==='date')return `快照 / 月份：${condition.from||'最早'} 至 ${condition.to||'最新'}`;const unit=UNIFIED_FILTER_META[key].unit||'',op=condition.op||'between',min=text(condition.min),max=text(condition.max),base=op==='eq'?`等于 ${min}`:op==='gt'?`大于 ${min}`:op==='lt'?`小于 ${max}`:`${min||'不限'}–${max||'不限'}`;return `${UNIFIED_FILTER_META[key].label}：${base}${base&&unit?' '+unit:''}${condition.includeMissing?'（含缺失值）':''}`;}
  function unifiedAppliedTags(){const filters=Object.entries(ui.unifiedFilters||{}).filter(([key,condition])=>UNIFIED_FILTER_META[key]&&isFilterActive(key,condition));const sort=ui.unifiedSort&&ui.unifiedDirection?`<button type="button" class="iw-query-tag is-sort" data-iw-action="clear-unified-sort" aria-label="移除排序 ${escape(UNIFIED_COLUMNS.find(column=>column.key===ui.unifiedSort)?.label||'')}">${escape(UNIFIED_COLUMNS.find(column=>column.key===ui.unifiedSort)?.label||'')} ${ui.unifiedDirection===1?'↑':'↓'} <span aria-hidden="true">×</span></button>`:'';const keyword=ui.keyword?`<button type="button" class="iw-query-tag" data-iw-action="clear-unified-keyword">SKU / 品名：${escape(ui.keyword)} <span aria-hidden="true">×</span></button>`:'';if(!filters.length&&!sort&&!keyword)return '';return `<div class="iw-unified-tags" aria-label="已应用的查询条件">${keyword}${filters.map(([key,condition])=>`<button type="button" class="iw-query-tag" data-iw-remove-unified-filter="${escape(key)}" aria-label="删除筛选 ${escape(filterTagText(key,condition))}">${escape(filterTagText(key,condition))} <span aria-hidden="true">×</span></button>`).join('')}${sort}${filters.length?'<button type="button" class="iw-clear-filters" data-iw-action="clear-unified-filters">清空筛选</button>':''}</div>`;}
  function unifiedToolbar(all,rows){const filters=unifiedFilterCount(),sort=ui.unifiedSort&&ui.unifiedDirection;return `<div class="iw-unified-toolbar"><div class="iw-unified-toolbar-main"><label class="iw-unified-keyword"><span class="iw-visually-hidden">搜索 SKU 或品名</span><i>${svgIcon('search')}</i><input type="search" data-iw-unified-keyword value="${escape(ui.keyword)}" placeholder="搜索主 SKU / 平台 SKU / 品名"></label><button type="button" class="iw-toolbar-button${ui.unifiedFilterOpen?' is-open':''}" data-iw-action="toggle-unified-filter" aria-expanded="${ui.unifiedFilterOpen}" aria-controls="iw-unified-filter-panel">${svgIcon('filter')}<span>筛选</span>${filters?`<b>${number(filters)}</b>`:''}</button><button type="button" class="iw-toolbar-button${ui.unifiedSortOpen?' is-open':''}" data-iw-action="toggle-unified-sort" aria-expanded="${ui.unifiedSortOpen}">${svgIcon('sort')}<span>排序</span>${sort?'<b>1</b>':''}</button></div><div class="iw-unified-toolbar-side"><span role="status">匹配 <b>${number(rows.length)}</b> / ${number(all.length)} 条</span><button type="button" class="iw-toolbar-button" data-iw-action="toggle-unified-columns" aria-expanded="${ui.unifiedColumnsOpen}">${svgIcon('columns')}<span>列设置</span></button></div>${unifiedFilterPanel()}${unifiedSortPanel()}${unifiedColumnSettings()}</div>${unifiedAppliedTags()}`;}
  function unifiedHead(column){
    const active=ui.unifiedSort===column.key&&ui.unifiedDirection,classes=`iw-unified-head${active?' is-sorted':''}${column.numeric?' iw-numeric':''}`,mark=active?(ui.unifiedDirection===1?'↑':'↓'):svgIcon('sort');
    return `<th scope="col" class="${classes}"${active?` aria-sort="${ui.unifiedDirection===1?'ascending':'descending'}"`:''}><div><button type="button" class="iw-unified-sort" data-iw-unified-sort="${escape(column.key)}" aria-label="按${escape(column.label)}排序：${active?(ui.unifiedDirection===1?'当前升序，再次点击降序':'当前降序，再次点击取消'):'首次点击排序'}" title="排序${escape(column.label)}"><span>${escape(column.label)}</span>${column.sortable?`<i class="iw-unified-sort-mark" aria-hidden="true">${mark}</i>`:''}</button></div></th>`;
  }
  function forecastStatusLabel(status){return ({READY_90D:'90天加权预测',READY_30D:'近30天预测',INVALID_STOCK:'库存负值待核对',NO_RECENT_SALES:'近30天无销量',SALES_SOURCE_UNAVAILABLE:'销量统计不可用',SALES_NOT_MATCHED:'销量未匹配',SALES_NOT_LINKED:'销量待接入',SHARED_WAREHOUSE:'共享仓独立库存'})[status]||'待核对';}
  function unifiedCell(row,column){
    if(column.key==='sku')return `<td><strong class="iw-sku">${escape(row.sku||'未标注 SKU')}</strong>${row.platformSku?`<small>${escape(row.platformSku)}</small>`:''}${row.sellerSkuNames?.length?`<small title="${escape(row.sellerSkuNames.join('、'))}">卖家 SKU ${number(row.sellerSkuNames.length)} 个</small>`:''}${row.name?`<span class="iw-product-name" title="${escape(row.name)}">${escape(row.name)}</span>`:''}${row.source==='amazon'?`<button type="button" class="iw-text-button" data-iw-drawer="${escape(row.key)}" aria-haspopup="dialog" aria-label="查看 ${escape(row.sku||row.platformSku||'商品')} 的卖家 SKU 库存明细">查看卖家 SKU 明细 →</button>`:''}</td>`;
    if(column.key==='platform')return `<td><strong>${escape(row.platform||'待确认')}</strong><small>${escape(unifiedSourceDetail(row))}</small></td>`;
    if(column.key==='seller')return `<td>${escape(row.seller||'—')}<small>${escape(row.sharedWarehouse?'独立共享仓 · 不分摊店铺':row.country||'未标注国家 / 区域')}</small></td>`;
    if(column.key==='warehouse')return `<td title="${escape(row.warehouse||'—')}">${escape(row.warehouse||'—')}</td>`;
    if(column.key==='quantity')return `<td class="iw-numeric"><b class="iw-number${numeric(row.quantity)!==null&&numeric(row.quantity)<0?' iw-invalid':''}">${number(row.quantity)}</b><small>${escape(row.stockLabel||'—')}</small></td>`;
    if(column.key==='forecastSellableDays')return `<td class="iw-numeric"><b class="iw-number">${numeric(row.forecastSellableDays)===null?'—':number(row.forecastSellableDays,1)+' 天'}</b><small>${escape(forecastStatusLabel(row.forecastStatus))}</small></td>`;
    if(column.key==='stockRisk'){const [label,tone]=liveRisk(row.stockRisk);return `<td><span class="iw-live-risk is-${tone}">${escape(label)}</span></td>`;}
    if(column.key==='estimatedStockoutDate')return `<td>${escape(row.estimatedStockoutDate&&row.estimatedStockoutDate!=='—'?row.estimatedStockoutDate:'—')}<small>${row.estimatedStockoutDate&&row.estimatedStockoutDate!=='—'?'按预测日销':'—'}</small></td>`;
    if(column.key==='forecastStatus')return `<td><strong>${escape(forecastStatusLabel(row.forecastStatus))}</strong><small>${escape(row.forecastMethod==='WEIGHTED_90D'?'50% / 30% / 20%':row.forecastMethod==='LAST_30D_FALLBACK'?'近30天销量兜底':'不以 0 补齐')}</small></td>`;
    if(column.key==='dataDate')return `<td>${escape(row.dataDate||'—')}<small>${escape(row.detail||'—')}</small></td>`;
    return `<td class="iw-numeric">${number(row[column.key])}</td>`;
  }
  function unifiedTable(rows){const columns=unifiedVisibleColumns();return `<div class="iw-table-scroll iw-unified-table" data-iw-scroll="unified"><table class="iw-table"><caption class="iw-visually-hidden">全部库存来源商品明细</caption><thead><tr>${columns.map(unifiedHead).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(column=>unifiedCell(row,column)).join('')}</tr>`).join('')}</tbody></table></div>`;}
  function unifiedEmpty(){return `<div class="iw-empty iw-unified-empty"><span class="iw-empty-icon" aria-hidden="true">⌕</span><h3>没有匹配的库存记录</h3><p>可调整 SKU / 品名搜索，或清除已应用的表格筛选条件后重试。</p><button type="button" class="iw-button" data-iw-action="reset-unified-query">清除筛选和搜索</button></div>`;}
  function unifiedExportRows(rows){return rows.map(row=>({'主SKU':row.sku,'平台SKU':row.platformSku,'品名':row.name,'平台':row.platform,'数据来源':sourceTitle(row.source),'库存范围':row.sharedWarehouse?'共享仓':'店铺/来源','店铺':row.sharedWarehouse?'':row.seller,'国家/区域':row.country,'平台仓':row.warehouse,'卖家SKU数':row.sellerSkuNames?.length??null,'卖家SKU明细':Array.isArray(row.raw?.sellerSkuDetails)?row.raw.sellerSkuDetails.map(item=>`${text(item.sellerSku)||'未标注'}：${number(item.fbaSellable)} 件`).join('；'):'','可售/账面数量（件）':row.quantity,'在途（件）':row.inTransit,'不可售（件）':row.unfulfillable,'预留（件）':row.reserved,'近30天销量（件）':row.sales,'预测日销（件）':row.forecastDailySales,'预测可售天数（天）':row.forecastSellableDays,'预计断货日':row.estimatedStockoutDate,'预测数据状态':forecastStatusLabel(row.forecastStatus),'预测方法':row.forecastMethod,'快照/月份':row.dataDate,'库存口径':row.stockLabel,'来源说明':row.detail}));}
  function unifiedDetails(){
    const all=allUnifiedRows(),rows=unifiedSorted(unifiedRows()),pagination=pager(rows.length),offset=ui.size===0?0:(ui.page-1)*ui.size,visible=ui.size===0?rows:rows.slice(offset,offset+ui.size),amazonIncomplete=presentData()&&snapshot('amazon').hasMore===true,errors=[unified.error,marketplace.error,amazonIncomplete?'Amazon 快照未完整返回，当前不能视为 Amazon 全量匹配结果。':presentData()?'':(context.state?.error||'Amazon 快照尚未读取')].filter(Boolean);
    return `<section class="iw-unified-details" aria-label="商品明细统一查询"><header class="iw-unified-heading"><div class="iw-unified-heading-copy"><span>商品明细 · 所有库存来源</span><h2>跨来源 SKU 查询</h2><p>同一个 SKU 的 Excel、Amazon 与领星实时库存分行展示，不合并数量。</p></div><div class="iw-unified-heading-tools">${unifiedScope()}</div></header>${errors.length?`<div class="iw-notice iw-notice-error" role="alert"><div><strong>部分来源尚未读取</strong><p>${escape(errors.join('；'))}</p></div><button type="button" class="iw-button" data-iw-action="reload-unified">重新读取</button></div>`:''}${unified.loading?'<div class="iw-empty" role="status"><span class="iw-loader" aria-hidden="true"></span><h3>正在读取各来源库存</h3><p>Excel 月度账面、Amazon 快照与领星实时库存会分别保留口径。</p></div>':`${unifiedToolbar(all,rows)}${rows.length?`${unifiedTable(visible)}${pagination}`:unifiedEmpty()}`}<p class="iw-unified-help">排序、筛选、匹配记录数和导出均基于全部已加载的匹配记录，表格分页不会改变其范围。查询结果是来源记录，不是跨平台合计；实时库存以各领星接口当前快照为准，Excel 保留所选月份原始账面值。</p></section>`;
  }
  function openUnifiedFilter(field=''){ui.unifiedFilterOpen=true;ui.unifiedSortOpen=false;ui.unifiedColumnsOpen=false;ui.unifiedFilterFocus=field;ui.unifiedFilterDraft=clone(ui.unifiedFilters);ui.unifiedFilterSearch={};}
  function closeUnifiedFilter(){ui.unifiedFilterOpen=false;ui.unifiedFilterFocus='';ui.unifiedFilterDraft=null;ui.unifiedFilterSearch={};}
  function setDraftChoice(key,value,checked){const draft=filterDraft(),all=unifiedFacetValues(key),selected=new Set(Array.isArray(draft[key])?draft[key]:all);if(checked)selected.add(value);else selected.delete(value);draft[key]=all.filter(item=>selected.has(item));ui.unifiedFilterDraft=draft;}
  function setDraftChoiceAction(key,action){const draft=filterDraft();if(action==='all'||action==='reset')delete draft[key];else if(action==='none')draft[key]=[];ui.unifiedFilterDraft=draft;}
  function setDraftNumber(key,patch){const draft=filterDraft(),current=draft[key]||{op:'between',min:'',max:'',includeMissing:false};draft[key]={...current,...patch};ui.unifiedFilterDraft=draft;}
  function setDraftDate(bound,value){const draft=filterDraft(),current=draft.dataDate||{from:'',to:''};draft.dataDate={...current,[bound]:value};ui.unifiedFilterDraft=draft;}
  function applyUnifiedFilter(){if(unifiedDraftErrors().length)return;ui.unifiedFilters=clone(filterDraft());closeUnifiedFilter();ui.page=1;}
  function openUnifiedSort(){ui.unifiedSortOpen=true;ui.unifiedFilterOpen=false;ui.unifiedColumnsOpen=false;ui.unifiedSortDraft={key:ui.unifiedSort||'quantity',direction:ui.unifiedDirection||-1};}
  function closeUnifiedSort(){ui.unifiedSortOpen=false;ui.unifiedSortDraft=null;}
  function applyUnifiedSort(){const draft=ui.unifiedSortDraft||{};ui.unifiedSort=draft.key||'';ui.unifiedDirection=Number(draft.direction)===1?1:-1;closeUnifiedSort();ui.page=1;}
  async function loadUnified(force=false){
    const currentPeriod=unifiedPeriod();
    if(unified.loading||(!force&&unified.monthly&&(!ui.unifiedPeriod||unified.monthly.period===currentPeriod)))return;
    const monthlyLoader=window.OverseasInventory?.loadAllDetails,liveLoader=window.MarketplaceInventory?.load;
    if(typeof monthlyLoader!=='function'){unified.error='月度库存接口文件未完整加载，请刷新页面。';repaint();return;}
    if(typeof liveLoader!=='function'){unified.error='实时库存接口文件未完整加载，请刷新页面。';repaint();return;}
    const request=++unified.request;unified={...unified,loading:true,error:''};repaint();
    const [monthlyResult,liveResult]=await Promise.allSettled([monthlyLoader({period:ui.unifiedPeriod}),liveLoader()]);
    if(request!==unified.request)return;
    const errors=[];
    if(monthlyResult.status==='fulfilled')unified={...unified,monthly:monthlyResult.value};else errors.push(text(monthlyResult.reason?.message)||'Excel 月度账面库存读取失败');
    if(liveResult.status==='fulfilled')marketplace={...marketplace,data:liveResult.value||{},loading:false,error:''};else errors.push(text(liveResult.reason?.message)||'领星实时库存读取失败');
    unified={...unified,loading:false,error:errors.join('；')};repaint();
  }
  // Each source retains its own stock definition; quantities are never combined across sources.
  const SUMMARY_METRICS = {
    amazon:[
      {key:'fbaSellable',label:'FBA 可售'},
      {key:'fbmAvailable',label:'FBM 可用'},
      {key:'inbound',label:'入库中'},
      {key:'reserved',label:'预留库存'},
      {key:'unsellable',label:'不可售'},
      {key:'lowStockCount',label:'低库存商品',hint:'0 ≤ 预测可售天数 < 14',risk:true,count:'low'},
      {key:'overstockCount',label:'高库存商品',hint:'预测可售天数 ≥ 90',risk:true,count:'high'}
    ]
  };
  function hasDetailFilters(){return ui.seller!=='all'||ui.country!=='all'||ui.keyword.trim()!=='';}
  function sourceInScope(id){
    if(ui.source!=='all'&&ui.source!==id)return false;
    if(ui.warehouse!=='all'&&ui.warehouse!==id)return false;
    const platform=SOURCE_NAMES[id];
    return ui.platform==='all'||ui.platform===platform;
  }
  function completeSource(id){
    const snap=snapshot(id),total=numeric(snap.total),loaded=records.filter(row=>row.source===id).length;
    return snap.hasMore!==true&&(total!==null?loaded>=total:snap.hasMore===false);
  }
  function aggregateMetric(rows,metric){
    if(metric.count){
      const days=rows.map(row=>numeric(row.forecastSellableDays)).filter(value=>value!==null&&value>=0);
      return {value:days.length?days.filter(value=>metric.count==='low'?value<14:value>=90).length:null,missing:rows.length-days.length};
    }
    const values=rows.map(row=>numeric(row.raw[metric.key])).filter(value=>value!==null);
    return {value:values.length?values.reduce((sum,value)=>sum+value,0):null,missing:rows.length-values.length};
  }
  function inventorySummary(){
    if(pending()||!presentData())return '';
    const narrowed=hasDetailFilters(),matches=filtered();
    const ids=['amazon'].filter(id=>sourceInScope(id)&&snapshot(id).supported!==false&&(!narrowed||matches.some(row=>row.source===id)));
    if(!ids.length)return '';
    return `<section class="iw-overview iw-live-overview" aria-label="实时库存概览"><div class="iw-live-overview-heading"><div><h3>实时库存快照</h3><p>与 Excel 月度账面库存分别展示，不合并数量。</p></div></div><div class="iw-live-source-grid">${ids.map(id=>{
      const snap=snapshot(id),rows=matches.filter(row=>row.source===id),stats=snap.summary||{},complete=completeSource(id);
      const metrics=SUMMARY_METRICS[id].map(metric=>{
        const native=numeric(stats[metric.key]);
        // Source-only switches keep the full snapshot totals. Row filters aggregate before paging.
        const result=!narrowed&&native!==null?{value:native,missing:0,native:true}:aggregateMetric(rows,metric);
        return {...metric,...result};
      });
      const usesRows=metrics.some(metric=>!metric.native),partial=usesRows&&!complete;
      const missing=metrics.some(metric=>!metric.count&&metric.missing>0);
       const unknownDays=id==='amazon'&&rows.filter(row=>numeric(row.forecastSellableDays)===null).length;
      const scope=narrowed?(complete?'当前筛选汇总':'已加载匹配记录汇总'):partial?'来源汇总 · 部分指标仅含已加载记录':'全部商品汇总';
      const notes=[];
      if(partial)notes.push('明细尚未完整加载，按明细计算的指标仅含已加载记录');
      if(missing)notes.push('部分库存字段缺失，对应合计仅含有值记录');
       if(unknownDays>0)notes.push(`${number(unknownDays)} 条商品预测可售天数未知，未纳入低、高库存数`);
      const metric=key=>metrics.find(item=>item.key===key)||{};
      const fba=metric('fbaSellable'),fbm=metric('fbmAvailable'),inbound=metric('inbound'),reserved=metric('reserved'),unsellable=metric('unsellable'),low=metric('lowStockCount'),high=metric('overstockCount');
      const sharedRows=rows.filter(row=>row.sharedWarehouse),sharedQuantity=!narrowed?numeric(stats.sharedFbaSellable):aggregateMetric(sharedRows,{key:'fbaSellable'}).value;
      const sharedCount=!narrowed?numeric(stats.sharedProductCount):sharedRows.length;
      return `<article class="iw-live-platform-card"><header><h4>${escape(SOURCE_NAMES[id])}</h4><span>API 快照</span></header><div class="iw-live-primary"><span>FBA 可售</span><strong>${number(fba.value)}<em>件</em></strong><small>快照 ${escape(date(snap.dataDate||snap.snapshotDate))} · ${escape(scope)}</small></div><dl class="iw-live-pairs"><div><dt>FBM 可用</dt><dd>${number(fbm.value)}<em>件</em></dd></div><div><dt>在途 / 入库中</dt><dd>${number(inbound.value)}<em>件</em></dd></div></dl><dl class="iw-live-pairs iw-live-status"><div><dt>预留库存</dt><dd>${number(reserved.value)}<em>件</em></dd></div><div><dt>不可售</dt><dd>${number(unsellable.value)}<em>件</em></dd></div></dl><footer><span>商品记录 ${count(rows.length,'条')} · 共享仓 ${count(sharedQuantity,'件')} / ${count(sharedCount,'条商品')} · 低库存 ${count(low.value,'条')} · 高库存 ${count(high.value,'条')}</span>${overview()?`<button type="button" class="iw-text-button" data-iw-source="${id}">查看库存明细 ↗</button>`:''}${notes.length?`<small>${escape(notes.join('；'))}。</small>`:''}</footer></article>`;
    }).join('')}</div></section>`;
  }
  function sourceSummary(){
    if(pending())return '';
    const ids=['amazon'].filter(sourceInScope);
    return `<details class="iw-source-info" data-iw-disclosure="infoOpen"${ui.infoOpen?' open':''}><summary>来源信息与统计口径</summary><div class="iw-source-info-body"><div class="iw-source-summaries">${ids.map(id=>`<section class="iw-source-summary"><div class="iw-source-summary-head"><strong>${escape(SOURCE_NAMES[id])}</strong><span>快照日期 ${escape(date(snapshot(id).dataDate||snapshot(id).snapshotDate))}</span></div><p>${escape(sourceCoverage(id))}</p></section>`).join('')}</div><p>${escape(snapshot('amazon').sourceApi?'Amazon 库存来自最近一次领星 FBA v2 完整同步；页面所选日期仅作用于销量':(context.scopeLabel||'使用所选结束日期之前的最近可用库存快照'))}。各来源库存独立展示；来源明细页的汇总随筛选变化，翻页不影响合计。</p><p>Amazon 商品行汇总同店铺、同 SKU、同 ASIN 的卖家 SKU 来源记录；共享仓单列，不分摊店铺或关联店铺销量。Amazon 可售为 FBA，FBM 单列；占用为预留，不可售为 FBA 不可售，在途 / 入库中包含计划入库、在途和接收中，实际在途另存且不重复相加。</p><p>低、高库存按店铺、站点、SKU 和 ASIN 的商品记录计数，仅纳入有预测可售天数的 Amazon 商品。日均销量按近30天已记录销量 ÷ 有记录天数计算。相同 SKU 暂按名称归组，跨来源数量不合并；筛选和“全部”作用于已加载记录，未提供的值显示“—”。</p></div></details>`;
  }
  function filters(){
    const rows=sourceRecords(),disabled=pending();
    const platforms=[['Amazon','Amazon']];
    const warehouses=[...new Set(rows.map(row=>row.warehouse))].map(value=>[value,`${SOURCE_NAMES[value]} · 仓库未细分`]);
    const sortOptions=ui.view==='summary'?[['sku','SKU'],['sources','库存来源数'],['count','来源记录数']]:[['sku','SKU'],['seller','店铺'],['country','国家'],['warehouse','仓库'],['available','FBA 可售'],['fbm','FBM 可用'],['occupied','占用'],['unsellable','不可售'],['inbound','在途'],['daily','近30天日均销量'],['dataDate','快照日期']];
    const activeRisk=ui.source==='amazon'&&ui.riskFilter!=='all'?`<div class="iw-active-risk">当前筛选：${escape(riskLabel(ui.riskFilter)||'库存条件')}<button type="button" data-iw-action="clear-risk">清除条件</button></div>`:'';
    return `<div class="iw-filters"><label class="iw-filter iw-filter-search"><span>商品</span><input type="search" data-iw-filter="keyword" value="${escape(ui.keyword)}" placeholder="搜索 SKU / ASIN / 品名" aria-label="搜索商品"${disabled?' disabled':''}></label>${selectFilter('seller','店铺',distinct(rows,'seller','未关联店铺'),'全部店铺',disabled)}${selectFilter('country','国家 / 地区',distinct(rows,'country','未标注国家'),'全部国家',disabled)}${selectFilter('warehouse','仓库',warehouses,'全部仓库',disabled)}<div class="iw-filter-actions"><details class="iw-more-filters" data-iw-disclosure="moreOpen"${ui.moreOpen?' open':''}><summary>更多${ui.platform!=='all'&&ui.source!=='amazon'?' · 1':''}</summary><div class="iw-more-body">${selectFilter('platform','平台',platforms,'全部平台')}<label class="iw-filter"><span>排序</span><select data-iw-order aria-label="库存排序">${sortOptions.map(([key,label])=>`<option value="${key}"${ui.sort===key?' selected':''}>${label}</option>`).join('')}</select></label><button type="button" class="iw-text-button" data-iw-action="direction">${ui.direction===1?'升序 ↑':'降序 ↓'}</button></div></details><button type="button" class="iw-text-button" data-iw-action="reset">重置</button></div></div>${activeRisk}`;
  }
  function stateNotice(){
    if(pending())return '';
    const state=context.state||{};
    if(state.phase==='error'||state.error){const error=text(state.error)||'库存数据暂时未能读取，请稍后重试。';const auth=/401|认证|登录|登陆/.test(error);return `<div class="iw-notice iw-notice-error" role="alert"><div><strong>${auth?'登录状态需要更新':'本次库存读取失败'}</strong><p>${escape(auth?'请重新登录系统后再读取库存。':error.slice(0,280))}${records.length?' 当前保留已加载快照。':''}</p></div><button type="button" class="iw-button" data-iw-action="retry">重新读取</button></div>`;}
    if(state.refreshing===true||state.phase==='refreshing'||(presentData()&&state.phase==='loading'))return '<div class="iw-notice" role="status">正在更新库存快照，当前明细仍可查看。</div>';
    return '';
  }
  function pendingState(){return '';}
  function sortLabel(label){return escape(label).replace(/\n/g,'<br>');}
  function sortHead(label,key,extra=''){const active=ui.sort===key;return `<th scope="col" class="${extra}" aria-sort="${active?(ui.direction===1?'ascending':'descending'):'none'}"><button type="button" data-iw-sort="${key}"><span class="iw-sort-label">${sortLabel(label)}</span><span aria-hidden="true">${active?(ui.direction===1?'↑':'↓'):'↕'}</span></button></th>`;}
  function amount(value,label,digits=0){return `<b class="iw-number">${number(value,digits)}</b>${label?`<small>${escape(label)}</small>`:''}`;}
  function identity(row){return `<strong class="iw-sku">${escape(row.sku||row.asin||'未标注 SKU')}</strong>${row.sharedWarehouse?'<small>共享仓 · 独立库存</small>':''}${row.sellerSkuNames?.length?`<small>卖家 SKU ${number(row.sellerSkuNames.length)} 个</small>`:''}${row.name?`<span class="iw-product-name" title="${escape(row.name)}">${escape(row.name)}</span>`:''}`;}
  function availableCell(row){return `<div class="iw-dual-stock"><span><small>FBA</small><b>${number(row.available)}</b></span><span><small>FBM</small><b>${number(row.fbm)}</b></span></div>`;}
  function dailyCell(row){return `${amount(row.daily,'',2)}${row.observed>0&&row.observed<30?`<small class="iw-coverage" title="按有记录的 ${number(row.observed)} 天计算日均销量">${number(row.observed)} 天记录</small>`:''}`;}
  function field(label,value){return `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;}
  function sellerSkuSourceRows(row){
    const details=Array.isArray(row.sellerSkuDetails)?row.sellerSkuDetails:[];
    if(!details.length)return '';
    return `<section class="iw-drawer-block"><h3>卖家 SKU 来源明细 · ${number(details.length)} 条</h3><p>下表为本商品汇总的原始库存行；可售合计为 ${number(row.available)} 件，销量和预测仅在商品层计算一次。共享仓保持独立，不分摊给店铺。</p><div class="iw-table-scroll"><table class="iw-table"><caption class="iw-visually-hidden">卖家 SKU 来源库存</caption><thead><tr><th scope="col">卖家 SKU</th><th scope="col">FNSKU</th><th scope="col">源仓库</th><th scope="col" class="iw-numeric">FBA 可售</th><th scope="col" class="iw-numeric">在途 / 入库中</th></tr></thead><tbody>${details.map(item=>`<tr><td>${escape(text(item.sellerSku)||'未标注')}</td><td>${escape(text(item.fnsku)||'—')}</td><td>${escape(text(item.warehouseName)||'—')}</td><td class="iw-numeric">${number(item.fbaSellable)}</td><td class="iw-numeric">${number(item.inbound)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function recordDetails(row){
    const raw=row.raw,snap=snapshot(row.source),days=numeric(row.forecastSellableDays),fbmDays=numeric(raw.fbmAvailableDays);
    const fields=[['FBA 可售',number(row.available)],['FBM 可用',number(row.fbm)],['FBA 预留',number(row.occupied)],['FBA 不可售',number(row.unsellable)],['FBA 入库中',number(row.inbound)],['预测可售天数',days!==null?`${number(days,1)} 天`:'—'],['预测日销',number(row.forecastDailySales,2)],['预测状态',forecastStatusLabel(row.forecastStatus)],['FBM 可用天数',fbmDays>0?`${number(fbmDays)} 天`:'待核查'],['近30天销量',number(row.sales)],['有销量记录的天数',row.observed>0?`${number(row.observed)} 天`:'—']];
    const identityFields=[['SKU',row.sku||'—'],['ASIN',row.asin||'—'],['平台',row.platform],['店铺',row.seller||'—'],['站点',row.country||'—']];
    return `<div class="iw-record-details"><div class="iw-detail-heading"><strong>${escape(SOURCE_NAMES[row.source])} · 来源字段</strong><span>快照日期 ${escape(row.dataDate)}</span></div><dl>${[...identityFields,...fields].map(([label,value])=>field(label,value)).join('')}</dl><p>日均销量 = ${escape(snap.salesWindowStart&&snap.salesWindowEnd?`${date(snap.salesWindowStart)} 至 ${date(snap.salesWindowEnd)}的`:'近30天')}已记录销量 ÷ 有记录天数；缺失日期不补零。${snap.salesStatsAvailable===false?escape(snap.salesStatsMessage||'近30天销量统计暂未读取。'):''} ${row.physicalWarehouses?`源仓库：${escape(row.physicalWarehouses)}。`:'源仓库未提供。'}</p></div>`;
  }
  function liveProductDrawer(){
    const report=liveReport(ui.drawerSource),rows=Array.isArray(report?.rows)?report.rows:[],row=rows[Number(ui.drawerKey)];
    if(!row)return '';
    const title=SOURCE_NAMES[ui.drawerSource]||'实时平台仓',sales=report?.sales||{},[riskText]=liveRisk(row.stockRisk),updated=date(report?.updatedAt||report?.sourceSyncAt);
    const sourceFields=[['数据来源',title],['快照时间',updated],['销量窗口',sales.windowEnd?`截至 ${date(sales.windowEnd)} · 近${number(sales.windowDays||30)}天`:'销量窗口未提供'],['预测方法',row.forecastMethod==='WEIGHTED_90D'?'90天加权（50% / 30% / 20%）':forecastStatusLabel(row.forecastStatus)],['预计断货日',date(row.estimatedStockoutDate)],['平台仓',(row.warehouses||[]).join('、')||'—'],['内部 SKU',row.sku||'—'],['库存风险',riskText]];
    return `<div class="iw-drawer-layer" role="presentation"><button type="button" class="iw-drawer-scrim" data-iw-action="close-drawer" aria-label="关闭商品详情"></button><aside class="iw-product-drawer" role="dialog" aria-modal="true" aria-label="${escape(row.sku||'商品')}库存详情"><header><div><span>实时商品明细</span><h2>SKU：${escape(row.sku||'—')}</h2><p>${escape(title)} · 当前接口快照</p></div><button type="button" class="iw-drawer-close" data-iw-action="close-drawer" aria-label="关闭">×</button></header><div class="iw-drawer-tabs"><b>库存与销量</b><span>来源与口径</span></div><dl class="iw-drawer-metrics"><div><dt>可售</dt><dd>${number(row.sellable)}<em>件</em></dd></div><div><dt>近30天销量</dt><dd>${number(row.sales30d)}<em>件</em></dd></div><div><dt>预测可售天数</dt><dd>${liveDays(row.forecastSellableDays)}</dd></div><div><dt>在途</dt><dd>${number(row.inTransit)}<em>件</em></dd></div></dl><section class="iw-drawer-block"><h3>库存构成与预测</h3><dl>${[['预测日销（件）',number(row.forecastDailySales,2)],['不可售（件）',number(row.unfulfillable)],['预留（件）',number(row.reserved)],['含在途预测天数',liveDays(row.forecastWithInboundDays)],['库存状态',riskText]].map(([label,value])=>field(label,value)).join('')}</dl></section><section class="iw-drawer-block"><h3>来源与口径</h3><dl>${sourceFields.map(([label,value])=>field(label,value)).join('')}</dl><p>${escape(report?.quantitySemantics||'库存字段按接口快照原样展示。')} 未唯一配对的来源记录不会被并入此 SKU 汇总。</p></section><div class="iw-drawer-alert">${riskText==='已缺货'||/缺货风险/.test(riskText)?'该记录处于缺货关注范围，请结合在途到货和采购周期进一步核查。':riskText==='近30天无有效销量'||riskText==='销量待接入'?'销量无法支持覆盖判断，不据此给出确定的补货结论。':'当前未触发缺货关注规则。'}</div><details class="iw-drawer-raw"><summary>查看原始记录</summary><pre>${escape(JSON.stringify(row,null,2))}</pre></details><footer><button type="button" class="iw-button" data-iw-action="close-drawer">返回清单</button></footer></aside></div>`;
  }
  function productDrawer(){
    if(!ui.drawerKey)return '';
    if(ui.drawerSource&&ui.drawerSource!=='amazon')return liveProductDrawer();
    const row=records.find(item=>item.key===ui.drawerKey);
    if(!row)return '';
    const snap=snapshot(row.source),days=numeric(row.forecastSellableDays),salesRange=snap.salesWindowStart&&snap.salesWindowEnd?`${date(snap.salesWindowStart)} 至 ${date(snap.salesWindowEnd)}`:'近30天';
    const sourceFields=[['快照日期',row.dataDate],['销量窗口',salesRange],['来源',SOURCE_NAMES[row.source]],['店铺',row.seller||'—'],['站点',row.country||'—'],['平台 SKU / ASIN',row.asin||'—'],['源仓库',row.physicalWarehouses||'—'],['产品线','待归类'],['领星分类（非产品线）',row.raw.categoryText||'—'],['库存来源接口',snap.sourceApi||'amazon_product_stats'],['同步批次',snap.snapshotBatchId||'—'],['同步时间（UTC）',text(snap.snapshotAtUtc)||'—']];
    return `<div class="iw-drawer-layer" role="presentation"><button type="button" class="iw-drawer-scrim" data-iw-action="close-drawer" aria-label="关闭商品详情"></button><aside class="iw-product-drawer" role="dialog" aria-modal="true" aria-label="${escape(row.sku||row.asin||'商品')}库存详情"><header><div><span>商品明细</span><h2>SKU：${escape(row.sku||row.asin||'—')}</h2>${row.name?`<p title="${escape(row.name)}">${escape(row.name)}</p>`:''}</div><button type="button" class="iw-drawer-close" data-iw-action="close-drawer" aria-label="关闭">×</button></header><div class="iw-drawer-tabs"><b>库存与销量</b><span>来源与口径</span></div><dl class="iw-drawer-metrics"><div><dt>FBA 可售</dt><dd>${number(row.available)}<em>件</em></dd></div><div><dt>近30天销量</dt><dd>${number(row.sales)}<em>件</em></dd></div><div><dt>预测可售天数</dt><dd>${days!==null?number(days,1)+' 天':'—'}</dd></div><div><dt>入库中</dt><dd>${number(row.inbound)}<em>件</em></dd></div></dl><section class="iw-drawer-block"><h3>库存构成与预测</h3><dl>${[['预测日销（件）',number(row.forecastDailySales,2)],['预计断货日',row.estimatedStockoutDate||'—'],['FBM 可用（件）',number(row.fbm)],['FBA 预留（件）',number(row.occupied)],['FBA 不可售（件）',number(row.unsellable)],['有销量记录天数',row.observed>0?number(row.observed)+' 天':'—']].map(([label,value])=>field(label,value)).join('')}</dl></section>${sellerSkuSourceRows(row)}<section class="iw-drawer-block"><h3>来源与口径</h3><dl>${sourceFields.map(([label,value])=>field(label,value)).join('')}</dl><p>按 ${escape(salesRange)} 的已记录销量 ÷ 有记录天数推算日销；Amazon 当前仅有该近30天窗口，已明确按近30天预测，缺失日期不补零。</p></section><div class="iw-drawer-alert">${days!==null&&days<14?'预测覆盖不足14天，建议结合在途与采购周期优先核查。':days===null?'销量不足以推算覆盖，不将其判定为缺货或积压。':'当前未触发预测缺货关注规则。'}</div><details class="iw-drawer-raw"><summary>查看原始记录</summary><pre>${escape(JSON.stringify(row.raw,null,2))}</pre></details><footer><button type="button" class="iw-button" data-iw-action="close-drawer">返回清单</button></footer></aside></div>`;
  }
  function detailRow(row){return `<tr class="iw-stock-row"><td>${identity(row)}</td><td><span class="iw-store">${escape(row.seller||'—')}</span>${row.country?`<small>${escape(row.country)}</small>`:''}</td><td><span>${escape(SOURCE_NAMES[row.source])}</span><small>${escape(row.warehouseLabel||'源仓库未提供')}</small></td><td class="iw-numeric">${availableCell(row)}</td><td class="iw-numeric" title="FBA 预留">${amount(row.occupied)}</td><td class="iw-numeric" title="FBA 不可售">${amount(row.unsellable)}</td><td class="iw-numeric" title="FBA 入库中">${amount(row.inbound)}</td><td class="iw-numeric">${dailyCell(row)}</td><td><button type="button" class="iw-text-button" data-iw-drawer="${escape(row.key)}" aria-haspopup="dialog" aria-label="查看${escape(row.sku||row.asin||'商品')}库存详情">查看</button></td></tr>`;}
  function detailTable(rows,nested=false){const head=(label,key,extra='')=>nested?`<th scope="col" class="${extra}">${sortLabel(label)}</th>`:sortHead(label,key,extra);return `<table class="iw-table${nested?' iw-table-nested':''}"><caption class="iw-visually-hidden">${nested?'同 SKU 来源库存明细':'库存明细'}</caption><thead><tr>${head('SKU / 品名','sku','iw-col-product')}${head('店铺 / 站点','seller','iw-col-store')}${head('仓库 / 来源','warehouse','iw-col-warehouse')}${head('可售/可用','available','iw-numeric iw-col-available')}${head('占用','occupied','iw-numeric iw-col-count')}${head('不可售','unsellable','iw-numeric iw-col-count')}${head('在途','inbound','iw-numeric iw-col-count')}${head('近30天\n日均销量','daily','iw-numeric iw-col-daily')}<th scope="col" class="iw-col-more">更多</th></tr></thead><tbody>${rows.map(row=>detailRow(row)).join('')}</tbody></table>`;}
  function groupedTable(items){return `<table class="iw-table iw-group-table"><caption class="iw-visually-hidden">按同名 SKU 查看来源记录</caption><thead><tr>${sortHead('SKU / 品名','sku')}${sortHead('库存来源','sources')}${sortHead('来源记录','count')}<th scope="col">对应关系</th><th scope="col">查看库存</th></tr></thead><tbody>${items.map(group=>{const open=ui.groups.has(group.key),multiple=group.rows.length>1;return `<tr><td><strong class="iw-sku">${escape(group.sku||'未标注 SKU')}</strong>${group.name?`<span class="iw-product-name">${escape(group.name)}</span>`:''}</td><td>${[...new Set(group.rows.map(row=>SOURCE_NAMES[row.source]))].map(value=>`<span class="iw-source-chip">${escape(value)}</span>`).join('')}</td><td><b class="iw-number">${number(group.count)}</b> 条</td><td><span class="iw-mapping-label">${multiple?'同名 SKU · 待确认对应':'单条来源记录'}</span><small>${multiple?'展开分别查看，不合并数量':'保留来源库存口径'}</small></td><td><button type="button" class="iw-text-button" data-iw-group="${escape(group.key)}" aria-expanded="${open}">${open?'收起记录':'展开记录'} <span aria-hidden="true">${open?'−':'+'}</span></button></td></tr>${open?`<tr class="iw-expanded-row"><td colspan="5"><div class="iw-group-caption">${escape(group.sku||'未标注 SKU')} · ${multiple?'SKU 名称相同，跨店铺及跨来源对应关系尚未确认。':'此商品当前仅有一条来源记录。'} 库存数量分别展示。</div><div class="iw-nested-scroll" data-iw-scroll="group:${escape(group.key)}">${detailTable(group.rows,true)}</div></td></tr>`:''}`;}).join('')}</tbody></table>`;}
  function pager(total){const pages=ui.size===0?1:Math.max(1,Math.ceil(total/ui.size));ui.page=Math.min(Math.max(1,ui.page),pages);const start=total?(ui.size===0?1:(ui.page-1)*ui.size+1):0,end=ui.size===0?total:Math.min(total,ui.page*ui.size);return `<footer class="iw-pagination"><span role="status">共 ${number(total)} ${ui.view==='summary'?'组 SKU':'条匹配记录'}${total?` · ${number(start)}–${number(end)}`:''}</span><label>显示 <select data-iw-size aria-label="每页显示数量">${[[50,'50 条'],[100,'100 条'],[0,'全部已加载']].map(([value,label])=>`<option value="${value}"${ui.size===value?' selected':''}>${label}</option>`).join('')}</select></label><button type="button" class="iw-page-button" data-iw-action="prev" aria-label="上一页"${ui.page<=1?' disabled':''}>‹</button><span>${number(ui.page)} / ${number(pages)}</span><button type="button" class="iw-page-button" data-iw-action="next" aria-label="下一页"${ui.page>=pages?' disabled':''}>›</button></footer>`;}
  function content(){
    if(pending())return pendingState();
    if(loading())return '<div class="iw-empty" role="status"><span class="iw-loader" aria-hidden="true"></span><h3>正在读取库存快照</h3><p>库存明细返回后会显示在这里。</p></div>';
    const rows=filtered(),items=ui.view==='summary'?groups(rows):sorted(rows),pagination=pager(items.length),offset=ui.size===0?0:(ui.page-1)*ui.size,visible=ui.size===0?items:items.slice(offset,offset+ui.size);
    if(!visible.length){let message=records.length?'调整平台、店铺、国家、仓库或商品筛选后再查看。':'当前没有可展示的库存快照。';if(!records.length&&context.state?.phase==='error')message='重新登录或重新读取后，库存明细将在这里显示。';return `<div class="iw-empty"><span class="iw-empty-icon" aria-hidden="true">⌂</span><h3>${records.length?'没有匹配的库存记录':context.state?.phase==='ready'?'当前范围暂无库存记录':'库存明细尚未读取'}</h3><p>${escape(message)}</p><button type="button" class="iw-button" data-iw-action="${records.length?'reset':'retry'}">${records.length?'重置筛选':'重新读取'}</button></div>${pagination}`;}
    return `<div class="iw-table-scroll" data-iw-scroll="main">${ui.view==='summary'?groupedTable(visible):detailTable(visible)}</div>${pagination}`;
  }
  function body(){
    if(combinedAnalysis()){
      return analysisSlides();
      return `<section class="iw-list-panel" data-iw-combined-analysis><header class="iw-list-head">${sourceRail()}</header>${analysisHeader()}<section id="inventory-analysis-amazon" class="iw-analysis-section" data-iw-analysis-section="amazon" tabindex="-1" aria-labelledby="iw-amazon-analysis-title"><header class="iw-analysis-section-head"><div><span class="iw-analysis-source">Amazon 库存快照</span><h3 id="iw-amazon-analysis-title">Amazon 库存健康</h3><p>沿用顶部店铺及日期范围；以下商品筛选只作用于 Amazon。</p></div><a class="iw-text-button" href="#inventory-analysis-excel">跳转至 Excel 分析 ↓</a></header><div data-iw-amazon-content>${amazonAnalysis()}</div></section><section id="inventory-analysis-excel" class="iw-analysis-section" data-iw-analysis-section="monthly" tabindex="-1" aria-labelledby="iw-monthly-analysis-title"><header class="iw-analysis-section-head"><div><span class="iw-analysis-source">Excel 月度报表</span><h3 id="iw-monthly-analysis-title">其他海外仓月度库存分析</h3><p>仅分析非 Amazon、沃尔玛、TikTok、TEMU 的 Excel 记录；与领星实时快照分别统计，不合并数量。</p></div><a class="iw-text-button" href="#inventory-analysis-amazon">返回 Amazon 快照 ↑</a></header><div data-overseas-detail data-overseas-mode="analysis"></div></section></section>`;
    }
    if(['unified','amazon','overseas','walmart-live','tiktok-live','temu-live'].includes(ui.source))return `<section class="iw-list-panel iw-unified-panel"><header class="iw-list-head">${sourceRail()}</header>${unifiedDetails()}</section>${productDrawer()}`;
    if(['age','import','excluded'].includes(ui.source))return `<section class="iw-list-panel"><header class="iw-list-head">${sourceRail()}</header><div data-overseas-detail data-overseas-mode="${ui.source}"></div></section>`;
    if(overview()){
      const apiState=presentData()||marketplace.data?apiOverview():loading()?'<div class="iw-empty" role="status"><span class="iw-loader" aria-hidden="true"></span><h3>正在读取实时库存快照</h3></div>':'<div class="iw-empty"><h3>暂无可展示的实时库存</h3><p>请重新读取库存快照。</p><button type="button" class="iw-button" data-iw-action="retry">重新读取</button></div>';
      return `<section class="iw-list-panel iw-statistics-panel iw-redesign-overview"><header class="iw-list-head">${sourceRail()}</header>${stateNotice()}<div class="iw-mode-header"><div><h2>库存管理</h2><p>按平台查看库存风险和商品，库存数量不跨平台相加。</p></div><div class="iw-overview-links"><button type="button" data-iw-action="export-pairing-audit">导出配对核对表</button><button type="button" data-iw-source="analysis">库存分析</button></div></div>${overviewSourceSwitch()}${ui.overviewDataset==='api'?apiState:`<section class="iw-monthly-overview"><div class="iw-monthly-overview-head"><h3>海外仓与其他平台库存</h3><p>当前来源：Excel 月度账面；按仓库查看汇总，进入明细可筛选店铺与成本口径。</p></div><div data-overseas-overview></div></section>`}</section>`;
    }
    const matches=pending()?0:filtered().length;
    return `<section class="iw-list-panel"><header class="iw-list-head">${sourceRail()}<div class="iw-view-switch" role="group" aria-label="库存查看方式"><button type="button" data-iw-view="detail" aria-pressed="${ui.view==='detail'}" class="${ui.view==='detail'?'is-active':''}">明细</button><button type="button" data-iw-view="summary" aria-pressed="${ui.view==='summary'}" class="${ui.view==='summary'?'is-active':''}">按 SKU 分组</button></div></header>${sourceSelector()}${stateNotice()}${pending()?'':`${filters()}${inventorySummary()}<div class="iw-list-context"><span>匹配 ${number(matches)} 条 / 本来源已加载 ${number(sourceRecords().length)} 条${ui.view==='summary'?' · 同名 SKU 分别查看，不合并数量':''}</span><button type="button" class="iw-text-button" data-iw-action="export"${matches===0?' disabled':''}>导出 ↗</button></div>`}${content()}${sourceSummary()}</section>${productDrawer()}`;
  }

  function captureState(){
    if(!root?.isConnected)return savedDom;
    const active=document.activeElement,focus=root.contains(active)?{filter:active.dataset.iwFilter,unifiedFilter:active.dataset.iwUnifiedFilter,unifiedKeyword:active.hasAttribute('data-iw-unified-keyword'),overviewKeyword:active.hasAttribute('data-iw-overview-keyword'),overviewFilterSearch:active.hasAttribute('data-iw-overview-filter-search'),overviewSort:active.dataset.iwOverviewSort,overviewFilter:active.dataset.iwOverviewFilter,overviewRisk:active.dataset.iwOverviewRisk,overviewPage:active.dataset.iwOverviewPage,overviewSize:active.hasAttribute('data-iw-overview-size'),unifiedFilterSearch:active.dataset.iwUnifiedFilterSearch,draftNumber:active.dataset.iwDraftNumber,draftNumberBound:active.dataset.iwNumberBound,draftDate:active.dataset.iwDraftDate,action:active.dataset.iwAction,source:active.dataset.iwSource,view:active.dataset.iwView,row:active.dataset.iwRow,group:active.dataset.iwGroup,sort:active.dataset.iwSort,unifiedSort:active.dataset.iwUnifiedSort,size:active.hasAttribute('data-iw-size'),order:active.hasAttribute('data-iw-order'),start:active.selectionStart,end:active.selectionEnd}:null;
    root.querySelectorAll('[data-iw-disclosure]').forEach(el=>{ui[el.dataset.iwDisclosure]=el.open;});
    savedDom={scroll:[...root.querySelectorAll('[data-iw-scroll]')].map(el=>[el.dataset.iwScroll,el.scrollLeft,el.scrollTop]),focus};return savedDom;
  }
  function restoreState(saved=savedDom){
    if(!root||!saved)return;
    saved.scroll?.forEach(([key,left,top])=>{const el=[...root.querySelectorAll('[data-iw-scroll]')].find(item=>item.dataset.iwScroll===key);if(el){el.scrollLeft=left;el.scrollTop=top;}});
    const focus=saved.focus;if(!focus)return;
    const attrs={filter:'iwFilter',unifiedFilter:'iwUnifiedFilter',unifiedFilterSearch:'iwUnifiedFilterSearch',overviewSort:'iwOverviewSort',overviewFilter:'iwOverviewFilter',overviewRisk:'iwOverviewRisk',overviewPage:'iwOverviewPage',action:'iwAction',source:'iwSource',view:'iwView',row:'iwRow',group:'iwGroup',sort:'iwSort',unifiedSort:'iwUnifiedSort'};
    const target=[...root.querySelectorAll('input,select,button')].find(el=>focus.size?el.hasAttribute('data-iw-size'):focus.order?el.hasAttribute('data-iw-order'):focus.overviewKeyword?el.hasAttribute('data-iw-overview-keyword'):focus.overviewFilterSearch?el.hasAttribute('data-iw-overview-filter-search'):focus.overviewSize?el.hasAttribute('data-iw-overview-size'):focus.unifiedKeyword?el.hasAttribute('data-iw-unified-keyword'):focus.draftNumber?el.dataset.iwDraftNumber===focus.draftNumber&&el.dataset.iwNumberBound===focus.draftNumberBound:focus.draftDate?el.dataset.iwDraftDate===focus.draftDate:Object.entries(attrs).some(([key,attr])=>focus[key]!==undefined&&el.dataset[attr]===focus[key]));
    if(target&&!target.disabled){target.focus({preventScroll:true});if(target.setSelectionRange&&focus.start!==null&&focus.start!==undefined)try{target.setSelectionRange(focus.start,focus.end);}catch(ignore){}}
  }
  function mountOverseas(){const detail=root?.querySelector('[data-overseas-detail]'),summary=root?.querySelector('[data-overseas-overview]');if(detail){if(window.OverseasInventory)window.OverseasInventory.mount(detail,detail.dataset.overseasMode);else detail.innerHTML='<div class="iw-empty"><h3>月度库存页面文件未完整加载</h3><p>请刷新页面后重试。</p></div>';}if(summary)window.OverseasInventory?.mountOverview(summary);if(combinedAnalysis())window.InventoryAnalysis?.mount(root.querySelector('[data-iw-amazon-content]'),filtered(),snapshot('amazon'));}
  function repaint(forceFull=false){if(!root?.isConnected)return;const saved=captureState(),amazon=combinedAnalysis()&&!forceFull?root.querySelector('[data-iw-amazon-content]'):null;if(amazon){amazon.innerHTML=amazonAnalysis();window.InventoryAnalysis?.mount(amazon,filtered(),snapshot('amazon'));}else{root.innerHTML=body();mountOverseas();}restoreState(saved);notifyState();}
  function reset(){binding?.abort();binding=null;ui=defaultUi();scopeKey=null;savedDom=null;root=null;context={};records=[];callbacks={};marketplace={data:null,loading:false,error:'',request:marketplace.request+1};unified={monthly:null,loading:false,error:'',request:unified.request+1};}
  function render(next={}){
    const nextKey=String(next.scopeKey??'default');
    if(scopeKey!==nextKey){const keepSource=ui.source;ui=defaultUi();if(['amazon','overseas','walmart-live','tiktok-live','temu-live'].includes(keepSource)){ui.source='unified';ui.unifiedSource=keepSource;ui.unifiedFilters={source:[keepSource]};}else if(SOURCES.some(source=>source.id===keepSource)){ui.source=keepSource;if(keepSource==='monthly-analysis')ui.analysisPage='excel';}savedDom=null;binding?.abort();root=null;}else captureState();
    scopeKey=nextKey;context={data:next.data||null,state:next.state||{},scopeLabel:next.scopeLabel||''};records=normalize(context.data);
    return `<div class="iw-workspace" data-iw-workspace>${body()}</div>`;
  }
  function openOverviewSource(id,risk='all',rowKey=''){
    if(!OVERVIEW_SOURCES.includes(id))return;
    selectSource('unified',{unifiedSource:id,platform:id==='amazon'?'Amazon':'all',risk:risk==='details'?'all':risk,rowKey});
  }
  function selectSource(id,filters={}){
    if(!SOURCES.some(source=>source.id===id))return;
    const analysis=['analysis','monthly-analysis'].includes(id),detailSources=['unified','amazon','overseas','walmart-live','tiktok-live','temu-live'];
    if(analysis&&combinedAnalysis()){switchAnalysisPage(id==='monthly-analysis'?'excel':'amazon');return;}
    if(detailSources.includes(id)){
      const requestedSource=filters.unifiedSource||(!['unified'].includes(id)?id:'all');
      const requestedPlatform=String(filters.platform||'');
      const selectedFilters=requestedSource&&requestedSource!=='all'?{source:[requestedSource==='overseas'&&text(filters.warehouse)?`excel:${text(filters.warehouse)}`:sourceFilterValue(requestedSource)]}:{};
      if(text(filters.country))selectedFilters.country=[text(filters.country)];
      if(requestedPlatform==='__UNKNOWN__')selectedFilters.platform=['待确认'];
      else if(requestedPlatform&&requestedPlatform!=='__SHARED__')selectedFilters.platform=[requestedPlatform];
      const requestedRisk=text(filters.risk);
      if(requestedRisk==='low')selectedFilters.stockRisk=['STOCKOUT','CRITICAL','WATCH'];
      else if(requestedRisk==='coverage-low')selectedFilters.forecastSellableDays={op:'lt',min:'',max:'14',includeMissing:false};
      else if(requestedRisk==='coverage-medium')selectedFilters.forecastSellableDays={op:'between',min:'14',max:'29.999',includeMissing:false};
      else if(requestedRisk==='coverage-long')selectedFilters.forecastSellableDays={op:'between',min:'30',max:'89.999',includeMissing:false};
      else if(requestedRisk==='high'||requestedRisk==='coverage-high')selectedFilters.forecastSellableDays={op:'gt',min:'89.999',max:'',includeMissing:false};
      else if(requestedRisk==='pending'){
        selectedFilters.forecastStatus=['NO_RECENT_SALES','SALES_SOURCE_UNAVAILABLE','SALES_NOT_MATCHED','SALES_NOT_LINKED'];
        if(requestedSource==='amazon')selectedFilters.quantity={op:'gt',min:'0',max:'',includeMissing:false};
      }
      ui.source='unified';ui.unifiedSource=requestedSource;ui.unifiedFilters=selectedFilters;ui.unifiedPeriod=String(filters.period||ui.unifiedPeriod||'');ui.platform=filters.platform||'all';ui.seller='all';ui.country='all';ui.warehouse='all';ui.keyword='';ui.riskFilter=filters.risk||'all';ui.drawerKey='';ui.drawerSource='';ui.page=1;ui.expanded.clear();ui.groups.clear();repaint();void loadUnified();return;
    }
    ui.source=analysis?'analysis':id;ui.analysisPage=id==='monthly-analysis'?'excel':'amazon';ui.platform='all';ui.seller='all';ui.country='all';ui.warehouse='all';ui.keyword='';ui.riskFilter='all';ui.drawerKey='';ui.drawerSource='';ui.page=1;ui.expanded.clear();ui.groups.clear();repaint(true);
  }
  function exportRows(){if(ui.source==='unified')return unifiedExportRows(unifiedSorted(unifiedRows()));return overview()||combinedAnalysis()||pending()?[]:sorted(filtered()).map(row=>({'SKU':row.sku,'ASIN':row.asin,'品名':row.name,'库存来源':SOURCE_NAMES[row.source],'平台':row.platform,'店铺':row.seller||'未关联店铺','国家':row.country||'未标注国家','仓库':row.warehouseLabel,'库存范围':row.sharedWarehouse?'共享仓':'店铺','卖家SKU数':row.sellerSkuNames?.length??null,'卖家SKU明细':row.sellerSkuDetails.map(item=>`${text(item.sellerSku)||'未标注'}：${number(item.fbaSellable)} 件`).join('；'),'FBA可售':row.available,'FBM可用':row.fbm,'占用':row.occupied,'不可售':row.unsellable,'在途或入库中':row.inbound,'近30天日均销量':row.daily,'近30天销量':row.sales,'近30天有记录天数':row.observed,'快照日期':row.dataDate}));}
  function pairingAuditRows(inventory, live, sales, errors={}){
    const rows=[],counts={stock:0,sales:0,pending:0},period=sales?.period||inventory?.period||{};
    const salesWindow=[period.startDate,period.endDate].filter(Boolean).join(' 至 ');
    const add=(category,platform,values={})=>rows.push({
      '类别':category,'平台':platform,'店铺/仓库':'','国家':'','内部SKU':'','ASIN':'','来源SKU/MSKU':'','商品名称':'',
      '配对或预测状态':'','具体原因':'','可售库存':'','在途库存':'','本期销量':'','近30天销量':'','销量观测天数':'',
      '库存快照时间':'','销量区间':salesWindow,'来源记录数':'','来源标识':'','备注':'',...values
    });
    const amazon=inventory?.amazonSnapshot||{};
    if(amazon.supported===false||!Array.isArray(amazon.products)){
      add('数据范围提醒','Amazon',{'备注':'Amazon 库存快照未返回；本表缺少该平台库存清单。'});
    }else{
      for(const row of normalize(inventory)){
        const fields={'店铺/仓库':row.sharedWarehouse?row.warehouseLabel:row.sellerRaw||row.seller,'国家':row.country,
          '内部SKU':row.sku,'ASIN':row.asin,'来源SKU/MSKU':row.sellerSkuNames.join('、'),'商品名称':row.name,
          '可售库存':row.available,'在途库存':row.inbound,'近30天销量':row.sales,'销量观测天数':row.observed,
          '库存快照时间':row.dataDate,'来源记录数':row.sellerSkuDetails.length||1,
          '备注':row.sharedWarehouse?'共享仓独立库存，不分摊到店铺。':''};
        if(!row.sku&&(numeric(row.available)>0||numeric(row.inbound)>0)){
          add('有库存未配对','Amazon',{'配对或预测状态':'INTERNAL_SKU_MISSING','具体原因':'库存来源内部 SKU 为空；需核对卖家 SKU 与商品资料。',...fields});counts.stock++;
        }
        if(amazonPendingRow(row)){
          add('有库存未预测','Amazon',{'配对或预测状态':row.forecastStatus,
            '具体原因':forecastStatusLabel(row.forecastStatus),'备注':'此类仅表示可售大于 0 且预测天数缺失，不等于库存未配对。',...fields});counts.pending++;
        }
      }
      if(amazon.hasMore===true)add('数据范围提醒','Amazon',{'库存快照时间':date(amazon.dataDate||amazon.snapshotDate),
        '备注':`库存接口仅返回 ${amazon.returnedCount??amazon.products.length} / ${amazon.total??'未知'} 条，本表 Amazon 库存清单不完整。`});
      if(amazon.salesStatsAvailable===false)add('数据范围提醒','Amazon',{'备注':'Amazon 销量关联暂不可用；有库存未预测不代表无销量。'});
    }
    const liveSources=[['walmartUs','沃尔玛 · 美国 WFS'],['tikTokUs','TikTok · 美国 FBT'],['temu','TEMU · 全托管']];
    for(const [key,platform] of liveSources){
      const report=live?.[key];
      if(!report||report.status){add('数据范围提醒',platform,{'备注':`实时库存来源未完整返回：${text(report?.message)||text(errors.marketplace)||'暂无快照'}。`});continue;}
      const snapshotAt=text(report.updatedAt||report.sourceSyncAt);
      for(const row of Array.isArray(report.unmatchedRows)?report.unmatchedRows:[]){
        if(!(numeric(row.sellable)>0||numeric(row.inTransit)>0))continue;
        const status=text(row.mappingStatus),reason=key==='temu'&&status==='NO_US_STORE_MATCH'
          ?'当前接口未区分 TEMU 未配对与一对多；需按来源 SKU 查配对表。'
          :({AMBIGUOUS_PAIRING:'来源 MSKU 对应多个内部 SKU。',SHARED_STORE_RECORD:'来源记录对应多个店铺。',NO_US_STORE_MATCH:'未匹配到范围内的美国店铺。',UNMATCHED_PAIRING:'来源 MSKU 未找到唯一内部 SKU。'})[status]||'配对状态待核对。';
        add('有库存未配对',platform,{'店铺/仓库':[...(row.storeNames||[]),...(row.sourceWarehouses||[])].join(' / '),'国家':text(row.country),
          '来源SKU/MSKU':(row.sourceSkus||[]).join('、'),'可售库存':row.sellable,'在途库存':row.inTransit,
          '配对或预测状态':status,'具体原因':reason,'库存快照时间':snapshotAt,'来源记录数':row.sourceRows,
          '备注':'未进入按内部 SKU 的已配对库存汇总。'});counts.stock++;
      }
      for(const row of Array.isArray(report.rows)?report.rows:[]){
        if(!(numeric(row.sellable)>0&&numeric(row.forecastSellableDays)===null))continue;
        add('有库存未预测',platform,{'店铺/仓库':[...(row.storeNames||[]),...(row.sourceWarehouses||[])].join(' / '),'国家':text(row.country),
          '内部SKU':text(row.sku),'来源SKU/MSKU':(row.sourceSkus||[]).join('、'),'可售库存':row.sellable,
          '在途库存':row.inTransit,'近30天销量':row.sales30d,'配对或预测状态':text(row.forecastStatus),
          '具体原因':forecastStatusLabel(row.forecastStatus),'库存快照时间':snapshotAt,'来源记录数':row.sourceRows,
          '备注':'已进入内部 SKU 汇总；此类不等于库存未配对。'});counts.pending++;
      }
    }
    if(!sales){add('数据范围提醒','全部平台',{'备注':`销量清单未返回：${text(errors.sales)||'数据源不可用'}；本表缺少有销量未配对部分。`});}
    else{
      const platforms=new Map((sales.platforms||[]).map(item=>[text(item.id),item]));
      for(const [id,name] of [['amazon','Amazon'],['walmart','沃尔玛 · 美国 WFS'],['tiktok','TikTok · 美国 FBT'],['temu','TEMU · 全托管']]){
        const source=platforms.get(id);
        if(!source||source.status!=='ready')add('数据范围提醒',name,{'备注':`本期销量来源状态：${text(source?.status)||'未返回'}；${text(source?.error)||'该平台有销量未配对清单可能不完整'}。`});
      }
      for(const row of Array.isArray(sales.records)?sales.records:[]){
        const status=text(row.mappingStatus);
        if(status==='matched'||!(numeric(row.currentUnits)>0))continue;
        const platform=text(row.platformName)||text(row.platform),reason=text(row.mappingReason)||
          (status==='ambiguous'?'来源商品存在多个内部 SKU 候选。':'来源商品未找到唯一内部 SKU。');
        add('有销量未配对',platform,{'店铺/仓库':text(row.storeName),'国家':text(row.country),'内部SKU':text(row.sku),
          'ASIN':text(row.asin),'来源SKU/MSKU':text(row.msku||row.sourceSku),'商品名称':text(row.name),
          '本期销量':row.currentUnits,'配对或预测状态':status,'具体原因':reason,
          '来源记录数':1,'来源标识':text(row.sourceIdentity||row.sourceSku),
          '备注':text(row.platform)==='temu'?'销售接口为全部 TEMU 全托管记录，范围可能宽于库存预测使用的已确认店铺。':'按销售与利润接口的本期来源商品汇总，非原始订单行。'});counts.sales++;
      }
    }
    return {rows,counts,partial:rows.some(row=>row['类别']==='数据范围提醒')};
  }
  function getFilters(){const amazon={platform:ui.platform,seller:ui.seller===EMPTY?'未关联店铺':ui.seller,country:ui.country===EMPTY?'未标注国家':ui.country,warehouse:ui.warehouse==='all'?'all':`${SOURCE_NAMES[ui.warehouse]} · 仓库未细分`,keyword:ui.keyword};if(combinedAnalysis())return {source:'analysis',view:'analysis',amazon,monthly:{...(window.OverseasInventory?.getFilters?.()||{})}};if(ui.source==='unified')return {source:'unified',inventorySource:(ui.unifiedFilters?.source||[]).join(','),period:unifiedPeriod(),keyword:ui.keyword,filters:clone(ui.unifiedFilters),sort:ui.unifiedSort,direction:ui.unifiedDirection,view:'detail'};if(['age','import','excluded'].includes(ui.source))return {source:'monthly',...(window.OverseasInventory?.getFilters?.()||{})};return {source:ui.source,...amazon,view:overview()?'overview':ui.view};}
  function mount(container,nextCallbacks={}){
    binding?.abort();callbacks=nextCallbacks;root=container?.matches?.('[data-iw-workspace]')?container:container?.querySelector?.('[data-iw-workspace]');if(!root)return;
    binding=new AbortController();const eventOptions={signal:binding.signal};
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled)return;
      if(button.hasAttribute('data-iw-overview-dataset')){ui.overviewDataset=button.dataset.iwOverviewDataset;ui.riskFilter='all';ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-overview-platform-page')){ui.overviewPlatform=button.dataset.iwOverviewPlatformPage;ui.riskFilter='all';ui.overviewKeyword='';ui.overviewSorts=[];ui.overviewColumnFilters={};ui.overviewFilterOpen='';ui.overviewFilterDraft=[];ui.overviewRangeDraft={min:'',max:''};ui.overviewRangeError='';ui.overviewFilterSearch='';ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-overview-source')){openOverviewSource(button.dataset.iwOverviewSource);return;}
      if(button.hasAttribute('data-iw-overview-row')){ui.drawerKey=button.dataset.iwOverviewRow;ui.drawerSource='amazon';repaint();return;}
      if(button.hasAttribute('data-iw-overview-live-row')){ui.drawerKey=button.dataset.iwOverviewLiveRow;ui.drawerSource=ui.overviewPlatform;repaint();return;}
      if(button.hasAttribute('data-iw-overview-risk')){ui.riskFilter=button.dataset.iwOverviewRisk;ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-overview-sort')){const key=button.dataset.iwOverviewSort,sorts=[...ui.overviewSorts],index=sorts.findIndex(item=>item.key===key);if(index<0)sorts.push({key,direction:'asc'});else if(sorts[index].direction==='asc')sorts[index]={key,direction:'desc'};else sorts.splice(index,1);ui.overviewSorts=sorts;ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-overview-filter')){const key=button.dataset.iwOverviewFilter,active=ui.overviewColumnFilters[key];ui.overviewFilterOpen=ui.overviewFilterOpen===key?'':key;ui.overviewFilterDraft=Array.isArray(active)?[...active]:[];ui.overviewRangeDraft={min:active&&!Array.isArray(active)&&active.min!==null?String(active.min):'',max:active&&!Array.isArray(active)&&active.max!==null?String(active.max):''};ui.overviewRangeError='';ui.overviewFilterSearch='';repaint();return;}
      if(button.hasAttribute('data-iw-overview-select-visible')){const key=ui.overviewFilterOpen;if(!key)return;const options=overviewColumnOptions(overviewStatus(ui.overviewPlatform),key);ui.overviewFilterDraft=[...new Set([...ui.overviewFilterDraft,...options.visible.map(([value])=>value)])];repaint();return;}
      if(button.hasAttribute('data-iw-overview-clear-draft')){ui.overviewFilterDraft=[];repaint();return;}
      if(button.hasAttribute('data-iw-overview-clear-range')){ui.overviewRangeDraft={min:'',max:''};ui.overviewRangeError='';repaint();return;}
      if(button.hasAttribute('data-iw-overview-cancel-filter')){ui.overviewFilterOpen='';ui.overviewFilterDraft=[];ui.overviewRangeError='';ui.overviewFilterSearch='';repaint();return;}
      if(button.hasAttribute('data-iw-overview-apply-filter')){
        const key=ui.overviewFilterOpen;if(!key)return;
        const filters={...ui.overviewColumnFilters};
        if(OVERVIEW_RANGE_KEYS.has(key)){
          const rawMin=text(ui.overviewRangeDraft.min),rawMax=text(ui.overviewRangeDraft.max),min=numeric(rawMin),max=numeric(rawMax);
          if((rawMin&&(min===null||min<0))||(rawMax&&(max===null||max<0))||(min!==null&&max!==null&&min>max)){ui.overviewRangeError='请输入有效的非负区间，且最小值不能大于最大值。';repaint();return;}
          if(min===null&&max===null)delete filters[key];else filters[key]={min,max};
        }else if(ui.overviewFilterDraft.length)filters[key]=[...ui.overviewFilterDraft];else delete filters[key];
        ui.overviewColumnFilters=filters;ui.overviewFilterOpen='';ui.overviewRangeError='';ui.overviewFilterSearch='';ui.overviewPage=1;repaint();return;
      }
      if(button.hasAttribute('data-iw-overview-remove-filter')){const filters={...ui.overviewColumnFilters};delete filters[button.dataset.iwOverviewRemoveFilter];ui.overviewColumnFilters=filters;ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-overview-clear-all')){ui.overviewColumnFilters={};ui.overviewFilterOpen='';ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-overview-page')){ui.overviewPage+=button.dataset.iwOverviewPage==='next'?1:-1;const list=root.querySelector('[data-iw-scroll="overview-list"]');if(list)list.scrollTop=0;repaint();return;}
      if(button.hasAttribute('data-iw-overview-action')){ui.riskFilter=button.dataset.iwOverviewAction==='details'?'all':button.dataset.iwOverviewAction;ui.overviewPage=1;repaint();return;}
      if(button.hasAttribute('data-iw-drawer')){ui.drawerKey=button.dataset.iwDrawer;ui.drawerSource='amazon';repaint();return;}
      if(button.hasAttribute('data-iw-live-drawer')){ui.drawerKey=button.dataset.iwLiveDrawer;ui.drawerSource=ui.source;repaint();return;}
      if(button.hasAttribute('data-iw-analysis-page')){switchAnalysisPage(button.dataset.iwAnalysisPage);return;}
      if(button.hasAttribute('data-iw-unified-sort')){cycleUnifiedSort(button.dataset.iwUnifiedSort);repaint();return;}
      if(button.hasAttribute('data-iw-draft-choice-action')){setDraftChoiceAction(button.dataset.iwFilterKey,button.dataset.iwDraftChoiceAction);repaint();return;}
      if(button.hasAttribute('data-iw-draft-field-reset')){const draft=filterDraft();delete draft[button.dataset.iwDraftFieldReset];ui.unifiedFilterDraft=draft;repaint();return;}
      if(button.hasAttribute('data-iw-remove-unified-filter')){const filters=clone(ui.unifiedFilters);delete filters[button.dataset.iwRemoveUnifiedFilter];ui.unifiedFilters=filters;ui.page=1;repaint();return;}
      if(button.hasAttribute('data-iw-source')){selectSource(button.dataset.iwSource,button.hasAttribute('data-iw-platform')||button.hasAttribute('data-iw-warehouse')?{platform:button.dataset.iwPlatform,warehouse:button.dataset.iwWarehouse,country:button.dataset.iwCountry,period:button.dataset.iwPeriod}:undefined);return;}
      if(button.hasAttribute('data-iw-view')){ui.view=button.dataset.iwView;ui.sort='sku';ui.direction=1;ui.page=1;repaint();return;}
      if(button.hasAttribute('data-iw-sort')){const key=button.dataset.iwSort;ui.direction=ui.sort===key?-ui.direction:1;ui.sort=key;ui.page=1;repaint();return;}
      if(button.hasAttribute('data-iw-row')){const key=button.dataset.iwRow;ui.expanded.has(key)?ui.expanded.delete(key):ui.expanded.add(key);repaint();return;}
      if(button.hasAttribute('data-iw-group')){const key=button.dataset.iwGroup;ui.groups.has(key)?ui.groups.delete(key):ui.groups.add(key);repaint();return;}
      const action=button.dataset.iwAction;
      if(action==='retry')callbacks.onRetry?.();
      else if(action==='retry-live'){marketplace={data:null,loading:false,error:'',request:marketplace.request+1};loadMarketplace();}
      else if(action==='reload-unified'){unified={...unified,monthly:null,error:''};marketplace={...marketplace,data:null,error:''};void loadUnified(true);}
      else if(action==='export'||action==='export-unified')callbacks.onExport?.(exportRows());
      else if(action==='export-pairing-audit')callbacks.onPairingAudit?.();
      else if(action==='clear-risk'){ui.riskFilter='all';ui.page=1;repaint();}
      else if(action==='toggle-unified-filter'){if(ui.unifiedFilterOpen)closeUnifiedFilter();else openUnifiedFilter();repaint();}
      else if(action==='cancel-unified-filter'){closeUnifiedFilter();repaint();}
      else if(action==='apply-unified-filter'){applyUnifiedFilter();repaint();}
      else if(action==='clear-unified-filters'){ui.unifiedFilters={};ui.page=1;repaint();}
      else if(action==='clear-unified-keyword'){ui.keyword='';ui.page=1;repaint();}
      else if(action==='reset-unified-query'){ui.unifiedFilters={};ui.keyword='';ui.page=1;repaint();}
      else if(action==='toggle-unified-sort'){if(ui.unifiedSortOpen)closeUnifiedSort();else openUnifiedSort();repaint();}
      else if(action==='cancel-unified-sort'){closeUnifiedSort();repaint();}
      else if(action==='apply-unified-sort'){applyUnifiedSort();repaint();}
      else if(action==='clear-unified-sort'){ui.unifiedSort='';ui.unifiedDirection=0;ui.page=1;repaint();}
      else if(action==='toggle-unified-columns'){ui.unifiedColumnsOpen=!ui.unifiedColumnsOpen;ui.unifiedFilterOpen=false;ui.unifiedSortOpen=false;repaint();}
      else if(action==='close-unified-columns'){ui.unifiedColumnsOpen=false;repaint();}
      else if(action==='reset-unified'){ui.unifiedFilters={};ui.keyword='';ui.unifiedSort='';ui.unifiedDirection=0;ui.page=1;repaint();}
      else if(action==='close-drawer'){ui.drawerKey='';ui.drawerSource='';repaint();}
      else if(action==='direction'){ui.direction=-ui.direction;ui.page=1;repaint();}
      else if(action==='reset'){const id=ui.source,analysis=combinedAnalysis();ui=defaultUi();if(analysis){ui.source='analysis';repaint();}else selectSource(id);}
      else if(action==='prev'||action==='next'){ui.page+=action==='next'?1:-1;repaint();const scroll=root.querySelector('[data-iw-scroll="main"]');if(scroll)scroll.scrollTop=0;}
    },eventOptions);
    root.addEventListener('change',event=>{
      const el=event.target;
      if(el.hasAttribute('data-iw-draft-choice')){setDraftChoice(el.dataset.iwDraftChoice,el.value,el.checked);repaint();return;}
      if(el.hasAttribute('data-iw-draft-number-op')){setDraftNumber(el.dataset.iwDraftNumberOp,{op:el.value});repaint();return;}
      if(el.hasAttribute('data-iw-draft-number-missing')){setDraftNumber(el.dataset.iwDraftNumberMissing,{includeMissing:el.checked});repaint();return;}
      if(el.hasAttribute('data-iw-draft-date')){setDraftDate(el.dataset.iwDraftDate,el.value);repaint();return;}
      if(el.hasAttribute('data-iw-unified-sort-draft')){const draft=ui.unifiedSortDraft||{};ui.unifiedSortDraft={...draft,[el.dataset.iwUnifiedSortDraft]:el.dataset.iwUnifiedSortDraft==='direction'?Number(el.value):el.value};repaint();return;}
      if(el.hasAttribute('data-iw-unified-column')){const columns={...(ui.unifiedColumns||{})},visible=unifiedVisibleColumns();if(!el.checked&&visible.length<=1){repaint();return;}columns[el.dataset.iwUnifiedColumn]=el.checked;ui.unifiedColumns=columns;repaint();return;}
      if(el.hasAttribute('data-iw-unified-period')){ui.unifiedPeriod=el.value;ui.page=1;unified={...unified,monthly:null,error:''};repaint();void loadUnified(true);return;}
      if(el.hasAttribute('data-iw-overview-choice')){const values=new Set(ui.overviewFilterDraft);el.checked?values.add(el.value):values.delete(el.value);ui.overviewFilterDraft=[...values];return;}
      if(el.hasAttribute('data-iw-overview-size')){ui.overviewSize=[50,100].includes(Number(el.value))?Number(el.value):50;ui.overviewPage=1;repaint();return;}
      if(el.hasAttribute('data-iw-overview-platform')){ui.overviewPlatform=el.value;ui.riskFilter='all';repaint();return;}if(el.hasAttribute('data-iw-dataset')){selectSource(el.value);return;}if(el.hasAttribute('data-iw-size')){ui.size=[0,50,100].includes(Number(el.value))?Number(el.value):50;ui.page=1;repaint();return;}if(el.hasAttribute('data-iw-order')){ui.sort=el.value;ui.page=1;repaint();return;}
      const key=el.dataset.iwFilter;if(!key||key==='keyword')return;
      if(key==='platform'){ui.platform=el.value;ui.page=1;repaint();return;}
      ui[key]=el.value;ui.page=1;repaint();
    },eventOptions);
    const applyKeyword=event=>{const target=event.target;if(event.isComposing)return;if(target.hasAttribute('data-iw-overview-filter-search')){ui.overviewFilterSearch=target.value;repaint();return;}if(target.hasAttribute('data-iw-overview-keyword')){ui.overviewKeyword=target.value;ui.overviewPage=1;repaint();return;}if(target.dataset.iwUnifiedFilterSearch){ui.unifiedFilterSearch={...(ui.unifiedFilterSearch||{}),[target.dataset.iwUnifiedFilterSearch]:target.value};repaint();return;}if(target.dataset.iwDraftNumber){setDraftNumber(target.dataset.iwDraftNumber,{[target.dataset.iwNumberBound]:target.value});repaint();return;}const keyword=target.dataset.iwFilter==='keyword'||target.hasAttribute('data-iw-unified-keyword');if(!keyword)return;ui.keyword=target.value;ui.page=1;repaint();};
    root.addEventListener('input',event=>{const bound=event.target.dataset.iwOverviewRange;if(bound!=='min'&&bound!=='max')return;ui.overviewRangeDraft={...ui.overviewRangeDraft,[bound]:event.target.value};ui.overviewRangeError='';},eventOptions);
    root.addEventListener('input',applyKeyword,eventOptions);
    root.addEventListener('compositionend',applyKeyword,eventOptions);
    root.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(ui.overviewFilterOpen){ui.overviewFilterOpen='';ui.overviewFilterDraft=[];ui.overviewFilterSearch='';event.preventDefault();repaint();return;}if(ui.unifiedFilterOpen){closeUnifiedFilter();event.preventDefault();repaint();return;}if(ui.unifiedSortOpen){closeUnifiedSort();event.preventDefault();repaint();return;}if(ui.unifiedColumnsOpen){ui.unifiedColumnsOpen=false;event.preventDefault();repaint();}},eventOptions);
    const mountedRoot=root,mountedScope=scopeKey,mountedBinding=binding;
    mountOverseas();
    if((overview()&&ui.overviewDataset==='api')||combinedAnalysis())loadMarketplace();
    if(ui.source==='unified')void loadUnified();
    notifyState();
    restoreState();
    requestAnimationFrame(()=>{if(root===mountedRoot&&scopeKey===mountedScope&&binding===mountedBinding&&root.isConnected)restoreState();});
  }
  window.InventoryWorkspace={render,mount,exportRows,pairingAuditRows,getFilters,reset,captureState,restoreState,canExport,selectSource};
})();
