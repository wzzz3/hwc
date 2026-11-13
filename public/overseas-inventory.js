(function () {
  'use strict';
  const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value);
  const n = (value, digits = 0) => num(value) === null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits });
  const label = value => value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const platforms = ['Amazon','Walmart','Yahoo','Mercado Libre','Coupang','TikTok','Temu','共享','待确认'];
  const basisName = value => value === 'SOURCE_SIGNED_STOCK' ? '月度报表原值（含负值）' : value || '数量口径待确认';
  const statuses = {PROCESSING:'解析中',PREVIEW:'待确认导入',IMPORTING:'正在导入',IMPORTED:'已导入',FAILED:'处理失败'};
  const reconciliationStatuses = {SCOPE_UNMATCHED:'范围未匹配',INCOMPLETE:'含缺失或错误',INCOMPLETE_DIFFERENCE:'有差异且不完整',MATCHED:'已对平',DIFFERENCE:'存在差异'};
  const freshFilters = () => ({period:'',platform:'',warehouse:'',shop:'',country:'',category1:'',owner:'',keyword:'',searchMode:'auto',page:1,pageSize:50});
  const freshSettings = () => ({reportYear:'',currency:'UNKNOWN',detailSheet:'',summarySheet:'',rowMappings:{}});
  let root = null, mode = 'details', binding = null, generation = 0, inventoryEpoch = 0, jobReadEpoch = 0, statusTask = null, inventoryTask = null, timer = null;
  let warehouseFiles = {}, warehousePreview = null, warehouseData = null;
  let state = freshState();
  function freshState() { return {status:null,statusError:'',data:null,dataKey:'',dataError:'',loading:false,filters:freshFilters(),keywordDraft:'',preview:null,job:null,file:null,settings:freshSettings(),settingsRevision:0,submittedSettingsRevision:0,settingsDirty:false,busy:false,message:'',error:'',ack:false,replaceAck:false,expanded:null,history:null,historyError:'',historyLoading:false,overviewPage:1}; }
  function api(name, ...args) { const fn = window.AnalyticsApi?.[name]; if (!fn) return Promise.reject(new Error('月度库存接口文件未加载，请刷新页面')); return fn(...args); }
  // Access follows the existing RuoYi login and menu route.  This module does
  // not define a second set of page-level read/import/export permissions.
  function allowed() { return true; }
  function activePeriods() { return state.status?.periods || []; }
  function params() { return {...state.filters,view:mode==='analysis'?'analysis':mode==='age'?'age':mode==='excluded'?'excluded':mode==='overview'?'overview':'details',...(mode==='import'&&state.preview?{previewId:state.preview}:{})}; }
  function currentKey() { return JSON.stringify(params()); }
  function metadata() { return state.job?.metadata || state.data?.metadata || {}; }
  function hasIssues() { const meta = state.job?.metadata || {}; return Number(meta.issueCount) > 0 || (meta.warnings || []).length > 0 || (meta.issues || []).length > 0; }
  function hasBlockers() {return (state.job?.metadata?.blockingErrors||[]).length>0;}
  function settingsLocked() {return state.busy||['PROCESSING','IMPORTING'].includes(state.job?.status);}
  function invalidateInventory() {inventoryEpoch++;inventoryTask=null;state.loading=false;state.data=null;state.dataKey='';state.dataError='';state.expanded=null;state.history=null;state.historyLoading=false;}
  function button(action, text, disabled = false, primary = false) { return `<button type="button" class="oi-button${primary?' oi-primary':''}" data-oi-action="${action}"${disabled?' disabled':''}>${e(text)}</button>`; }
  function notice(text, error = false) { return `<div class="oi-notice${error?' oi-error':''}" role="${error?'alert':'status'}">${e(text)}</div>`; }
  function empty(title, text, action = '') { return `<div class="oi-empty"><strong>${e(title)}</strong><p>${e(text)}</p>${action}</div>`; }
  function select(name, title, choices, value, attr = 'filter') { const list=choices.slice();if(value!==''&&value!==undefined&&!list.some(x=>String(Array.isArray(x)?x[0]:x)===String(value)))list.push([value,value]);return `<label class="oi-field"><span>${e(title)}</span><select data-oi-${attr}="${e(name)}" aria-label="${e(title)}"${attr==='setting'&&(state.busy||['PROCESSING','IMPORTING'].includes(state.job?.status))?' disabled':''}>${list.map(item=>{const pair=Array.isArray(item)?item:[item,item];return `<option value="${e(pair[0])}"${String(value)===String(pair[0])?' selected':''}>${e(pair[1])}</option>`;}).join('')}</select></label>`; }
  function field(name, title, value, placeholder = '', type = 'text') { return `<label class="oi-field"><span>${e(title)}</span><input type="${type}" data-oi-setting="${name}" value="${e(value)}" placeholder="${e(placeholder)}"${type==='number'?' min="2000" max="2100"':''}${state.busy||['PROCESSING','IMPORTING'].includes(state.job?.status)?' disabled':''}></label>`; }
  function date(value) { if (Array.isArray(value)) return value.slice(0,3).map((x,i)=>i?String(x).padStart(2,'0'):x).join('-'); return label(value).replace('T',' ').slice(0,19); }
  function coverage(row,key) {const known=num(row?.[`${key}Known`]),total=num(row?.recordCount);if(known===null||total===null)return '';const partial=known<total;return `<small${partial?' class="oi-invalid"':''}>有效 ${n(known)} / ${n(total)} 条${partial?` · 缺失或错误 ${n(total-known)} 条 · ${known?'仅有效值合计':'暂无有效值'}`:''}</small>`;}
  function money(summary) { const groups=summary?.costByCurrency || []; return groups.length ? groups.map(row=>`<span>${e(row.currency==='UNKNOWN'?'币种待确认':row.currency||'币种待确认')} · ${e(basisName(row.quantityBasis))} <b>${n(row.cost,2)}</b><br>${coverage(row,'cost')}</span>`).join('') : '<span>— <small>暂无有效成本</small></span>'; }
  function platformOverview(data) {
    // API groups cover every matching row before pagination. Never aggregate data.rows here.
    const allSource=Array.isArray(data?.groups)?data.groups:[];
    if(!allSource.length)return '';
    // These three scopes have an authoritative current API card in the overview.
    // Do not put their historical monthly Excel rows beside that card as though
    // they were the same snapshot. Excel remains available in 商品明细.
    const livePlatforms=new Set(['Walmart','TikTok','Temu']);
    const physicalWarehouses=new Set(['速星海外仓','FLash海外仓','中南通达海外仓','天屹海外仓','友乐海外仓','谷仓海外仓','金仓海外仓','神户海外仓','日本大阪自建仓','佑美顺海外仓','天瞳海外仓','海源一件代发海外仓','佑美顺一件代发海外仓']);
    const isPhysicalWarehouse=row=>physicalWarehouses.has(String(row.warehouse||'').trim());
    const deferredPlatforms=[...new Set(allSource.filter(row=>!isPhysicalWarehouse(row)&&livePlatforms.has(String(row.platform||'').trim())).map(row=>String(row.platform).trim()))];
    const source=allSource.filter(row=>isPhysicalWarehouse(row)||!livePlatforms.has(String(row.platform||'').trim()));
    const buckets=new Map(),names={Walmart:'沃尔玛',Yahoo:'雅虎',"Mercado Libre":'美客多',Coupang:'Coupang',TikTok:'TikTok',Temu:'Temu',Amazon:'Amazon'};
    source.forEach(row=>{
      const platform=String(row.platform||'').trim(),scope=String(row.platformScope||'');
      const shared=scope==='SHARED',unknown=!shared&&(!platform||scope==='UNKNOWN');
      const physical=isPhysicalWarehouse(row),warehouse=String(row.warehouse||'').trim(),country=String(row.country||'').trim(),warehouseCountry=String(row.warehouseCountry||'').trim();
      const key=physical?JSON.stringify(['warehouse',warehouse,country,warehouseCountry]):shared?'shared':unknown?'unknown':JSON.stringify(['platform',platform]);
      const title=physical?`${warehouse}${warehouseCountry||country?` · ${warehouseCountry||country}`:''}`:shared?'共享平台':unknown?'平台待确认':names[platform]||platform;
      if(!buckets.has(key))buckets.set(key,{key,filter:shared?'__SHARED__':unknown?'__UNKNOWN__':platform,title,shared,unknown,physical,warehouse:physical?warehouse:'',country:physical?country:'',rows:[],names:new Set(),countries:new Set(),warehouses:new Set()});
      const group=buckets.get(key);group.rows.push(row);
      if(platform)group.names.add(platform);
      if(row.country)group.countries.add(String(row.country));
      if(row.warehouse)group.warehouses.add(String(row.warehouse));
    });
    function totals(rows,field) {
      const valid=rows.filter(row=>num(row[field])!==null),completeCount=rows.every(row=>num(row[`${field}Known`])!==null),completeTotal=rows.every(row=>num(row.recordCount)!==null);
      return {[field]:valid.length?valid.reduce((sum,row)=>sum+Number(row[field]),0):null,[`${field}Known`]:completeCount?rows.reduce((sum,row)=>sum+Number(row[`${field}Known`]),0):null,recordCount:completeTotal?rows.reduce((sum,row)=>sum+Number(row.recordCount),0):null};
    }
    function split(rows,keys,field) {
      const map=new Map();rows.forEach(row=>{const identity=keys.map(k=>String(row[k]||'')),key=JSON.stringify(identity);if(!map.has(key))map.set(key,{identity,rows:[]});map.get(key).rows.push(row);});
      return [...map.values()].map(group=>({...Object.fromEntries(keys.map((k,i)=>[k,group.identity[i]])),...totals(group.rows,field)}));
    }
    const groups=[...buckets.values()].sort((a,b)=>Number(b.physical)-Number(a.physical)||Number(a.unknown)-Number(b.unknown)||Number(a.shared)-Number(b.shared)||a.title.localeCompare(b.title,'zh-CN',{numeric:true}));
    return `<section class="oi-platform-overview" aria-label="Excel库存按仓库和平台汇总"><div class="oi-platform-heading"><div><h4>海外仓与其他平台 · 月度账面</h4><p>实体海外仓按仓库展示。点击仓库查看当月账面明细。</p></div><span>${e(data.period||'来源月份')} · ${n(groups.length)} 个分组 · 点击卡片查看明细</span></div>${groups.length?`<div class="oi-platform-grid">${groups.map(group=>{
      const quantities=split(group.rows,['quantityBasis'],'quantity'),costs=split(group.rows,['quantityBasis','currency'],'cost'),total=totals(group.rows,'quantity');
      const countries=[...group.countries].sort((a,b)=>a.localeCompare(b,'zh-CN')),markets=countries.slice(0,3).join('、')+(countries.length>3?` 等 ${n(countries.length)} 个来源市场`:'');
      const negative=group.rows.every(row=>num(row.negativeQuantityCount)!==null)?group.rows.reduce((sum,row)=>sum+Number(row.negativeQuantityCount),0):null;
      return `<article class="oi-platform-card${group.unknown?' is-unconfirmed':''}">
        <header><h5><button type="button" class="oi-platform-open" data-iw-source="overseas" data-iw-platform="${e(group.filter)}"${group.physical?` data-iw-warehouse="${e(group.warehouse)}" data-iw-country="${e(group.country)}"`:''} data-iw-period="${e(data.period||'')}" aria-label="查看${e(group.title)} ${e(data.period||'')}库存明细">${e(group.title)}</button></h5><span class="oi-platform-badge">${group.physical?'Excel 月报':group.shared?'共享库存':group.unknown?'归属待确认':'Excel'}</span></header>
        ${group.physical?`<p class="oi-platform-subtitle">${e([...group.names].join('、')||'平台待确认')} · 账面库存，不等于实时可售</p>`:group.shared?`<p class="oi-platform-subtitle">${e([...group.names].join('、')||'多个平台共用')} · 不拆分数量</p>`:group.unknown?'<p class="oi-platform-subtitle">保留未确认归属的来源记录</p>':''}
        <div class="oi-platform-quantity"><span>月度报表数量 · 账面汇总</span>${quantities.map(q=>`<div>${quantities.length>1?`<small>${e(basisName(q.quantityBasis))}</small>`:''}<strong class="${num(q.quantity)<0?'oi-invalid':''}">${n(q.quantity)}</strong>${coverage(q,'quantity')}</div>`).join('')}</div>
        <dl class="oi-platform-counts"><div><dt>商品记录</dt><dd>${n(total.recordCount)}</dd></div><div><dt>仓库分组</dt><dd>${n(group.warehouses.size)}</dd></div></dl>
        <div class="oi-platform-cost"><span>库存成本 · 原币账面汇总</span>${costs.map(cost=>{const pending=!cost.currency||['UNKNOWN','UNK'].includes(cost.currency);return `<div><span>${e(pending?'币种待确认 · 同表原值':cost.currency)}${costs.some(x=>x.quantityBasis!==cost.quantityBasis)?` · ${e(basisName(cost.quantityBasis))}`:''}</span><b class="${num(cost.cost)<0?'oi-invalid':''}">${n(cost.cost,2)}</b>${coverage(cost,'cost')}</div>`;}).join('')}</div>
        <footer><span title="${e(countries.join('、'))}">市场：${e(markets||'待确认')}</span>${negative>0?`<span class="oi-invalid">负库存 ${n(negative)} 条，已保留原值</span>`:''}<span class="oi-platform-cta" aria-hidden="true">查看库存明细 <span>↗</span></span></footer>
      </article>`;
    }).join('')}</div>`:'<div class="oi-platform-empty">当前月度表仅含已由实时接口覆盖的平台；历史 Excel 可在“商品明细”按月份查看。</div>'}<p class="oi-help">来源：${e(data.period||'未选择月份')} 月度报表 · 导入时间 ${e(date(data.importedAt))}。保留原始负值，缺失不补零；电子琴不参与汇总。${deferredPlatforms.length?` ${e(deferredPlatforms.join('、'))} 的当前库存以上方实时卡片为准；Excel 历史账面仍在商品明细保留。`:''} Walmart 加拿大仍按指定 Excel 明细核对，不与美国 WFS 相加。</p></section>`;
  }
  function summaryHtml(data, overview = false) {
    if(overview)return `${platformOverview(data)||empty('本月暂无平台库存','可进入商品明细切换月份查看。')}`;
    const summary=data?.summary||{},quantities=summary.quantityByBasis||[];
    const byBasis=Array.isArray(quantities)?quantities:Object.entries(quantities).map(([quantityBasis,quantity])=>({quantityBasis,quantity}));
    const quantity=byBasis.length>1?byBasis.map(x=>`<span>${e(basisName(x.quantityBasis||x.basis))}: ${n(x.quantity)}</span><br>${coverage(x,'quantity')}`).join('<br>'):`${n(summary.quantity)}<br>${coverage(summary,'quantity')}`;
    return `<section class="oi-summary"><div class="oi-section-head"><div><h3>Excel 月度账面库存</h3><p>${e(data?.period||'未选择月份')} · 来源：月度报表 · 导入时间 ${e(date(data?.importedAt))}</p></div>${overview?'<button type="button" class="oi-link" data-iw-source="overseas">查看库存明细 ↗</button>':''}</div><dl class="oi-metrics"><div><dt>月度报表数量</dt><dd>${quantity}</dd><small>保留原始负值；异口径分别展示</small></div><div><dt>匹配记录</dt><dd>${n(summary.recordCount)}</dd><small>电子琴不参与汇总</small></div><div><dt>仓库分组 / SKU</dt><dd>${n(summary.warehouseCount)} <em>/</em> ${n(summary.skuCount)}</dd><small>跨来源对应关系待确认</small></div><div class="oi-cost"><dt>库存成本 · 原币</dt><dd>${money(summary)}</dd><small>币种独立展示，不换算相加</small></div></dl>${overview?platformOverview(data):''}<p class="oi-help">月度报表数量保留负值并标记异常，不代表实时可售库存；与 Amazon API 快照不能直接相加。仓库名称和组合地区按来源保留，不推断物理仓细分。</p></section>`;
  }
  function toolbar(controls = '') { const titles={details:'商品明细 · Excel 月度报表',analysis:'库存分析 · Excel 月度报表',age:'月库龄来源明细',excluded:'电子琴 / 金仓电子琴 · 独立列表',import:'导入与对账'};return `<div class="oi-toolbar${controls?' oi-toolbar-with-filters':''}"><div class="oi-toolbar-copy"><h2>${titles[mode]||'月度库存'}</h2><p>${mode==='excluded'?'仅查阅原始记录，不汇总数量和成本，不参与采购计算':mode==='analysis'?'选择来源月份与业务范围，查看分布、月库龄与积压筛查':'按月度报表查看，顶部日期仅作用于 Amazon API 快照'}</p></div><div class="oi-toolbar-side">${controls?`<div class="oi-toolbar-filters">${controls}</div>`:''}<div class="oi-actions">${mode==='age'?button('show-analysis','返回图表分析'):''}${button('refresh','刷新',state.busy)}</div></div></div>`; }
  function filters() {
    const f=state.filters,data=state.data||{},facets=data.facets||{},periods=mode==='import'&&state.preview?(metadata().periods||data.periods||[]):(data.periods||activePeriods());
    const values=(key,title)=>[['',title],['__UNKNOWN__','待确认 / 未提供'],...(facets[key]||[]).map(x=>typeof x==='object'?[x.value??x.name??x.warehouse,x.label??x.name??x.warehouse]:[x,x])];
    return `<form class="oi-filters" data-oi-search>${select('period','库存月份',periods.map(x=>[typeof x==='object'?x.period:x,typeof x==='object'?x.period:x]),f.period||data.period)}${select('platform','平台',[['','全部平台'],...platforms.filter(x=>!['共享','待确认'].includes(x)).map(x=>[x,x]),['__SHARED__','共享平台'],['__UNKNOWN__','待确认'],...(facets.platform||[]).filter(x=>x&&!platforms.includes(x)).map(x=>[x,x])],f.platform)}${select('country','国家 / 区域',values('country','全部国家 / 区域'),f.country)}${select('warehouse','仓库',values('warehouse','全部仓库'),f.warehouse)}${select('shop','店铺',values('shop','全部店铺'),f.shop)}${select('owner','负责人',values('owner','全部负责人'),f.owner)}${select('category1','分类',values('category1','全部分类'),f.category1)}${select('searchMode','查询方式',[['auto','自动识别 SKU'],['sku','SKU 精确匹配'],['keyword','关键词包含']],f.searchMode)}<label class="oi-field oi-search"><span>主 SKU / 完整平台 SKU / 品名</span><input type="search" data-oi-keyword value="${e(state.keywordDraft)}" placeholder="如 ZG6329、ZG4721_YTUS01"></label><button class="oi-button" type="submit">查询</button>${button('reset','重置')}</form>`;
  }
  function searchContext() {
    const search=state.data?.search,keyword=search?.keyword||state.filters.keyword;
    if(!keyword)return '';
    const description=search?.mode==='sku'?'完整匹配源表领星 SKU 或平台 SKU，保留后缀，不匹配品名':search?.mode==='keyword'?'按 SKU 和品名包含查询':'请核对当前查询条件';
    return `<div class="oi-search-context" role="status"><strong>${e(search?.mode==='sku'?'SKU 精确匹配':search?.mode==='keyword'?'关键词包含':'已查询')}：${e(keyword)}</strong><span>${e(description)}；数量按 ${e(state.data?.period||state.filters.period)} 及当前平台、仓库等筛选统计。</span></div>`;
  }
  function mappingStatusName(value) {return ({PENDING:'归属待确认',HISTORICAL_UNVERIFIED:'历史归属未核实',SOURCE_CONFIRMED:'来源已确认',MANUAL_CONFIRMED:'本次人工确认'})[value]||value;}
  function qualityText(row) { const names={VALID:'正常',ISSUE:'有缺失或异常'};return Array.isArray(row.quality)?row.quality.map(x=>names[x]||label(x)).join('；'):typeof row.quality==='object'?JSON.stringify(row.quality):names[row.quality]||row.quality||''; }
  function qualityIssue(row) {return !!row.quality&&row.quality!=='VALID'&&(!Array.isArray(row.quality)||row.quality.some(x=>x!=='VALID'));}
  function rawValue(row,key) { const raw=row[`${key}Raw`]??row.extra?.[`${key}Raw`]??row.extra?.[`raw${key[0].toUpperCase()+key.slice(1)}`]; return raw; }
  function stockValue(row,key,digits=0) {
    if(num(row[key])!==null) return `<b class="oi-number${Number(row[key])<0?' oi-invalid':''}">${n(row[key],digits)}</b>${Number(row[key])<0?'<small class="oi-invalid">负值异常 · 保留原账面值</small>':''}`;
    const raw=rawValue(row,key),quality=qualityText(row);
    if(raw!==null&&raw!==undefined&&String(raw)!=='')return `<span class="oi-invalid" title="原值，未计入合计">${e(raw)}</span>`;
    if(/REF|ERROR|公式/i.test(quality))return '<span class="oi-invalid" title="公式错误，原值见问题明细">公式错误</span>';
    if(/NEGATIVE/i.test(quality))return '<span class="oi-invalid" title="异常负值，原值见来源字段">异常值</span>';
    return '<span class="oi-missing" title="原单元格空白或无有效数值；不是 0">— <small>缺失</small></span>';
  }
  function details(row) {
    const fields=[['来源口径','Excel 月度账面库存'],['原仓库',row.rawWarehouse],['平台范围',row.platformScope],['市场范围',row.marketScope],['仓库所在国',row.warehouseCountry],['数量口径',basisName(row.quantityBasis)],['归属状态',mappingStatusName(row.mappingStatus)],['归属依据',row.extra?.mappingEvidence],['依据月份',Array.isArray(row.extra?.mappingEvidencePeriods)?row.extra.mappingEvidencePeriods.join('、'):row.extra?.mappingEvidencePeriods],['排除原因',row.exclusionReason],['工作表',row.sourceSheet],['Excel 行',row.sourceRow],['月份',row.period],['平台 SKU',row.platformSku],['本地 SKU',row.localSku],['国家 / 地区',row.country],['平台',row.platform],['采购单价',row.purchasePrice],['运费单价',row.freightPrice],['原负责人',row.originalOwner],['二级分类',row.category2],['三级分类',row.category3],['备注',row.remarks],['数据问题',qualityText(row)]];
    const h=state.history;
    return `<div class="oi-details"><dl>${fields.map(([key,value])=>`<div><dt>${e(key)}</dt><dd>${e(label(value))}</dd></div>`).join('')}</dl>${row.extra?`<details><summary>查看 Excel 保留原值</summary><pre>${e(JSON.stringify(row.extra,null,2))}</pre></details>`:''}<div class="oi-section-head"><h3>月度库存历史</h3>${allowed('export')?button('export-history','导出此 SKU 历史',state.busy):''}</div>${state.historyLoading?notice('正在读取月度历史…'):state.historyError?notice(state.historyError,true)+button('retry-history','重试历史'):h?`<div class="oi-scroll"><table class="oi-table oi-history"><thead><tr><th>月份</th><th>库存数量</th><th>库存成本</th><th>币种</th><th>源行 / 问题</th></tr></thead><tbody>${(h.rows||[]).map(x=>`<tr><td>${e(x.period)}</td><td>${stockValue(x,'quantity')}</td><td>${stockValue(x,'cost',2)}</td><td>${e(x.currency==='UNKNOWN'?'待确认':x.currency||'待确认')}</td><td>${e(x.sourceRow)} · ${e(qualityText(x)||'—')}</td></tr>`).join('')}</tbody></table></div>`:''}</div>`;
  }
  function warehouseSummary() {
    const data=state.data||{},rows=data.groups||[];
    return `<details class="oi-audit oi-warehouse-summary"><summary>按平台 / 国家区域 / 仓库查看 <span>${e(data.period||'')} · ${n(rows.length)} 组</span></summary><p class="oi-help">同数量口径、同币种分别展示，原账面负值保留；电子琴已排除。共享平台与组合区域不强拆。</p>${rows.length?`<div class="oi-scroll"><table class="oi-table"><thead><tr><th>平台</th><th>国家 / 区域</th><th>仓库</th><th>数量口径</th><th>匹配记录</th><th>月度报表数量</th><th>成本 · 原币</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${e(row.platform||'待确认')}</td><td>${e(row.country||'待确认')}</td><td>${e(row.warehouse||'未标注仓库')}</td><td>${e(basisName(row.quantityBasis))}</td><td>${n(row.recordCount)}</td><td>${stockValue(row,'quantity')}${coverage(row,'quantity')}</td><td>${stockValue(row,'cost',2)} ${e(row.currency||'UNKNOWN')}${coverage(row,'cost')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="oi-help">当前筛选暂无汇总。</p>'}</details>`;
  }
  function table() {
    const data=state.data,rows=data.rows||[],pages=Math.max(1,Math.ceil(Number(data.total||0)/state.filters.pageSize));
    return `<div class="oi-section-head oi-list-heading"><span>共 ${n(data.total)} 条匹配记录 · 0 为源表保存值，— 为缺失，错误保留来源记录</span>${allowed('export')?button('export-inventory','导出全部匹配记录',state.busy):''}</div>${rows.length?`<div class="oi-scroll"><table class="oi-table"><caption class="oi-sr">月度报表库存明细</caption><thead><tr><th>主 SKU（领星）/ 品名</th><th>完整平台 SKU</th><th>平台 / 仓库</th><th>店铺 / 国家</th><th>分类 / 负责人</th><th class="oi-numeric">月度报表数量</th><th class="oi-numeric">库存成本</th><th>币种 / 质量</th><th>源表位置</th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td><strong>${e(row.localSku||'源表未提供主 SKU')}</strong><small>${e(row.productName||'未提供品名')}</small></td><td>${e(row.platformSku||'—')}</td><td>${e(row.platform||'待确认')}<small>${e(row.warehouse||'未标注仓库')} · ${e(['PENDING','HISTORICAL_UNVERIFIED'].includes(row.mappingStatus)?mappingStatusName(row.mappingStatus):'')}</small></td><td>${e(row.shop||'—')}<small>${e(row.country||'国家待确认')}</small></td><td>${e(row.category1||'—')}<small>${e(row.owner||'负责人未提供')}</small></td><td class="oi-numeric">${stockValue(row,'quantity')}</td><td class="oi-numeric">${stockValue(row,'cost',2)}</td><td>${e(row.currency==='UNKNOWN'?'待确认':row.currency||'待确认')}<small class="${qualityIssue(row)?'oi-invalid':''}">${e(qualityText(row)||'—')}</small></td><td><button type="button" class="oi-link" data-oi-row="${index}" aria-expanded="${state.expanded===index}">${state.expanded===index?'收起':row.sourceRow?`第 ${e(row.sourceRow)} 行 ↗`:'详情'}</button><small title="${e(row.sourceSheet||'来源工作表未提供')}">${e(row.period||data.period)}${row.extra?.quantityColumn?` · ${e(row.extra.quantityColumn)} 列`:''}</small></td></tr>${state.expanded===index?`<tr><td colspan="9" class="oi-detail-cell">${details(row)}</td></tr>`:''}`).join('')}</tbody></table></div>`:empty('没有匹配的库存记录','请核对月份和平台；查品名或部分编码时，可选择“关键词包含”。')}<div class="oi-pagination"><span>第 ${n(state.filters.page)} / ${n(pages)} 页</span>${select('pageSize','每页',[[50,'50 条'],[100,'100 条']],state.filters.pageSize)}${button('prev','上一页',state.filters.page<=1||state.loading)}${button('next','下一页',state.filters.page>=pages||state.loading)}</div>`;
  }
  function reconciliationCoverage(row,field) {
    const known=num(row[`${field}Known`]),unknown=num(row[`${field}Unknown`]);
    if(known===null||unknown===null)return '';
    return `<small${unknown>0?' class="oi-invalid"':''}>有效 ${n(known)} / ${n(known+unknown)} 条${unknown>0?` · 缺失或错误 ${n(unknown)} 条 · 仅有效值合计`:''}</small>`;
  }
  function auditStatus(row) {return ['INCOMPLETE','INCOMPLETE_DIFFERENCE','DIFFERENCE','SCOPE_UNMATCHED'].includes(row.status)?' class="oi-invalid"':'';}
  function totalChecksHtml(checks) {
    if(!checks.length)return '';
    const abnormal=checks.filter(row=>row.status!=='MATCHED');
    return `<details class="oi-audit" data-oi-disclosure="total-checks"${abnormal.length?' open':''}><summary>汇总表自身合计校验 · ${n(abnormal.length)} 项待核对 / ${n(checks.length)} 项</summary><p class="oi-help">核对源表 TOTAL 与源表逐项和；此表不计入库存汇总。</p><div class="oi-scroll oi-audit-scroll"><table class="oi-table"><thead><tr><th>月份 / 来源</th><th>源 TOTAL 数量</th><th>逐项数量和</th><th>数量差异</th><th>源 TOTAL 成本</th><th>逐项成本和</th><th>成本差异</th><th>状态</th></tr></thead><tbody>${checks.map(row=>`<tr><td>${e(row.period)}<small>${e(row.sourceSheet)} / 行 ${e(row.sourceRow)} · ${e(row.quantityColumn)} / ${e(row.costColumn)}</small></td><td>${n(row.declaredQuantity)}</td><td>${n(row.computedQuantity)}</td><td${num(row.quantityDifference)!==null&&num(row.quantityDifference)!==0?' class="oi-invalid"':''}>${n(row.quantityDifference)}</td><td>${n(row.declaredCost,2)}</td><td>${n(row.computedCost,2)}</td><td${num(row.costDifference)!==null&&Math.abs(num(row.costDifference))>0.01?' class="oi-invalid"':''}>${n(row.costDifference,2)}</td><td${auditStatus(row)}>${e(reconciliationStatuses[row.status]||row.status)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function issuePanel(meta, draft = false) {
    const issues=meta.issues||[],reconciliation=(meta.reconciliation||meta.summaryRows||[]).filter(row=>!row.excluded&&!/电子琴/.test([row.warehouse,row.rawWarehouse,row.category1,row.category2,row.category3].filter(Boolean).join(' '))),warnings=meta.warnings||[],checks=meta.summaryTotalChecks||[];
    if(!issues.length&&!warnings.length&&!reconciliation.length&&!checks.length)return '';
    const differences=reconciliation.filter(row=>['DIFFERENCE','INCOMPLETE_DIFFERENCE'].includes(row.status)).length,incomplete=reconciliation.filter(row=>['INCOMPLETE','INCOMPLETE_DIFFERENCE'].includes(row.status)).length,unmatched=reconciliation.filter(row=>row.status==='SCOPE_UNMATCHED').length;
    const rules=[],alerts=[];
    warnings.forEach(value=>(/^(数量及金额保留|平台、市场与|仅主明细入账|仓库对账仅)/.test(String(value))?rules:alerts).push(value));
    const cell=(row,field,digits=0)=>`<td>${n(row[field],digits)}${reconciliationCoverage(row,field)}</td>`;
    return `<details class="oi-audit"${draft?' open':''} data-oi-disclosure="audit"><summary>来源检查与汇总对账 · ${n(meta.issueCount??issues.length)} 项问题</summary><div class="oi-audit-body">${differences||incomplete||unmatched?notice(`对账：${differences} 项存在数值差异，${incomplete} 项数据不完整，${unmatched} 项范围未匹配。差异与不完整可能同时存在。`,true):''}${alerts.length?`<ul class="oi-warnings">${alerts.map(x=>`<li>${e(x)}</li>`).join('')}</ul>`:''}<details data-oi-disclosure="audit-rules"><summary>查看对账口径与来源规则</summary><p class="oi-help">汇总表用于核对明细，差异不自动调平。负值保留；空白和错误不补零；电子琴不纳入业务汇总。未确认币种仅供同表核对。公式返回0可能是来源未匹配，不能仅据此确认无库存；请结合源表核对。</p>${rules.length?`<ul class="oi-warnings">${rules.map(x=>`<li>${e(x)}</li>`).join('')}</ul>`:''}</details><div class="oi-actions">${allowed('export')?button('export-issues','导出全部问题',state.busy)+button('export-reconciliation','导出全部对账',state.busy):''}</div>${issues.length?`<div class="oi-scroll oi-audit-scroll"><table class="oi-table"><thead><tr><th>工作表 / 行</th><th>列 / 月份</th><th>类型</th><th>问题</th><th>原值</th></tr></thead><tbody>${issues.slice(0,100).map(x=>`<tr><td>${e(x.sheet)} / ${e(x.row)}</td><td>${e(x.column)}<small>${e(x.period||'')}</small></td><td>${e(x.code)}</td><td>${e(x.message)}</td><td>${e(label(x.value))}</td></tr>`).join('')}</tbody></table></div><p class="oi-help">页面最多显示前 100 项，完整问题可导出。</p>`:''}${reconciliation.length?`<div class="oi-scroll oi-audit-scroll"><table class="oi-table"><thead><tr><th>仓库 / 月份</th><th>汇总数量 / 有效覆盖</th><th>明细数量 / 有效覆盖</th><th>数量差异</th><th>汇总成本 / 有效覆盖</th><th>明细成本 / 有效覆盖</th><th>成本差异</th><th>状态</th></tr></thead><tbody>${reconciliation.map(x=>`<tr><td>${e(x.warehouse)} / ${e(x.period)}</td>${cell(x,'summaryQuantity')}${cell(x,'detailQuantity')}<td${num(x.quantityDifference)!==null&&num(x.quantityDifference)!==0?' class="oi-invalid"':''}>${n(x.quantityDifference)}</td>${cell(x,'summaryCost',2)}${cell(x,'detailCost',2)}<td${num(x.costDifference)!==null&&Math.abs(num(x.costDifference))>0.01?' class="oi-invalid"':''}>${n(x.costDifference,2)}</td><td${auditStatus(x)}>${e(reconciliationStatuses[x.status]||x.status)}</td></tr>`).join('')}</tbody></table></div>`:''}${totalChecksHtml(checks)}</div></details>`;
  }
  function settingsForm() { const s=state.settings; return `<div class="oi-settings">${field('reportYear','报告年份',s.reportYear,'可自动识别','number')}${select('currency','工作簿成本币种',[['UNKNOWN','未确认（保留原值）'],['CNY','CNY 人民币'],['USD','USD 美元'],['EUR','EUR 欧元'],['GBP','GBP 英镑'],['JPY','JPY 日元'],['CAD','CAD 加元'],['AUD','AUD 澳元'],['KRW','KRW 韩元']],s.currency,'setting')}${field('detailSheet','入账明细工作表',s.detailSheet,'自动匹配月度在库变动')}${field('summarySheet','对账汇总工作表',s.summarySheet,'自动匹配海外仓汇总')}</div><p class="oi-help">本次使用两张工作表：明细表用于入账，汇总表用于核对。预览完成后显示实际选中名称。</p>`; }
  function ageTable() {
    const rows=state.data?.rows||[],coverageNames={MISSING:'本月未提供库龄',INCOMPLETE:'分桶不完整',MATCHED:'分桶与账面数量一致',MISMATCH:'分桶与账面数量不一致'};
    return `<div class="oi-notice">按原表月份桶展示，不换算为“90 天库存”。仅本月有来源原值的分桶可用于查看；缺失值不补零，分桶与账面数量不一致时保留差异。</div><div class="oi-section-head oi-list-heading"><span>来源月份：${e(state.data?.period||'—')} · 电子琴已排除</span>${allowed('export')?button('export-inventory','导出库龄来源记录',state.busy):''}</div>${rows.length?`<div class="oi-scroll"><table class="oi-table"><thead><tr><th>SKU / 品名</th><th>平台 / 仓库</th><th>店铺 / 区域</th><th>本月来源库龄分桶</th><th>覆盖 / 一致性</th><th>来源时间与单元格</th></tr></thead><tbody>${rows.map(row=>{const buckets=Array.isArray(row.ageBuckets)?row.ageBuckets:[],coverage=row.extra?.ageCoverage||{},status=coverage.status||'MISSING';return `<tr><td><strong>${e(row.localSku||row.platformSku||'—')}</strong>${e(row.productName||'')}</td><td>${e(row.platform||'待确认')} / ${e(row.warehouse||'—')}</td><td>${e(row.shop||'—')} / ${e(row.country||'待确认')}</td><td>${buckets.length?buckets.map(bucket=>`${e(bucket.label||bucket.sourceHeader||'来源分桶')}：${num(bucket.quantity)!==null?n(bucket.quantity):e(label(bucket.raw))}${bucket.unit==='MONTH'?'（月份桶）':''}`).join('<br>'):'—（本月无来源库龄）'}</td><td class="${status==='MISMATCH'||status==='INCOMPLETE'?'oi-invalid':''}">${e(coverageNames[status]||status)}${buckets.length?`<small>有值 ${n(coverage.knownBuckets)} 桶 · 桶合计 ${n(coverage.bucketQuantity)}</small>`:''}</td><td>${e(coverage.snapshotDate||buckets[0]?.snapshotDate||'来源日期未提供')}<small>${buckets.map(bucket=>`${e(bucket.sourceSheet||row.sourceSheet)} ${e(bucket.sourceColumn||'')} / 行 ${e(bucket.sourceRow||row.sourceRow)}`).join('<br>')}</small></td></tr>`;}).join('')}</tbody></table></div>`:empty('本月暂无库龄来源记录','可切换库存月份；缺失库龄不推算。')}${pagination()}`;
  }
  function pagination(){const pages=Math.max(1,Math.ceil(Number(state.data?.total||0)/state.filters.pageSize));return `<div class="oi-pagination"><span>共 ${n(state.data?.total)} 条 · ${n(state.filters.page)} / ${n(pages)} 页</span>${button('prev','上一页',state.filters.page<=1||state.loading)}${button('next','下一页',state.filters.page>=pages||state.loading)}</div>`;}

  function mappings() {
    const entries=metadata().mappings||[];if(!entries.length)return '';const locked=settingsLocked()?' disabled':'';
    return `<details class="oi-audit" data-oi-disclosure="mapping"><summary>临时确认平台、区域与仓库归属 · ${n(entries.length)} 项</summary><p class="oi-help">按原工作表、仓库和店铺设置，只用于本次预览。组合区域（美加、欧洲）和共享平台（Temu / TikTok）可保留，不强拆；无法确认的归属保留待确认。</p><div class="oi-scroll oi-mapping-scroll"><table class="oi-table oi-mapping"><thead><tr><th>工作表 / 原仓库 / 店铺</th><th>仓库</th><th>平台</th><th>国家 / 区域</th><th>仓库所在国</th><th>平台范围 / 市场范围</th></tr></thead><tbody>${entries.map((entry,index)=>{const key=entry.mappingKey||JSON.stringify([entry.sourceSheet,entry.rawWarehouse,entry.shop]),value=state.settings.rowMappings[key]||entry.current||entry.mapping||entry;const input=(field)=>`<input data-oi-map="${index}"${locked} data-map-field="${field}" value="${e(value[field]||'')}" aria-label="${e(entry.rawWarehouse)} ${e(entry.shop)} ${field}">`;return `<tr><td>${e(entry.sourceSheet)}<strong>${e(entry.rawWarehouse)}</strong>${e(entry.shop||'未标注店铺')}<small>${e((entry.candidates||[]).join(' / '))}</small></td><td>${input('warehouse')}</td><td><select data-oi-map="${index}"${locked} data-map-field="platform" aria-label="平台">${[...new Set(['',...platforms,value.platform||''])].map(x=>`<option value="${e(x)}"${(value.platform||'')===x?' selected':''}>${e(x||'待确认')}</option>`).join('')}</select></td><td>${input('country')}</td><td>${input('warehouseCountry')}</td><td><select data-oi-map="${index}"${locked} data-map-field="platformScope" aria-label="平台范围">${[['UNKNOWN','待确认'],['SINGLE','单平台'],['SHARED','共享平台']].map(([x,t])=>`<option value="${x}"${value.platformScope===x?' selected':''}>${t}</option>`).join('')}</select><select data-oi-map="${index}"${locked} data-map-field="marketScope" aria-label="市场范围">${[['UNKNOWN','待确认'],['COUNTRY','单国家'],['COMBINED','组合国家'],['REGION','区域']].map(([x,t])=>`<option value="${x}"${value.marketScope===x?' selected':''}>${t}</option>`).join('')}</select></td></tr>`;}).join('')}</tbody></table></div></details>`;
  }
  function warehousePanel() {
    const names = {inventoryFile:'产品库存表',stockAgeFile:'库龄表',relationFile:'平台商品关联表'};
    return `<section class="oi-import"><div class="oi-section-head"><h3>海外仓三表导入</h3></div><p class="oi-help">按系统 SKU 关联产品库存、库龄和平台商品。请选择同一批次的三份下载表。</p>${Object.entries(names).map(([key,title])=>`<label class="oi-field"><span>${e(title)}</span><input type="file" accept=".xlsx" data-warehouse-file="${key}" aria-label="${e(title)}"><small>${e(warehouseFiles[key]?.name||'未选择')}</small></label>`).join('')}${button('warehouse-preview','上传并预览',state.busy||Object.keys(warehouseFiles).length!==3,true)}${warehousePreview?`<div class="oi-publish"><strong>预览：库存 ${n(warehousePreview.inventoryCount)} 条 · 库龄 ${n(warehousePreview.stockAgeCount)} 条 · 平台关联 ${n(warehousePreview.relationCount)} 条</strong><p>仓库：${e((warehousePreview.warehouses||[]).join('、'))}</p>${button('warehouse-commit','确认导入',state.busy,true)}</div>`:''}</section>`;
  }
  function warehouseTable() {
    if (!warehouseData) return '';
    const rows = warehouseData.rows || [];
    return `<section class="oi-import"><div class="oi-section-head"><h3>海外仓库存</h3><span>${e(warehouseData.importedAt||'')}</span></div><div class="oi-table-scroll"><table class="oi-table"><thead><tr><th>系统 SKU</th><th>商品名称</th><th>仓库</th><th>库存属性</th><th>总库存</th><th>可用库存</th><th>在途库存</th><th>平台关联</th><th>库龄</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${e(r.systemSku)}</td><td>${e(r.productName)}</td><td>${e(r.warehouse)}</td><td>${e(r.stockProperty)}</td><td>${n(r.totalStock)}</td><td>${n(r.availableInventory)}</td><td>${n(r.inTransitInventory)}</td><td>${(r.relations||[]).map(x=>`${e(x.platformStoreCode)} · ${e(x.platformSku)} · 数量 ${n(x.qty)}`).join("<br>")||"—"}</td><td>${(r.stockAges||[]).map(x=>`${e(x.stockAge)} · 数量 ${n(x.qty)} · 上架 ${e(x.putawayDate||"—")}`).join("<br>")||"—"}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function importPanel() {
    if(!allowed('import'))return notice('当前账号可查看库存，无导入权限。');
    const job=state.job,meta=metadata(),processing=['PROCESSING','IMPORTING'].includes(job?.status),ready=job?.status==='PREVIEW',replacement=meta.replacement||{},periods=replacement.periods||meta.periods||[];
    return `<section class="oi-import"><div class="oi-section-head"><h3>上传 → 预览对账 → 确认导入</h3><span class="oi-tag">${e(statuses[job?.status]||'选择工作簿')}</span></div><p class="oi-help">预览不会改动现有库存。确认后按所列月份覆盖，旧版本不保留；原 Excel 不长期保存，请自行保留源文件。</p><div class="oi-upload"><input type="file" accept=".xlsx" data-oi-file aria-label="选择库存 Excel"${state.busy||processing?' disabled':''}><span>${e(state.file?.name||job?.fileName||'选择 .xlsx 工作簿')}</span>${button('upload','上传并预览',state.busy||processing||!state.file,true)}</div>${settingsForm()}${meta.detailSheet&&meta.summarySheet?`<p class="oi-help">实际入账明细：<strong>${e(meta.detailSheet)}</strong> · 实际对账汇总：<strong>${e(meta.summarySheet)}</strong></p>`:''}${job?`<p class="oi-help">${n(meta.sourceRowCount)} 条来源行 · ${n(meta.rowCount)} 条月度记录 · ${e(meta.defaultPeriod?'默认月份 '+meta.defaultPeriod:'')}</p>`:''}${processing?notice('正在'+(job.status==='IMPORTING'?'导入库存，完成后自动刷新。':'解析工作簿，完成后自动显示预览。')):''}${job?.status==='FAILED'?notice(job.message||meta.message||'处理失败，请检查原文件后重试。',true):''}${ready?`${mappings()}<div class="oi-actions">${button('reconfigure','应用临时映射并重新预览',state.busy,true)}${state.settingsDirty?'<span class="oi-invalid">选项有变更，请先重新预览</span>':''}</div>${issuePanel(meta,true)}${hasBlockers()?notice('请先修正阻止导入的问题：'+meta.blockingErrors.join('；'),true):''}<div class="oi-publish"><strong>确认覆盖月份：${e(periods.map(x=>typeof x==='object'?x.period:x).join('、')||'月份未返回')}</strong><p>本次写入 ${n(replacement.rowCount??meta.rowCount)} 条记录，替换现有 ${n(replacement.existingRowCount)} 条记录。覆盖所列月份的整份 Excel 库存，不能用单平台删减文件作为局部更新；其他月份与 Amazon API 数据不受影响。所列月份的旧记录不保留。</p><label><input type="checkbox" data-oi-ack="replaceAck"${state.replaceAck?' checked':''}>我已核对月份和预览，确认覆盖，旧版本不保留</label>${hasIssues()?`<label><input type="checkbox" data-oi-ack="ack"${state.ack?' checked':''}>我已知晓来源问题、对账差异与待确认字段</label>`:''}${button('commit','确认导入',state.busy||state.settingsDirty||hasBlockers()||!periods.length||!state.replaceAck||(hasIssues()&&!state.ack),true)}</div>`:''}${job&&processing?button('retry-job','重新读取进度',state.busy):''}${job?.status==='IMPORTED'?'<button class="oi-button oi-primary" type="button" data-iw-source="overseas">查看最新库存明细</button>':''}</section>`;
  }

  function body() {
    if(!state.status)return `<div class="oi-workspace">${state.statusError?empty('月度库存暂未读取',state.statusError,button('retry-status','重新读取')):empty('正在读取月度库存','正在读取库存状态…')}</div>`;
    const filtersInHeader=['details','age','excluded'].includes(mode), filterMarkup=filtersInHeader?filters():'';
    const header=(mode==='analysis'?`<div class="oi-analysis-tools">${button('refresh','刷新分析',state.busy)}</div>`:toolbar(filterMarkup))+(state.error?notice(state.error,true):'')+(state.message?notice(state.message):'');
    if(mode==='import'&&state.job?.status!=='PREVIEW')return `<div class="oi-workspace">${header}${warehousePanel()}${warehouseTable()}${importPanel()}</div>`;
    const content=state.data?(mode==='analysis'?(window.InventoryMonthlyAnalysis?.render({...state.data,canExport:allowed('export')})||empty('图表模块暂未加载','请刷新页面后重试。')):mode==='age'?ageTable():mode==='excluded'?table():summaryHtml(state.data)+warehouseSummary()+table()):!state.dataError&&!state.loading?empty('暂无月度库存记录','可在“导入与对账”上传工作簿并确认导入。'):'';
    return `<div class="oi-workspace">${header}${mode==='import'?importPanel()+'<div class="oi-preview"><strong>临时预览 · 尚未改变当前库存</strong></div>':''}${filtersInHeader?'':filters()}${state.data&&!state.loading?searchContext():''}${state.dataError?notice(state.dataError,true)+button('reload-inventory','重试读取'):''}${state.loading?notice('正在读取月度库存…'):''}${content}</div>`;
  }
  function paint() {
    if(!root?.isConnected)return;
    const open=[...root.querySelectorAll('[data-oi-disclosure]')].map(x=>[x.dataset.oiDisclosure,x.open]);
    const active=document.activeElement,focus=root.contains(active)?{key:active.dataset.oiSetting,map:active.dataset.oiMap,field:active.dataset.mapField,start:active.selectionStart,end:active.selectionEnd}:null;
    root.innerHTML=body();
    if(mode==='analysis'&&state.data)window.InventoryMonthlyAnalysis?.mount(root,{...state.data,canExport:allowed('export')});
    open.forEach(([key,value])=>{const target=root.querySelector(`[data-oi-disclosure="${key}"]`);if(target)target.open=value;});
    if(focus&&(focus.key||focus.map!==undefined)){const target=[...root.querySelectorAll('input,select')].find(x=>focus.key?x.dataset.oiSetting===focus.key:x.dataset.oiMap===focus.map&&x.dataset.mapField===focus.field);if(target){target.focus({preventScroll:true});try{target.setSelectionRange(focus.start,focus.end);}catch(ignore){}}}
  }
  async function loadStatus(force=false) {
    if(statusTask)return statusTask;if(state.status&&!force)return state.status;
    const gen=generation;state.statusError='';
    const task=(async()=>{try{const result=await api('overseasStatus');if(gen!==generation)return;state.status=result;if(!state.filters.period)state.filters.period=result.defaultPeriod||'';return result;}catch(error){if(gen===generation){state.statusError=error.message;state.status=null;}}finally{if(gen===generation){statusTask=null;paint();}}})();statusTask=task;return task;
  }
  async function loadInventory(force=false) {
    if(!allowed('read')||(mode==='import'&&state.job?.status!=='PREVIEW'))return;
    const key=currentKey();if(!force&&state.dataKey===key&&state.data)return;if(inventoryTask?.key===key)return inventoryTask.promise;
    const gen=generation,epoch=inventoryEpoch,task={key,promise:null},query=params();inventoryTask=task;
    const valid=()=>gen===generation&&epoch===inventoryEpoch&&inventoryTask===task&&currentKey()===key;
    state.loading=true;state.dataError='';state.expanded=null;state.history=null;state.historyLoading=false;paint();
    task.promise=(async()=>{try{const result=await api('overseasInventory',query);if(!valid())return;state.data=result;state.filters.period=result.period||state.filters.period;state.dataKey=currentKey();}catch(error){if(valid()){state.dataError=error.message;state.data=null;}}finally{if(gen===generation&&epoch===inventoryEpoch&&inventoryTask===task){state.loading=false;inventoryTask=null;paint();}}})();return task.promise;
  }
  async function ensure() { await loadStatus(); if(allowed('read'))await loadInventory(); }
  function settingsPayload() { return JSON.parse(JSON.stringify({...state.settings,reportYear:state.settings.reportYear?Number(state.settings.reportYear):undefined})); }
  function submittedSettings() {state.submittedSettingsRevision=state.settingsRevision;return settingsPayload();}
  function applyJob(job) {
    state.job=job;state.preview=job.id;state.ack=false;state.replaceAck=false;state.settingsDirty=state.settingsRevision!==state.submittedSettingsRevision;
    const meta=job.metadata||{};if(mode==='import'){invalidateInventory();state.filters={...freshFilters(),period:meta.defaultPeriod||''};state.keywordDraft='';}
    if(!state.settingsDirty)state.settings={...freshSettings(),...state.settings,reportYear:meta.reportYear||state.settings.reportYear,detailSheet:meta.detailSheet||state.settings.detailSheet,summarySheet:meta.summarySheet||state.settings.summarySheet};
  }
  async function readJob(id){const gen=generation,epoch=jobReadEpoch,result=await api('overseasJob',id);if(gen!==generation||epoch!==jobReadEpoch||String(state.preview)!==String(id))return;applyJob(result);if(['PROCESSING','IMPORTING'].includes(result.status)){paint();poll(id);}else if(result.status==='IMPORTED'){state.preview=null;state.file=null;state.message='库存已导入，所列月份已覆盖，旧版本未保留。';overviewCache=null;await loadStatus(true);paint();}else{paint();await loadInventory(true);}}
  function poll(id) {window.clearTimeout(timer);const gen=generation,epoch=jobReadEpoch;timer=window.setTimeout(async()=>{try{if(gen===generation&&epoch===jobReadEpoch)await readJob(id);}catch(error){if(gen===generation&&epoch===jobReadEpoch){state.error='进度读取失败：'+error.message+'。可重新读取进度。';paint();}}},1800);}
  async function operation(fn) {
    if(state.busy)return;const gen=generation;state.busy=true;state.error='';state.message='';paint();
    try{await fn(gen);}catch(error){if(gen===generation)state.error=error.message;}finally{if(gen===generation){state.busy=false;paint();}}
  }
  function historyParams() {const row=state.data?.rows?.[state.expanded];if(!row)return null;const fields=['sourceSheet','rawWarehouse','platform','platformScope','country','marketScope','warehouse','warehouseCountry','shop','localSku','platformSku','quantityBasis','currency'];return {...Object.fromEntries(fields.map(key=>[key,row[key]??''])),...(mode==='import'&&state.preview?{previewId:state.preview}:{}),view:mode==='excluded'?'excluded':'details'};}
  async function loadHistory() { const query=historyParams();if(!query)return;const gen=generation,epoch=inventoryEpoch,key=JSON.stringify(query),valid=()=>gen===generation&&epoch===inventoryEpoch&&key===JSON.stringify(historyParams());state.historyLoading=true;state.historyError='';state.history=null;paint();try{const result=await api('overseasHistory',query);if(valid())state.history=result;}catch(error){if(valid())state.historyError=error.message;}finally{if(valid()){state.historyLoading=false;paint();}} }
  async function download(type) {
    if(!allowed('export'))return;
    await operation(async gen=>{const query=type==='history'?{...historyParams(),type}:{...params(),type};delete query.page;delete query.pageSize;const blob=await api('overseasExport',query);if(gen!==generation)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`库存_${type}_${type==='history'?'全部月份':state.filters.period||'全部月份'}.csv`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);state.message='已导出全部匹配记录，原值与数据问题随文件保留。';});
  }
  function changeFilter(key,value) {state.filters[key]=key==='pageSize'?Number(value):value;state.filters.page=1;state.expanded=null;state.history=null;state.data=null;state.dataKey='';void loadInventory();}
  async function action(name) {
    if(name==='show-age'||name==='show-analysis'){if(root?.closest('[data-iw-workspace]')&&window.InventoryWorkspace?.selectSource){window.InventoryWorkspace.selectSource(name==='show-age'?'age':'monthly-analysis');}else mount(root,name==='show-age'?'age':'analysis');return;}
    if(name==='retry-status'||name==='refresh'){await loadStatus(true);await loadInventory(true);return;}
    if(name==='reload-inventory'){await loadInventory(true);return;}
    if(name==='retry-job'&&state.preview){await operation(()=>readJob(state.preview));return;}
    if(name==='retry-history'){await loadHistory();return;}
    if(name.startsWith('export-')){await download(name.slice(7));return;}
    if(name==='prev'||name==='next'){state.filters.page+=name==='next'?1:-1;await loadInventory();return;}
    if(name==='reset'){state.keywordDraft='';state.filters={...freshFilters(),period:state.filters.period};await loadInventory(true);return;}
    if(!allowed('import'))return;
    if(name==='warehouse-preview'){await operation(async()=>{warehousePreview=await api('warehouseImport',warehouseFiles);});return;}
    if(name==='warehouse-commit'&&warehousePreview){await operation(async()=>{await api('warehouseCommit',warehousePreview.id);warehousePreview=null;warehouseFiles={};warehouseData=await api('warehouseInventory');state.message='海外仓库存已导入。';});return;}
    if(name==='upload'&&state.file){await operation(async gen=>{window.clearTimeout(timer);const result=await api('overseasImport',state.file,submittedSettings());if(gen!==generation)return;applyJob(result);if(result.status==='PROCESSING')poll(result.id);else await loadInventory(true);});return;}
    if(name==='reconfigure'&&state.job?.status==='PREVIEW'){await operation(async gen=>{const result=await api('overseasReconfigure',state.job.id,submittedSettings());if(gen!==generation)return;applyJob(result);if(result.status==='PROCESSING')poll(result.id);else await loadInventory(true);});return;}
    if(name==='commit'&&state.job?.status==='PREVIEW'&&state.replaceAck&&(!hasIssues()||state.ack)&&!state.settingsDirty&&!hasBlockers()){await operation(async gen=>{const result=await api('overseasCommit',state.job.id,{replaceAck:true,ackIssues:true});if(gen!==generation)return;applyJob(result);if(result.status==='IMPORTED'){state.preview=null;state.file=null;state.message='库存已导入，旧版本未保留。';overviewCache=null;await loadStatus(true);}else poll(result.id);});}
  }
  function prepareDetails(filters={}) {
    // Select committed inventory before mounting so the first request has the card's scope.
    jobReadEpoch++;window.clearTimeout(timer);invalidateInventory();
    state.filters={...freshFilters(),platform:String(filters.platform||''),period:String(filters.period||'')};
    state.keywordDraft='';state.dataError='';state.historyError='';state.message='';state.error='';
    mode='details';
  }
  function mount(container, nextMode = 'details') {
    binding?.abort();root=container;if(mode!==nextMode){invalidateInventory();state.filters.page=1;}mode=nextMode;if(!root)return;binding=new AbortController();const options={signal:binding.signal};paint();
    root.addEventListener('click',event=>{const target=event.target.closest('button');if(!target||target.disabled)return;if(target.dataset.oiAction){void action(target.dataset.oiAction);return;}if(target.hasAttribute('data-oi-row')){const index=Number(target.dataset.oiRow);state.expanded=state.expanded===index?null:index;state.history=null;paint();if(state.expanded!==null)void loadHistory();}},options);
    root.addEventListener('submit',event=>{if(!event.target.matches('[data-oi-search]'))return;event.preventDefault();state.keywordDraft=root.querySelector('[data-oi-keyword]')?.value||'';state.filters.keyword=state.keywordDraft;state.filters.page=1;void loadInventory(true);},options);
    root.addEventListener('input',event=>{const el=event.target;if((el.dataset.oiSetting||el.hasAttribute('data-oi-map'))&&settingsLocked())return;if(el.dataset.oiSetting){state.settings[el.dataset.oiSetting]=el.value;state.settingsDirty=!!state.job;}if(el.hasAttribute('data-oi-keyword'))state.keywordDraft=el.value;if(el.hasAttribute('data-oi-map')){const item=metadata().mappings?.[Number(el.dataset.oiMap)];if(!item)return;const key=item.mappingKey||JSON.stringify([item.sourceSheet,item.rawWarehouse,item.shop]);state.settings.rowMappings[key]={...(state.settings.rowMappings[key]||item.current||item.mapping||item),[el.dataset.mapField]:el.value};state.settingsDirty=true;}if(el.dataset.oiSetting||el.hasAttribute('data-oi-map')){state.settingsRevision++;state.ack=false;state.replaceAck=false;const commit=root.querySelector('[data-oi-action="commit"]');if(commit)commit.disabled=true;}},options);
    root.addEventListener('change',event=>{const el=event.target;if(el.dataset.warehouseFile){warehouseFiles[el.dataset.warehouseFile]=el.files?.[0];if(!warehouseFiles[el.dataset.warehouseFile])delete warehouseFiles[el.dataset.warehouseFile];warehousePreview=null;paint();return;}if(el.dataset.oiFilter){changeFilter(el.dataset.oiFilter,el.value);return;}if(el.hasAttribute('data-oi-file')){window.clearTimeout(timer);state.file=el.files?.[0]||null;state.job=null;state.preview=null;invalidateInventory();state.keywordDraft='';state.filters.keyword='';state.ack=false;state.replaceAck=false;state.settingsDirty=false;state.settings.rowMappings={};state.message='';state.error='';paint();return;}if(el.dataset.oiAck){state[el.dataset.oiAck]=el.checked;paint();return;}if(el.dataset.oiSetting||el.hasAttribute('data-oi-map'))paint();},options);void ensure();
    if((mode==='import'||mode==='details')&&!warehouseData)api('warehouseInventory').then(data=>{warehouseData=data;if(mode==='import'||mode==='details')paint();}).catch(()=>{});
    if(mode==='import'&&state.preview&&['PROCESSING','IMPORTING'].includes(state.job?.status))poll(state.preview);
  }
  function applyOverviewPlatformPagination(container) {
    const grid=container.querySelector('.oi-platform-grid');if(!grid)return;
    const cards=[...grid.querySelectorAll('.oi-platform-card')],pageSize=6,pageCount=Math.max(1,Math.ceil(cards.length/pageSize));
    state.overviewPage=Math.min(Math.max(1,Number(state.overviewPage)||1),pageCount);
    cards.forEach((card,index)=>{card.hidden=Math.floor(index/pageSize)+1!==state.overviewPage;});
    let pager=container.querySelector('[data-oi-overview-pagination]');
    if(pageCount<=1){pager?.remove();return;}
    const html=`<nav class="oi-platform-pagination" data-oi-overview-pagination aria-label="Excel 仓库与平台库存分页"><span>第 ${n(state.overviewPage)} / ${n(pageCount)} 页 · 每页 ${n(pageSize)} 个分组</span><div>${Array.from({length:pageCount},(_,index)=>{const page=index+1;return `<button type="button" class="oi-button" data-oi-overview-page="${page}" aria-current="${page===state.overviewPage?'page':'false'}">${page}</button>`;}).join('')}</div></nav>`;
    if(pager)pager.outerHTML=html;else grid.insertAdjacentHTML('afterend',html);
  }
  function mountOverview(container) {
    // The overview reads committed inventory independently from temporary import previews.
    binding?.abort();root=null;binding=new AbortController();
    container.addEventListener('click',event=>{const button=event.target.closest('[data-oi-overview-page]');if(!button||button.disabled)return;state.overviewPage=Number(button.dataset.oiOverviewPage)||1;applyOverviewPlatformPagination(container);},{signal:binding.signal});
    return mountOverviewIsolated(container);
  }
  let overviewCache=null,overviewTask=null;
  async function mountOverviewIsolated(container) {
    container.innerHTML='<div class="oi-workspace oi-overview"><div class="oi-empty">正在读取月度库存概览…</div></div>';const gen=generation;
    try{await loadStatus();if(gen!==generation||!container.isConnected)return;if(!state.status)throw new Error(state.statusError||'月度库存状态读取失败');if(!activePeriods().length){container.innerHTML=empty('月度库存 · 尚未导入','上传预览并确认导入后显示。','<button type="button" class="oi-link" data-iw-source="import">导入与对账 ↗</button>');return;}const key=String(state.status.importedAt)+':'+state.status.defaultPeriod;if(!overviewCache||overviewCache.key!==key){if(!overviewTask||overviewTask.key!==key)overviewTask={key,promise:api('overseasInventory',{period:state.status.defaultPeriod,view:'overview',page:1,pageSize:1})};const task=overviewTask,data=await task.promise;if(gen!==generation)return;overviewCache={key,data};if(overviewTask===task)overviewTask=null;}if(container.isConnected){container.innerHTML='<div class="oi-workspace oi-overview">'+summaryHtml(overviewCache.data,true)+'</div>';applyOverviewPlatformPagination(container);}}catch(error){if(gen===generation){overviewTask=null;if(container.isConnected)container.innerHTML=empty('月度库存读取失败',error.message,'<button type="button" class="oi-link" data-iw-source="overseas">进入库存明细重试 ↗</button>');}}
  }
  async function loadAllDetails(options = {}) {
    // This is read-only data for the unified product lookup.  It deliberately
    // returns separate source rows: an Excel month is never added to a live
    // platform snapshot, even when the SKU text is identical.
    await loadStatus();
    if (!state.status) throw new Error(state.statusError || '月度库存状态读取失败');
    const periods = activePeriods();
    const requested = String(options.period || state.status.defaultPeriod || '');
    if (!requested || !periods.map(item => String(typeof item === 'object' ? item.period : item)).includes(requested)) {
      return {period:'', periods, rows:[], total:0};
    }
    const shared = {
      ...freshFilters(), period:requested, view:'details', pageSize:200,
      platform:String(options.platform || ''), warehouse:String(options.warehouse || ''),
      shop:String(options.shop || ''), country:String(options.country || ''),
      category1:String(options.category1 || ''), owner:String(options.owner || ''),
      keyword:String(options.keyword || ''), searchMode:String(options.searchMode || 'auto')
    };
    const rows = [];
    let page = 1, total = 0;
    do {
      const result = await api('overseasInventory', {...shared, page});
      const pageRows = Array.isArray(result?.rows) ? result.rows : [];
      rows.push(...pageRows);
      total = Number(result?.total || 0);
      if (!pageRows.length || rows.length >= total) break;
      page += 1;
    } while (true);
    return {period:requested, periods, rows, total};
  }
  function reset() {generation++;inventoryEpoch++;window.clearTimeout(timer);binding?.abort();statusTask=null;inventoryTask=null;overviewTask=null;overviewCache=null;state=freshState();paint();}
  function replenishment() {return `<section class="oi-workspace oi-replenishment"><div class="oi-toolbar"><div><h2>采购与补货建议</h2><p>先确认库存和需求数据，再生成可执行的采购计划</p></div><span class="oi-tag">数据准备中</span></div><div class="oi-readiness">${[['库存基础','月度报表库存可在“导入与对账”核对，电子琴独立列表排除在采购计算之外。','按来源核对'],['销量与需求','已有 Amazon 历史销量，仍需与月度库存 SKU 确认关联；完整 Excel 中美客多 / Coupang 近期销量可后续扩展。','待 SKU 关联'],['采购与运输周期','供应商交期、采购周期、头程及入仓周期尚未提供。','待维护'],['MOQ / 箱规','最小起订量、装箱数及整箱约束尚未提供。','待维护'],['在途与采购单','未结采购单、调拨在途、预计到仓时间及占用数量尚未接入。','待接入']].map(([title,text,status])=>`<article><span class="oi-tag">${status}</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div><div class="oi-notice">建议采购量、补货量及安全库存暂不计算。完成 SKU 关联、需求、周期与在途数据后，再确定计算口径；缺失输入不按 0 处理。</div></section>`; }
  window.addEventListener('analytics-auth-changed',reset);
  window.OverseasInventory={mount,mountOverview,prepareDetails,reset,replenishment,loadAllDetails,getFilters:()=>({...state.filters,view:mode})};
})();
