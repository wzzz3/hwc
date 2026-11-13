(function () {
  'use strict';
  const array = value => Array.isArray(value) ? value : [];
  const number = value => value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (value, digits = 0) => number(value) === null ? '—' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits:digits});
  const currency = value => value==='BASE'||/^[A-Z]{3}$/.test(value || '') && value !== 'UNK';
  const currencyLabel = value => value==='CNY'?'元':value==='BASE'?'本位币':value;
  const colors = {amazon:'#1768ef',walmart:'#12a6b0',tiktok:'#9059e8',temu:'#e9a120'};
  const platformNames = {amazon:'Amazon',walmart:'沃尔玛 · 美国',tiktok:'TikTok · 美国',temu:'TEMU · 全托管'};
  const salesTabs = [['sales','销量分析'],['profit','利润分析']];
  const state = {platform:'all',store:'all',country:'all',keyword:'',tab:'sales',group:'product',sort:'currentUnits',direction:'desc',page:1,pageSize:20,tableHeight:440,issue:'all',selected:null,drawer:null,trendShowAmazon:true,trendDate:null,dailyOpen:false};
  const initialState={...state};
  let root = null, context = {}, view = 'cockpit', handlers = null, restoreFocus = null, periodKey='', tableResizeObserver=null, trendResizeObserver=null, trendModel=null, pageHeading=null;
  const delta = row => number(row.currentUnits) === null || number(row.previousUnits) === null ? null : Number(row.currentUnits)-Number(row.previousUnits);
  const rate = row => number(row.previousUnits) === null || Number(row.previousUnits) <= 0 || delta(row) === null ? null : delta(row)/Number(row.previousUnits)*100;
  function sumKnown(rows, field) {
    const values=rows.map(r=>number(r[field])).filter(v=>v!==null);
    return {value:values.length?values.reduce((a,b)=>a+b,0):null,known:values.length,total:rows.length,partial:values.length<rows.length};
  }
  function filterRows(rows, filters) {
    const keyword=String(filters.keyword||'').trim().toLocaleLowerCase();
    return array(rows).filter(r=>(!filters.platform||filters.platform==='all'||r.platform===filters.platform)&&(!filters.store||filters.store==='all'||String(r.storeId||r.storeName||'')===filters.store)&&(!filters.country||filters.country==='all'||r.country===filters.country)&&(!keyword||[r.sku,r.msku,r.name,r.storeName].some(v=>String(v||'').toLocaleLowerCase().includes(keyword)))&&(!filters.issue||filters.issue==='all'||(filters.issue==='decline'&&delta(r)!==null&&delta(r)<0)||(filters.issue==='mapping'&&r.mappingStatus!=='matched'))&&(!filters.selected||r.key===filters.selected||productKey(r)===filters.selected));
  }
  function profitTotals(rows) {
    const totals=new Map();
    rows.filter(r=>r.platform==='amazon'&&currency(r.currencyCode)&&number(r.profit)!==null).forEach(r=>totals.set(r.currencyCode,(totals.get(r.currencyCode)||0)+Number(r.profit)));
    return [...totals].map(([code,value])=>({currencyCode:code,value}));
  }
  const cnyValue = (row, field='revenue') => row.currencyCode==='CNY'?number(row[field]):null;
  const cnyText = (row, field='revenue') => cnyValue(row,field)===null?'—':`${fmt(cnyValue(row,field),2)} 元`;
  const cnySummary = (rows,field='revenue') => sumKnown(rows.map(row=>({amount:cnyValue(row,field)})),'amount');
  const productKey = row => {
    const sku=String(row.sku??'').trim();
    // A blank local SKU is not a safe identity: keep that source record separate.
    return 'product:'+JSON.stringify(sku?[row.platform||'',sku]:[row.platform||'','source',row.key||'']);
  };
  const sameValue = (items,field) => {
    const values=[...new Set(items.map(item=>String(item[field]??'').trim()).filter(Boolean))];
    return values.length===1?values[0]:null;
  };
  function aggregateProduct(items,key) {
    const first=items[0],current=sumKnown(items,'currentUnits'),previous=sumKnown(items,'previousUnits'),revenue=cnySummary(items),previousRevenue=cnySummary(items,'previousRevenue');
    const profits=profitTotals(items),statuses=new Set(items.map(item=>item.mappingStatus||'unmatched'));
    const currencies=[...new Set(items.map(item=>item.currencyCode??null))];
    const stores=[...new Set(items.map(item=>item.storeName).filter(Boolean))],countries=[...new Set(items.map(item=>item.country).filter(Boolean))];
    const notes=[...new Set(items.map(item=>String(item.amountNote||'').trim()).filter(Boolean))];
    const mappingStatus=statuses.size===1?[...statuses][0]:statuses.has('ambiguous')?'ambiguous':'unmatched';
    const currencyCode=currencies.length===1&&currency(currencies[0])?currencies[0]:null;
    const profit=first.platform==='amazon'&&profits.length===1&&items.every(item=>number(item.profit)!==null&&item.currencyCode===profits[0].currencyCode)?profits[0].value:null;
    const amountNote=revenue.partial||previousRevenue.partial?'部分金额、币种或汇率待核对':notes.length===1?notes[0]:notes.length?'多来源金额说明不一致，请查看来源明细':'金额或币种待核对';
    return {key,platform:first.platform,platformName:first.platformName,sku:first.sku,msku:sameValue(items,'msku'),name:sameValue(items,'name')||first.name,mappingStatus,currentUnits:current.partial?null:current.value,previousUnits:previous.partial?null:previous.value,revenue:revenue.partial?null:revenue.value,previousRevenue:previousRevenue.partial?null:previousRevenue.value,profit,currencyCode,amountNote,storeName:stores.length===1?stores[0]:stores.length?`${stores.length} 个店铺`:null,country:countries.length===1?countries[0]:countries.length?`${countries.length} 个国家/地区`:null,latestDate:sameValue(items,'latestDate'),recordCount:items.length,items};
  }
  function groupRows(rows, group) {
    if(group==='product'){
      const groups=new Map();
      rows.forEach(row=>{const key=productKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
      return [...groups].map(([key,items])=>aggregateProduct(items,key));
    }
    if(group!=='store')return rows.slice();
    const groups=new Map();
    rows.forEach(row=>{const key=JSON.stringify([row.platform,row.storeId||row.storeName||'',row.country||'']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
    return [...groups].map(([key,items])=>{const current=sumKnown(items,'currentUnits'),previous=sumKnown(items,'previousUnits'),profits=profitTotals(items),revenue=cnySummary(items),previousRevenue=cnySummary(items,'previousRevenue');return {key:'store:'+key,platform:items[0].platform,platformName:items[0].platformName,storeName:items[0].storeName,storeId:items[0].storeId,country:items[0].country,name:items[0].storeName||'未标注店铺',currentUnits:current.partial?null:current.value,previousUnits:previous.partial?null:previous.value,revenue:revenue.partial?null:revenue.value,previousRevenue:previousRevenue.partial?null:previousRevenue.value,profit:profits.length===1&&items.every(r=>number(r.profit)!==null&&r.currencyCode===profits[0].currencyCode)?profits[0].value:null,currencyCode:items.every(r=>r.currencyCode==='CNY')?'CNY':profits.length===1?profits[0].currencyCode:null,amountNote:revenue.partial?'部分金额或汇率待核对':'已换算人民币',recordCount:items.length,items};});
  }
  function sortRows(rows, field, direction) {
    const value=r=>field==='delta'?delta(r):field==='rate'?rate(r):field==='name'?String(r.sku||r.name||''):['revenue','previousRevenue'].includes(field)?cnyValue(r,field):number(r[field]);
    return rows.slice().sort((a,b)=>{const av=value(a),bv=value(b);if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;const compared=av===null?0:typeof av==='string'?av.localeCompare(bv,'zh-CN'):av-bv;return compared*(direction==='asc'?1:-1)||String(a.key).localeCompare(String(b.key));});
  }
  function csvCell(value) {let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function toCsv(rows) {
    const headers=['平台','店铺','国家','SKU','MSKU','品名','配对状态','本期销量（件）','上期销量（件）','变化（件）','变化率（%）','Amazon利润','金额口径 / 币种','来源截止日','本期销售额（人民币元）','上期销售额（人民币元）','金额换算说明','原币金额与汇率'];
    return '\uFEFF'+[headers,...rows.map(r=>[r.platformName||platformNames[r.platform]||r.platform,r.storeName,r.country,r.sku,r.msku,r.name,r.mappingStatus,r.currentUnits,r.previousUnits,delta(r),rate(r),r.platform==='amazon'?r.profit:null,currency(r.currencyCode)?r.currencyCode:null,r.latestDate,cnyValue(r),cnyValue(r,'previousRevenue'),r.amountNote,array(r.originalAmounts).length?JSON.stringify(r.originalAmounts):null])].map(row=>row.map(csvCell).join(',')).join('\r\n');
  }
  function dailyPoints(trend, platform, start, end) {
    const values=new Map(array(trend).filter(p=>p.platform===platform).map(p=>[p.date,number(p.units)]));
    const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');
    if(!Number.isFinite(first)||!Number.isFinite(last)||last<first)return [...values].sort().map(([date,units])=>({date,units}));
    const points=[];for(let at=first;at<=last;at+=86400000){const date=new Date(at).toISOString().slice(0,10);points.push({date,units:values.has(date)?values.get(date):null});}return points;
  }
  const selectedRows = (ignoreSelection=false) => filterRows(context.data?.records, {...state,selected:ignoreSelection?null:state.selected});
  const sources = () => array(context.data?.platforms).filter(p=>state.platform==='all'||p.id===state.platform);
  const hasDetailFilters = () => state.store!=='all'||state.country!=='all'||!!state.keyword.trim()||state.issue!=='all'||!!state.selected;
  const sourceName = p => typeof p.source==='string'?p.source:JSON.stringify(p.source||'来源未提供');
  const moneyText = rows => profitTotals(rows).map(p=>`${fmt(p.value,2)} ${currencyLabel(p.currencyCode)}`).join(' / ')||'—';
  const sign = value => number(value)===null?'—':`${value>0?'+':''}${fmt(value)}`;
  const rateText = row => rate(row)===null?(number(row.previousUnits)===0&&number(row.currentUnits)>0?'上期为 0': '—'):`${rate(row)>0?'+':''}${fmt(rate(row),1)}%`;
  const empty = text => `<div class="sc-empty">${esc(text)}</div>`;
  const btn = (action,text,extra='') => `<button type="button" class="sc-button" data-sc-action="${action}" ${extra}>${text}</button>`;
  function control(key,label,options) {return `<label class="sc-control"><span>${label}</span><select data-sc-filter="${key}" aria-label="${label}">${options.map(([id,name])=>`<option value="${esc(id)}"${String(state[key])===String(id)?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`;}
  function filters(isSales) {
    const records=array(context.data?.records),platforms=array(context.data?.platforms),pool=records.filter(r=>state.platform==='all'||r.platform===state.platform);
    const stores=[...new Map(pool.map(r=>[String(r.storeId||r.storeName||''),r.storeName||'未标注店铺'])).entries()].filter(([id])=>id);
    const countries=[...new Set(pool.map(r=>r.country).filter(Boolean))].sort();
    if(state.store!=='all'&&!stores.some(([id])=>id===state.store))stores.push([state.store,state.store+'（当前无数据）']);
    if(state.country!=='all'&&!countries.includes(state.country))countries.push(state.country);
    const period=`<span class="sc-period">应用日期：${esc(context.startDate||context.data?.period?.startDate||'—')} — ${esc(context.endDate||context.data?.period?.endDate||'—')}</span>`;
    const platform=control('platform','平台',[['all','全部平台'],...platforms.map(p=>[p.id,platformNames[p.id]||p.name])]);
    const status=`<span class="sc-source-note">${context.data?.complete?'来源查询完成':'来源覆盖待核对'}</span>`;
    if(isSales)return `<section class="sc-filterbar sc-sales-filterbar" aria-label="销售筛选"><div class="sc-sales-filter-scroll" tabindex="0" role="region" aria-label="销售筛选栏，窄窗口可左右滚动"><div class="sc-filter-line sc-sales-filter-line">${period}${platform}${control('store','店铺',[['all','全部店铺'],...stores])}${control('country','国家',[['all','全部国家'],...countries.map(c=>[c,c])])}<label class="sc-search"><span class="sc-sr-only">搜索 SKU、MSKU 或品名</span><input data-sc-keyword value="${esc(state.keyword)}" placeholder="SKU / MSKU / 品名" aria-label="搜索 SKU、MSKU 或品名"></label>${btn('search','查询')}${btn('reset','重置筛选')}${status}</div></div></section>`;
    return `<section class="sc-filterbar" aria-label="销售筛选"><div class="sc-filter-line">${period}${platform}${status}</div>${hasDetailFilters()?`<div class="sc-filter-line sc-muted">已保留销售页筛选：${esc([state.store!=='all'?state.store:'',state.country!=='all'?state.country:'',state.keyword,state.issue!=='all'?'问题筛选':'',state.selected?'已选商品':''].filter(Boolean).join(' · '))}${btn('reset','清除筛选')}</div>`:''}</section>`;
  }
  function summary(rows, usePlatforms=false) {
    const total=usePlatforms?sources().map(p=>({currentUnits:p.status==='ready'?p.summary?.units:null,previousUnits:p.status==='ready'?p.summary?.previousUnits:null,revenue:p.status==='ready'?p.summary?.revenue:null,previousRevenue:p.status==='ready'?p.summary?.previousRevenue:null,platform:p.id,profit:p.id==='amazon'?p.summary?.profit:null,currencyCode:p.summary?.currencyCode})):rows;
    const current=sumKnown(total,'currentUnits'),previous=sumKnown(total,'previousUnits'),pair={currentUnits:current.partial?null:current.value,previousUnits:previous.partial?null:previous.value};
    return {current,previous,pair,revenue:cnySummary(total),previousRevenue:cnySummary(total,'previousRevenue'),money:moneyText(total),profitRows:total.filter(r=>r.platform==='amazon'&&number(r.profit)!==null).length};
  }
  function coverageNotice() {
    const statuses=sources(),problem=statuses.filter(p=>p.status!=='ready');
    return problem.length||context.data?.complete===false?`<div class="sc-notice" role="status">当前仅展示已返回的有效数据；${problem.map(p=>`${esc(platformNames[p.id]||p.name)}：${p.status==='error'?'读取失败':'所选期间无可用数据'}`).join('；')||'部分来源未完整返回'}。缺失不按 0 处理。${btn('retry','重新加载')}</div>`:'';
  }
  // All visible platforms share one linear scale, including zero and signed values.
  function trendScale(values) {
    const mode='linear',valid=values.map(number).filter(v=>v!==null);
    const low=Math.min(0,...valid),high=Math.max(0,...valid);
    if(low===high)return {mode,low:0,high:3,step:1,ticks:[0,1,2,3]};
    const raw=(high-low)/3,power=10**Math.floor(Math.log10(raw));
    const step=Math.ceil(Math.max(1,([1,2,2.5,5,10].find(n=>n*power>=raw)||10)*power));
    const min=Math.floor(low/step)*step,max=Math.ceil(high/step)*step;
    const ticks=[];for(let n=0;n<=Math.round((max-min)/step);n++)ticks.push(Number((min+n*step).toPrecision(12)));
    return {mode,low:min,high:max,step,ticks};
  }
  function dailyTrendData() {
    const list=sources(),start=context.startDate||context.data?.period?.startDate,end=context.endDate||context.data?.period?.endDate;
    const series=list.map(p=>({platform:p,points:dailyPoints(context.data?.trend,p.id,start,end)}));
    // Align by date even if a caller omitted the period. Missing observations stay null.
    const dates=[...new Set(series.flatMap(s=>s.points.map(p=>p.date)))].sort();
    series.forEach(s=>{const byDate=new Map(s.points.map(p=>[p.date,p.units]));s.points=dates.map(date=>({date,units:byDate.has(date)?byDate.get(date):null}));});
    const values=series.flatMap(s=>s.points.map(p=>p.units)).filter(v=>v!==null);
    return {series,dates,values};
  }
  function dailyDataDisclosure() {
    const heading=`<summary>查看逐日数据<span>单位：件</span></summary>`;
    const {series,dates,values}=dailyTrendData();
    const body=hasDetailFilters()?empty('当前接口仅提供平台日汇总。清除店铺、国家或商品筛选后查看逐日数据。'):!values.length?empty('所选期间没有可用的逐日销量数据。'):`<div class="sc-scroll" tabindex="0" role="region" aria-label="逐日销量数据，可横向和纵向滚动"><table class="sc-table sc-daily-table"><thead><tr><th scope="col">日期</th>${series.map(s=>`<th scope="col">${esc(platformNames[s.platform.id]||s.platform.name)}（件）</th>`).join('')}</tr></thead><tbody>${dates.map((date,i)=>`<tr><td>${esc(date)}</td>${series.map(s=>`<td>${fmt(s.points[i]?.units)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<details class="sc-disclosure sc-daily-data" data-sc-daily-data${state.dailyOpen?' open':''}>${heading}${body}</details>`;
  }
  function trendCard() {
    trendModel=null;
    const title=`<div class="sc-card-head"><h3>多平台销量趋势</h3>${btn('sales','查看销量明细 →')}</div>`;
    if(hasDetailFilters())return `<section class="sc-card sc-trend-card">${title}${empty('当前接口仅提供平台日汇总；店铺、国家、商品或问题筛选下无法提供同口径趋势。清除明细筛选后查看。')}${btn('reset','清除明细筛选')}</section>`;
    const {series:allSeries,dates,values}=dailyTrendData();
    if(!values.length)return `<section class="sc-card sc-trend-card">${title}${empty('所选期间没有可用的逐日销量数据。')}</section>`;
    const canHideAmazon=allSeries.some(s=>s.platform.id==='amazon')&&allSeries.some(s=>s.platform.id!=='amazon');
    const hiddenAmazon=canHideAmazon&&!state.trendShowAmazon;
    const series=allSeries.filter(s=>!hiddenAmazon||s.platform.id!=='amazon');
    const toolbar=`<div class="sc-trend-toolbar">${canHideAmazon?`<label class="sc-trend-visibility"><input type="checkbox" data-sc-trend-amazon${state.trendShowAmazon?' checked':''} aria-describedby="sc-trend-visibility-note"><span>显示 Amazon</span></label>`:''}<span id="sc-trend-visibility-note" role="status">${hiddenAmazon?'Amazon 已隐藏，刻度按其他平台调整；汇总与逐日数据不变':canHideAmazon?'共用同一线性刻度；取消勾选可放大其他平台':'共用同一线性刻度，直接比较销量大小'}</span></div>`;
    const visibleValues=series.flatMap(s=>s.points.map(p=>p.units)).filter(v=>v!==null);
    if(!visibleValues.length)return `<section class="sc-card sc-trend-card">${title}${toolbar}${empty('当前显示的平台暂无逐日销量；可勾选 Amazon 查看其数据。')}</section>`;
    const top=38,bottom=314,height=348,axis=trendScale(visibleValues);
    const left=Math.max(70,...axis.ticks.map(v=>fmt(v).length*8+18)),rightPadding=24;
    const width=Math.max(640,left+rightPadding+(dates.length-1)*14),right=width-rightPadding;
    const x=i=>dates.length===1?(left+right)/2:left+i/(dates.length-1)*(right-left);
    const y=value=>bottom-(value-axis.low)/(axis.high-axis.low)*(bottom-top);
    const grid=axis.ticks.map(v=>`<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="${v===0?'sc-zero-gridline':'sc-gridline'}"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`).join('');
    let charts=`<g data-sc-trend-axis="left" data-scale-mode="linear" data-scale-min="${axis.low}" data-scale-max="${axis.high}"><text class="sc-trend-axis-name" x="${left}" y="16">销量（件） · 统一线性刻度</text>${grid}</g>`;
    const dash={amazon:'',walmart:'7 3',tiktok:'2 3',temu:'10 3 2 3'};
    series.forEach(s=>{
      const color=colors[s.platform.id]||'#1768ef';s.y=y;s.axis='left';
      let path='',points=[];
      const flush=()=>{if(points.length>1)path+=`<polyline data-sc-trend-series="${esc(s.platform.id)}" data-axis="${s.axis}" points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.3" stroke-dasharray="${dash[s.platform.id]||''}"/>`;points=[];};
      s.points.forEach((p,i)=>{if(p.units===null){flush();return;}points.push(`${x(i)},${y(p.units)}`);path+=`<circle class="sc-trend-dot" data-sc-trend-point="${esc(s.platform.id)}" data-axis="${s.axis}" data-date="${esc(p.date)}" data-units="${p.units}" cx="${x(i)}" cy="${y(p.units)}" r="2.3" fill="${color}"/>`;});flush();charts+=path;
    });
    const dateStride=Math.max(1,Math.ceil(66/((right-left)/Math.max(1,dates.length-1))));
    const ticks=dates.map((date,i)=>i===0||i===dates.length-1||i%dateStride===0&&dates.length-1-i>=dateStride*.7?`<text x="${x(i)}" y="${height-6}" text-anchor="middle">${esc(date.slice(5))}</text>`:'').join('');
    trendModel={series,dates,x,left,right,rightPadding,width,height};
    if(!dates.includes(state.trendDate))state.trendDate=dates[dates.length-1];
    return `<section class="sc-card sc-trend-card">${title}<p id="sc-trend-help" class="sc-trend-hint">悬停显示竖线与同日销量；点击或用 ← → 切换日期，窄窗口可左右滚动。缺失断线，真实 0 保留。</p>${toolbar}<div class="sc-trend-surface" tabindex="0" role="slider" aria-label="选择日期查看各平台销量" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="${dates.length-1}" aria-valuenow="${dates.indexOf(state.trendDate)}" aria-valuetext="${esc(state.trendDate)}" aria-describedby="sc-trend-help"><div class="sc-trend-scroll"><svg class="sc-trend sc-trend-chart" style="min-width:${width}px;height:${height}px" viewBox="0 0 ${width} ${height}" role="img" aria-label="当前显示平台的逐日销量，共用一套线性纵轴；缺失日期断线"><g data-sc-trend-plot>${charts}</g><g data-sc-trend-highlight hidden><rect data-sc-trend-band y="${top}" width="18" height="${bottom-top}"/><line data-sc-trend-cursor y1="${top}" y2="${bottom}"/><g data-sc-trend-markers></g></g>${ticks}</svg></div><div class="sc-trend-tooltip" hidden><strong data-sc-trend-date></strong><div>${series.map(s=>`<div class="sc-trend-tooltip-row"><i style="background:${colors[s.platform.id]||'#1768ef'}"></i><span>${esc(platformNames[s.platform.id]||s.platform.name)}</span><b data-sc-trend-value="${esc(s.platform.id)}">—</b><small>件</small></div>`).join('')}</div><p>— 表示数据缺失</p></div></div><div class="sc-trend-legend">${series.map(s=>`<span><svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="${colors[s.platform.id]||'#1768ef'}" stroke-width="2.3" stroke-dasharray="${dash[s.platform.id]||''}"/></svg>${esc(platformNames[s.platform.id]||s.platform.name)}${s.points.every(p=>p.units===null)?'（暂无数据）':''}</span>`).join('')}</div></section>`;
  }
  function showTrendDate(index,clientY,scrollToDate=false) {
    const model=trendModel,surface=root?.querySelector('.sc-trend-surface');if(!model||!surface)return;
    const at=Math.max(0,Math.min(model.dates.length-1,index)),date=model.dates[at];state.trendDate=date;
    const svg=surface.querySelector('svg'),scroll=surface.querySelector('.sc-trend-scroll'),tooltip=surface.querySelector('.sc-trend-tooltip');
    const scale=svg.getBoundingClientRect().width/model.width,px=model.x(at)*scale;
    if(scrollToDate&&(px<scroll.scrollLeft+model.left*scale||px>scroll.scrollLeft+scroll.clientWidth-24))scroll.scrollLeft=Math.max(0,px-scroll.clientWidth/2);
    const cursor=surface.querySelector('[data-sc-trend-cursor]');cursor.setAttribute('x1',model.x(at));cursor.setAttribute('x2',model.x(at));
    surface.querySelector('[data-sc-trend-band]').setAttribute('x',model.x(at)-9);
    surface.querySelector('[data-sc-trend-highlight]').removeAttribute('hidden');
    surface.querySelector('[data-sc-trend-markers]').innerHTML=model.series.filter(s=>s.points[at]?.units!==null).map(s=>`<circle cx="${model.x(at)}" cy="${s.y(s.points[at].units)}" r="4.5" fill="${colors[s.platform.id]||'#1768ef'}" stroke="white" stroke-width="2"/>`).join('');
    tooltip.querySelector('[data-sc-trend-date]').textContent=date;
    model.series.forEach(s=>{tooltip.querySelector(`[data-sc-trend-value="${s.platform.id}"]`).textContent=fmt(s.points[at]?.units);});
    surface.setAttribute('aria-valuenow',at);surface.setAttribute('aria-valuetext',`${date}；${model.series.map(s=>`${platformNames[s.platform.id]||s.platform.name} ${s.points[at]?.units===null?'数据缺失':fmt(s.points[at]?.units)+'件'}`).join('；')}`);
    tooltip.hidden=false;
    const box=surface.getBoundingClientRect(),svgBox=svg.getBoundingClientRect(),cursorX=svgBox.left-box.left+px,tipWidth=tooltip.offsetWidth;
    const preferred=cursorX+16+tipWidth<=box.width?cursorX+16:cursorX-tipWidth-16;
    tooltip.style.left=`${Math.max(4,Math.min(box.width-tipWidth-4,preferred))}px`;
    const preferredY=Number.isFinite(clientY)?clientY-box.top+16:Number(tooltip.dataset.top||32);
    const top=Math.max(4,Math.min(box.height-tooltip.offsetHeight-4,preferredY));tooltip.style.top=`${top}px`;tooltip.dataset.top=top;
  }
  function trendPointer(event) {
    if(event.type==='pointermove'&&event.pointerType==='touch')return;
    const surface=event.target.closest?.('.sc-trend-surface');if(!surface||!root?.contains(surface)||!trendModel||event.target.closest('.sc-trend-tooltip'))return;
    const svg=surface.querySelector('svg'),box=svg.getBoundingClientRect(),local=(event.clientX-box.left)/box.width*trendModel.width;
    const index=trendModel.dates.length===1?0:Math.round((local-trendModel.left)/(trendModel.right-trendModel.left)*(trendModel.dates.length-1));
    showTrendDate(index,event.clientY);
  }
  function hideTrendTooltip() {
    const surface=root?.querySelector('.sc-trend-surface');if(!surface)return;
    const tooltip=surface.querySelector('.sc-trend-tooltip');if(tooltip)tooltip.hidden=true;
    surface.querySelector('[data-sc-trend-highlight]')?.setAttribute('hidden','');
  }
  function trendLeave(event) {
    // Touch pointers leave after a tap; keep that readout until an outside tap or cancellation.
    if(event.type==='pointerout'&&event.pointerType==='touch')return;
    const surface=event.target.closest?.('.sc-trend-surface');
    if(surface&&root?.contains(surface)&&(!event.relatedTarget||!surface.contains(event.relatedTarget)))hideTrendTooltip();
  }
  function trendOutside(event) {if(!event.target.closest?.('.sc-trend-surface')||!root?.contains(event.target))hideTrendTooltip();}
  function trendVisibility() {if(document.hidden)hideTrendTooltip();}
  function trendFocus(event) {if(event.target.matches('.sc-trend-surface:focus-visible')&&trendModel)showTrendDate(trendModel.dates.indexOf(state.trendDate),undefined,true);}
  function trendScroll(event) {if(event.target.matches?.('.sc-trend-scroll')&&trendModel&&!root.querySelector('.sc-trend-tooltip')?.hidden)showTrendDate(trendModel.dates.indexOf(state.trendDate));}
  function observeTrend() {
    trendResizeObserver?.disconnect();trendResizeObserver=null;
    const surface=root?.querySelector('.sc-trend-surface');if(!surface||!trendModel)return;
    const minimum=trendModel.width;
    const resize=()=>{
      const model=trendModel;if(!model||!root?.contains(surface))return;
      const svg=surface.querySelector('svg'),width=Math.max(minimum,surface.clientWidth),oldRight=model.right,newRight=width-model.rightPadding;
      if(width===model.width)return;
      const mapX=value=>value<model.left?value:value>oldRight?newRight+(value-oldRight):model.left+(value-model.left)/(oldRight-model.left)*(newRight-model.left);
      svg.querySelectorAll('[x],[x1],[x2],[cx]').forEach(el=>{for(const attr of ['x','x1','x2','cx'])if(el.hasAttribute(attr))el.setAttribute(attr,mapX(Number(el.getAttribute(attr))));});
      svg.querySelectorAll('polyline').forEach(el=>el.setAttribute('points',el.getAttribute('points').split(' ').map(pair=>{const [x,y]=pair.split(',');return `${mapX(Number(x))},${y}`;}).join(' ')));
      model.width=width;model.right=newRight;model.x=i=>model.dates.length===1?(model.left+newRight)/2:model.left+i/(model.dates.length-1)*(newRight-model.left);
      svg.setAttribute('viewBox',`0 0 ${width} ${model.height}`);
      if(!surface.querySelector('.sc-trend-tooltip').hidden)showTrendDate(model.dates.indexOf(state.trendDate));
    };
    resize();if(typeof ResizeObserver!=='undefined'){trendResizeObserver=new ResizeObserver(resize);trendResizeObserver.observe(surface);}
  }

  function issuesCard() {
    const rows=selectedRows(),items=[];
    sources().forEach(p=>{const scoped=rows.filter(r=>r.platform===p.id),tot=hasDetailFilters()?summary(scoped).pair:{currentUnits:p.summary?.units,previousUnits:p.summary?.previousUnits};if(delta(tot)!==null&&delta(tot)<0)items.push({title:`${platformNames[p.id]||p.name}销量回落`,text:`较上期 ${rateText(tot)} · 变化 ${sign(delta(tot))} 件`,platform:p.id,issue:'decline',tab:'sales'});if(p.status==='error')items.push({title:`${p.name}来源读取失败`,text:p.error||'请重试或检查来源状态',platform:p.id,issue:'all',tab:'sales'});});
    return `<section class="sc-card sc-issues-card"><div class="sc-card-head"><h3>优先关注</h3><span class="sc-badge">${items.length} 项</span></div><div class="sc-issues">${items.length?items.map(i=>`<button type="button" class="sc-issue" data-sc-issue="${i.issue}" data-sc-platform="${esc(i.platform)}" data-sc-tab="${i.tab}"><strong>${esc(i.title)}</strong><span>${esc(i.text)}</span><b>查看分析 →</b></button>`).join(''):empty('当前可用数据未发现销量回落或来源读取失败。')}</div><p class="sc-muted">点击问题，携带当前日期与筛选进入销售分析。</p>${dailyDataDisclosure()}</section>`;
  }
  function cockpit() {
    const rows=selectedRows(),s=summary(rows,!hasDetailFilters()),days=number(context.data?.period?.days),ready=sources().filter(p=>p.status==='ready'&&number(p.summary?.units)!==null).length;
    return filters(false)+coverageNotice()+`<div class="sc-metrics"><section class="sc-card sc-metric"><span>有效销量${s.current.partial?' · 已知部分':''}</span><strong>${fmt(s.current.value)}<small> 件</small></strong><p>较上期 <b class="${delta(s.pair)<0?'sc-negative':'sc-positive'}">${rateText(s.pair)}</b> · 日均 ${fmt(days>0&&s.current.value!==null?s.current.value/days:null,1)} 件</p></section><section class="sc-card sc-metric"><span>销售额 · 人民币${s.revenue.partial?' · 已知部分':''}</span><strong class="sc-money">${fmt(s.revenue.value,2)}<small> 元</small></strong><p>仅计已确认的人民币金额，待核对金额保留 —</p></section><section class="sc-card sc-metric"><span>Amazon 利润 · 当前范围</span><strong class="sc-money">${esc(s.money)}</strong><p>仅 Amazon · 人民币以元显示</p></section><section class="sc-card sc-metric"><span>销量来源覆盖</span><strong>${ready}<small> / ${sources().length} 个平台</small></strong><p>有效来源 / 当前选择来源</p></section></div><div class="sc-overview-grid">${trendCard()}${issuesCard()}</div><section class="sc-card"><div class="sc-card-head"><h3>平台表现</h3><span class="sc-muted">统一日期 · 来源与利润范围分别说明</span></div><div class="sc-platform-grid">${array(context.data?.platforms).map(p=>{const filtered=filterRows(context.data?.records,{...state,platform:p.id});const metric=hasDetailFilters()?summary(filtered):summary([],false);const units=hasDetailFilters()?metric.current.value:p.status==='ready'?number(p.summary?.units):null,pair=hasDetailFilters()?metric.pair:{currentUnits:units,previousUnits:p.summary?.previousUnits};return `<article class="sc-platform" style="--sc-platform-color:${colors[p.id]||'#1768ef'}"><h4>${esc(platformNames[p.id]||p.name)}</h4><div class="sc-platform-number">${fmt(units)} <small>件</small><span class="${delta(pair)<0?'sc-negative':'sc-positive'}">${rateText(pair)}</span></div><p>销售额 ${esc(hasDetailFilters()?(metric.revenue.value===null?'—':`${fmt(metric.revenue.value,2)} 元${metric.revenue.partial?'（已知部分）':''}`):cnyText(p.summary||{}))}</p><p>${p.id==='amazon'?`利润 ${esc(hasDetailFilters()?metric.money:moneyText([{platform:'amazon',profit:p.summary?.profit,currencyCode:p.summary?.currencyCode}]))}`:'利润 — · 待成本与费用'}</p><p>${esc(p.amountNote||'金额或币种待核对')}</p><small>数据截止：${esc(p.latestDate||'未提供')} · ${p.status==='ready'?'已接入':p.status==='error'?'读取失败':'暂无数据'}</small><button type="button" class="sc-link" data-sc-platform-nav="${esc(p.id)}">查看分析 →</button></article>`;}).join('')}</div><p class="sc-muted">TEMU 仅全托管；Amazon 与 TEMU 已确认金额以人民币元展示。Walmart、TikTok 缺少币种依据，暂不折算。</p></section>`;
  }
  function bars() {
    const rows=sortRows(groupRows(selectedRows(true),'product').filter(r=>delta(r)!==null),'delta','asc'),chosen=rows.length>8?[...rows.slice(0,4),...rows.slice(-4)]:rows,max=Math.max(1,...chosen.map(r=>Math.abs(delta(r))));
    return `<section class="sc-card"><div class="sc-card-head"><h3>与前一等长周期比较 · 变化（件）</h3></div>${chosen.length?`<div class="sc-bars">${chosen.map(r=>{const d=delta(r);return `<button type="button" class="sc-bar-row${state.selected===r.key?' is-selected':''}" data-sc-select="${esc(r.key)}" aria-label="选择 ${esc(r.sku||r.msku||r.name||'来源记录')}，销量变化 ${sign(d)} 件"><span class="sc-bar-name">${esc(r.sku||r.msku||r.name||'来源记录')}</span><span class="sc-bar-track"><i class="sc-zero"></i><i class="sc-bar-fill ${d<0?'is-negative':''}" style="left:${d<0?50-Math.abs(d)/max*48:50}%;width:${Math.abs(d)/max*48}%"></i></span><b class="${d<0?'sc-negative':'sc-positive'}">${sign(d)} 件</b></button>`;}).join('')}</div>`:empty('当前筛选没有可比较的两期商品销量。')}<p class="sc-reading">${rows.length>8?'展示变化最小与最大的各 4 条；':''}点击商品联动明细及摘要，再次点击取消选择。上期缺失的商品不参与变化比较。</p></section>`;
  }
  function scopedSummary(rows) {
    const s=summary(rows),amazon=rows.filter(r=>r.platform==='amazon'),profitKnown=amazon.filter(r=>number(r.profit)!==null&&currency(r.currencyCode)).length;
    const pendingPlatforms=[...new Set(rows.filter(r=>r.platform!=='amazon').map(r=>r.platform))];
    const profitNote=[amazon.length?`Amazon 利润有效 ${fmt(profitKnown)} / ${fmt(amazon.length)} 条记录。`:'',pendingPlatforms.length?`${pendingPlatforms.map(id=>platformNames[id]||id).join('、')}：利润待补成本与费用，显示 —。`:''].filter(Boolean).join(' ');
    const profitField=rows.length?`<div><dt>${amazon.length?'Amazon 利润'+(profitKnown<amazon.length?'（已知部分）':''):'利润'}</dt><dd>${amazon.length?esc(s.money):'—'}</dd></div>`:'';
    return `<section class="sc-card"><h3>当前筛选摘要</h3><dl class="sc-summary"><div><dt>本期销量${s.current.partial?'（已知部分）':''}</dt><dd>${fmt(s.current.value)} 件</dd></div><div><dt>上期销量${s.previous.partial?'（已知部分）':''}</dt><dd>${fmt(s.previous.value)} 件</dd></div><div><dt>变化率</dt><dd class="${delta(s.pair)<0?'sc-negative':'sc-positive'}">${rateText(s.pair)}</dd></div><div><dt>销售额 · 人民币${s.revenue.partial?'（已知部分）':''}</dt><dd>${fmt(s.revenue.value,2)} 元</dd></div><div><dt>上期销售额 · 人民币${s.previousRevenue.partial?'（已知部分）':''}</dt><dd>${fmt(s.previousRevenue.value,2)} 元</dd></div>${profitField}</dl><p class="sc-muted">匹配 ${fmt(rows.length)} 条；本期有效 ${fmt(s.current.known)} 条，上期有效 ${fmt(s.previous.known)} 条。${profitNote?` ${esc(profitNote)}`:''}</p>${rows.length?btn('profit','查看利润分析 →'):''}</section>`;
  }
  function table(rows,profitOnly=false) {
    const grouped=sortRows(groupRows(rows,state.group),state.sort,state.direction),pages=Math.max(1,Math.ceil(grouped.length/state.pageSize));state.page=Math.min(state.page,pages);const visible=grouped.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
    const header=(field,title)=>`<th scope="col" aria-sort="${state.sort===field?(state.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" data-sc-sort="${field}">${title} ${state.sort===field?(state.direction==='asc'?'↑':'↓'):'↕'}</button></th>`;
    return `<section class="sc-card sc-product-table"><div class="sc-card-head"><h3>${profitOnly?'Amazon 商品利润明细':'商品销售明细'}</h3><div class="sc-inline">${control('group','分组',[['product','按商品'],['store','按店铺']])}${btn('table-height',state.tableHeight>442?'还原高度':'展开表格','aria-controls="sc-product-scroll"')}${btn('export','导出全部匹配来源记录',rows.length?'':'disabled')}</div></div><div class="sc-table-note"><span>匹配 ${fmt(rows.length)} 条来源记录 · ${fmt(grouped.length)} 个${state.group==='store'?'店铺':'平台商品'}分组${state.selected?' · 图表已选商品':''}${state.issue==='decline'?' · 销量下降':state.issue==='mapping'?' · 配对待核对':''}；导出保留全部来源行</span>${state.selected?btn('clear-selection','取消商品选择'):''}${state.issue!=='all'?btn('clear-issue','取消问题筛选'):''}</div><div class="sc-scroll" id="sc-product-scroll" tabindex="0" role="region" aria-label="销售明细，可横向和纵向滚动" style="height:${state.tableHeight}px"><table class="sc-table"><thead><tr>${header('name',state.group==='store'?'店铺 / 平台':'SKU / 品名')}<th scope="col">店铺 / 国家</th>${header('currentUnits','本期销量（件）')}${header('previousUnits','上期销量（件）')}${header('delta','变化（件）')}${header('rate','变化率')}${header('revenue','销售额（人民币元）')}<th scope="col">利润 · 金额口径</th><th scope="col">操作</th></tr></thead><tbody>${visible.length?visible.map(r=>`<tr class="${state.selected===r.key?'is-selected':''}" data-sc-row="${esc(r.key)}"><td><strong>${esc(state.group==='store'?r.name:r.sku||r.msku||'待核对来源商品')}</strong><small>${esc(state.group==='store'?platformNames[r.platform]||r.platformName:r.name||'品名未提供')}</small>${state.group==='product'?`<small class="sc-row-platform">${esc(platformNames[r.platform]||r.platformName||r.platform)} · 同平台本地 SKU 汇总</small>`:''}${state.group==='product'&&r.mappingStatus!=='matched'?`<span class="sc-tag">${r.mappingStatus==='ambiguous'?'一对多待核对':'未配对'}</span>`:''}</td><td>${esc(r.storeName||'未标注店铺')}<small>${esc(r.country||'国家未提供')}${r.recordCount?` · ${r.recordCount} 条来源`:''}</small></td><td>${fmt(r.currentUnits)}</td><td>${fmt(r.previousUnits)}</td><td class="${delta(r)<0?'sc-negative':'sc-positive'}">${sign(delta(r))}</td><td class="${delta(r)<0?'sc-negative':'sc-positive'}">${rateText(r)}</td><td title="${esc(r.amountNote||'金额或币种待核对')}">${fmt(cnyValue(r),2)}</td><td>${r.platform==='amazon'&&currency(r.currencyCode)&&number(r.profit)!==null?`${fmt(r.profit,2)} ${esc(currencyLabel(r.currencyCode))}`:'—'}</td><td>${state.group==='store'?`<button type="button" class="sc-link" data-sc-store-nav="${esc(r.storeId||r.storeName||'')}" data-sc-platform="${esc(r.platform)}">查看商品 →</button>`:`<button type="button" class="sc-link" data-sc-details="${esc(r.key)}">查看 ${fmt(r.recordCount)} 条来源 →</button>`}</td></tr>`).join(''):'<tr><td colspan="9"><div class="sc-empty">当前筛选没有匹配记录。可调整日期、平台或清除筛选。</div></td></tr>'}</tbody></table></div><p class="sc-table-resize-note">拖动表格右下角调整高度；可在表格内横向、纵向滚动，或使用“展开表格 / 还原高度”按钮。</p><div class="sc-pagination"><span>缺失值不按 0 处理；商品或店铺分组中任一来源缺失时，对应汇总显示 —。</span><div class="sc-inline">${control('pageSize','每页',[['20','20 条'],['50','50 条'],['100','100 条']])}${btn('previous','上一页',state.page<=1?'disabled':'')}<span>第 ${state.page} / ${pages} 页</span>${btn('next','下一页',state.page>=pages?'disabled':'')}</div></div></section>`;
  }
  function profit() {
    const rows=selectedRows(),amazon=rows.filter(r=>r.platform==='amazon');
    if(!amazon.length)return `<section class="sc-card"><h3>利润分析</h3>${empty(rows.length?'当前筛选平台的成本与费用尚未补齐，暂无法计算利润。销售额可在销量分析中查看。':'当前筛选没有可用的利润记录。请检查来源状态或调整筛选。')}</section>`;
    return `<section class="sc-card sc-profit-intro"><div><h3>利润分析</h3><p>Amazon 利润仅展示具有有效汇率依据的人民币金额；已换算数据不重复乘汇率。下方摘要和明细仅统计当前筛选中的 Amazon 记录。</p><p class="sc-muted">TEMU 已接入销售额及人民币汇率；销售额不能代替利润。Walmart、TikTok、TEMU 尚缺完整成本与费用，利润显示 —。</p></div>${btn('amazon-profit','打开现有 Amazon 利润功能 →')}</section>${scopedSummary(amazon)}${table(amazon,true)}`;
  }
  function sales() {
    const rows=selectedRows();
    if(!salesTabs.some(([id])=>id===state.tab))state.tab='sales';
    return filters(true)+coverageNotice()+`<div class="sc-tabs" role="tablist" aria-label="销售与利润分析">${salesTabs.map(([id,title])=>`<button type="button" role="tab" id="sc-tab-${id}" aria-selected="${state.tab===id}" aria-controls="sc-tabpanel" tabindex="${state.tab===id?0:-1}" data-sc-tab="${id}">${title}</button>`).join('')}</div><div id="sc-tabpanel" role="tabpanel" aria-labelledby="sc-tab-${state.tab}">${state.tab==='profit'?profit():`<div class="sc-sales-grid">${bars()}${scopedSummary(rows)}</div>${table(rows)}`}</div>`;
  }
  function drawer() {
    const all=array(context.data?.records),scoped=filterRows(all,{...state,selected:null});
    const row=groupRows(scoped,'product').find(r=>r.key===state.drawer)||all.find(r=>r.key===state.drawer);if(!row)return '';
    const items=array(row.items).length?row.items:[row];
    const source=array(context.data?.platforms).find(p=>p.id===row.platform);
    const fields=[['平台',platformNames[row.platform]||row.platformName],['本地 SKU',row.sku],['品名',row.name],['来源记录数',`${items.length} 条`],['店铺范围',row.storeName],['国家范围',row.country],['配对状态',row.mappingStatus==='matched'?'已配对':row.mappingStatus==='ambiguous'?'一对多待核对':'未配对或状态不一致'],['本期销量',`${fmt(row.currentUnits)} 件`],['上期销量',`${fmt(row.previousUnits)} 件`],['销量变化',`${sign(delta(row))} 件`],['本期销售额（人民币）',cnyText(row)],['上期销售额（人民币）',cnyText(row,'previousRevenue')],['金额说明',row.amountNote],['Amazon 利润',row.platform==='amazon'&&currency(row.currencyCode)&&number(row.profit)!==null?`${fmt(row.profit,2)} ${currencyLabel(row.currencyCode)}`:'—（缺少已确认利润或币种）'],['数据来源',source?sourceName(source):null]];
    const sourceRows=items.map(item=>`<tr><td>${esc(item.storeName||'未标注店铺')}<small>${esc(item.country||'国家未提供')}</small></td><td>${esc(item.msku||item.sku||'—')}<small>${esc(item.key||'—')}</small></td><td>${fmt(item.currentUnits)}</td><td>${fmt(item.previousUnits)}</td><td>${cnyText(item)}</td><td>${item.platform==='amazon'&&currency(item.currencyCode)&&number(item.profit)!==null?`${fmt(item.profit,2)} ${esc(currencyLabel(item.currencyCode))}`:'—'}</td></tr>`).join('');
    const originalAmounts=items.flatMap(item=>array(item.originalAmounts).map(amount=>({...amount,sourceKey:item.key})));
    return `<div class="sc-drawer-backdrop" data-sc-backdrop><section class="sc-drawer" role="dialog" aria-modal="true" aria-labelledby="sc-drawer-title" tabindex="-1"><div class="sc-card-head"><h3 id="sc-drawer-title">商品销售详情</h3>${btn('close-drawer','关闭','aria-label="关闭商品详情"')}</div><dl>${fields.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`).join('')}</dl><h4>来源记录清单（${fmt(items.length)} 条）</h4><div class="sc-scroll" tabindex="0" role="region" aria-label="商品来源记录清单"><table class="sc-table"><thead><tr><th>店铺 / 国家</th><th>MSKU / 来源键</th><th>本期</th><th>上期</th><th>销售额</th><th>利润</th></tr></thead><tbody>${sourceRows}</tbody></table></div>${originalAmounts.length?`<h4>原币金额与换算依据</h4><dl>${originalAmounts.map(a=>`<div><dt>${esc(a.currencyCode||'币种未确认')}<small>${esc(a.sourceKey||'')}</small></dt><dd>本期 ${fmt(a.currentAmount,2)}；上期 ${fmt(a.previousAmount,2)}<br>折人民币汇率：${fmt(a.rateToCny,6)}${a.rateDate?` · ${esc(a.rateDate)}`:''}</dd></div>`).join('')}</dl>`:''}<p class="sc-muted">按平台 + 本地 SKU 汇总；来源行不去重，导出也保留当前筛选下的全部来源记录。</p></section></div>`;
  }
  function render(nextView,nextContext) {
    const nextPeriod=JSON.stringify([nextContext?.startDate,nextContext?.endDate]);if(nextPeriod!==periodKey){state.page=1;state.drawer=null;periodKey=nextPeriod;}
    view=nextView==='sales'?'sales':'cockpit';context=nextContext||{};trendModel=null;
    let content='';
    if(context.phase==='loading'||context.phase==='idle')content=`<section class="sc-card sc-loading" role="status"><span class="sc-spinner"></span><h3>正在加载销售数据</h3><p>读取所选日期范围内的各平台来源…</p></section>`;
    else if(context.phase==='error')content=`<section class="sc-card sc-empty" role="alert"><h3>销售数据暂时无法加载</h3><p>${esc(context.error?.message||context.error||'请稍后重试')}</p>${btn('retry','重新加载')}</section>`;
    else content=view==='sales'?sales():cockpit();
    if(context.refreshing)content=`<div class="sc-notice" role="status">正在更新，继续显示本范围上次成功读取的数据。</div>${content}`;
    else if(context.refreshError)content=`<div class="sc-notice" role="alert">刷新失败，当前为本范围上次成功结果，可能已过期：${esc(context.refreshError)}。${btn('retry','重新加载')}</div>${content}`;
    return `<div class="sc-workspace" data-sc-view="${view}"><header class="sc-page-heading"><div><h2>${view==='sales'?'销售与利润':'经营驾驶舱'}</h2><p>${view==='sales'?'按商品和店铺查明原因，按成本与费用核对利润':'看经营结果，定位需要处理的问题'}</p></div>${view==='sales'?btn('cockpit','← 返回驾驶舱'):btn('retry',context.refreshing?'正在更新…':'↻ 数据更新',context.refreshing||context.phase==='loading'||context.phase==='idle'?'disabled':'')}</header>${content}${drawer()}</div>`;
  }
  function clearPageHeading() {
    if(!pageHeading)return;
    pageHeading.action?.removeEventListener('click',click);
    pageHeading.description.remove();pageHeading.action?.remove();pageHeading.host.classList.remove('sc-route-label');pageHeading=null;
  }
  function syncPageHeading() {
    clearPageHeading();
    const header=root?.querySelector('.sc-page-heading'),title=root?.ownerDocument?.getElementById('routeTitle');
    const host=title?.closest('.route-label'),actions=title?.closest('.topbar')?.querySelector('.topbar-right');
    // Standalone previews keep their own heading; the app uses its existing global heading.
    if(!header||!host||!actions||root.contains(host))return;
    const description=header.querySelector('p'),action=header.querySelector('button');
    if(!description)return;
    description.classList.add('sc-route-description');host.classList.add('sc-route-label');host.appendChild(description);
    if(action){action.classList.add('sc-header-action');actions.prepend(action);action.addEventListener('click',click);}
    pageHeading={host,description,action};header.remove();
  }
  function repaint(focusSelector) {if(!root)return;tableResizeObserver?.disconnect();trendResizeObserver?.disconnect();root.innerHTML=render(view,context);syncPageHeading();observeTableHeight();observeTrend();if(focusSelector){const target=root.querySelector(focusSelector)||(pageHeading?.action?.matches(focusSelector)?pageHeading.action:null);target?.focus();}}
  function navigate(next) {state.drawer=null;context.onNavigate?.(next);}
  function exportRows() {
    const rows=sortRows(selectedRows().filter(r=>state.tab!=='profit'||r.platform==='amazon'),state.sort,state.direction),blob=new Blob([toCsv(rows)],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`sales-${context.startDate||'period'}-${context.endDate||''}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function closeDrawer(){state.drawer=null;repaint();if(restoreFocus)root?.querySelector(`[data-sc-details="${CSS.escape(restoreFocus)}"]`)?.focus();}
  function click(event) {
    const el=event.target.closest('button,[data-sc-backdrop]');if(!el){trendPointer(event);return;}if(!root.contains(el)&&el!==pageHeading?.action)return;
    if(el.hasAttribute('data-sc-backdrop')){if(event.target===el)closeDrawer();return;}
    if(el.dataset.scDetails!==undefined){restoreFocus=el.dataset.scDetails;state.drawer=restoreFocus;repaint('[data-sc-action="close-drawer"]');return;}
    if(el.dataset.scSort){state.direction=state.sort===el.dataset.scSort&&state.direction==='desc'?'asc':'desc';state.sort=el.dataset.scSort;state.page=1;repaint(`[data-sc-sort="${state.sort}"]`);return;}
    if(el.dataset.scSelect!==undefined){state.selected=state.selected===el.dataset.scSelect?null:el.dataset.scSelect;state.page=1;repaint(`[data-sc-select="${CSS.escape(el.dataset.scSelect)}"]`);return;}
    if(el.dataset.scIssue){state.platform=el.dataset.scPlatform;state.issue=el.dataset.scIssue;state.tab=el.dataset.scTab;state.selected=null;state.page=1;navigate('sales');return;}
    if(el.dataset.scPlatformNav){state.platform=el.dataset.scPlatformNav;state.selected=null;state.page=1;state.tab='sales';navigate('sales');return;}
    if(el.dataset.scStoreNav!==undefined){state.platform=el.dataset.scPlatform;state.store=el.dataset.scStoreNav;state.group='product';state.page=1;repaint();return;}
    if(el.dataset.scTab){if(!salesTabs.some(([id])=>id===el.dataset.scTab))return;state.tab=el.dataset.scTab;state.page=1;repaint(`[data-sc-tab="${state.tab}"]`);return;}
    switch(el.dataset.scAction){case 'retry':if(!context.refreshing&&!['idle','loading'].includes(context.phase))context.onRetry?.();return;case 'sales':navigate('sales');return;case 'cockpit':navigate('cockpit');return;case 'amazon-profit':context.onOpenAmazonProfit?.();return;case 'close-drawer':closeDrawer();return;case 'profit':state.tab='profit';state.page=1;break;case 'search':state.keyword=root.querySelector('[data-sc-keyword]')?.value||'';state.selected=null;state.page=1;break;case 'reset':Object.assign(state,{platform:'all',store:'all',country:'all',keyword:'',issue:'all',selected:null,page:1});break;case 'clear-selection':state.selected=null;state.page=1;break;case 'clear-issue':state.issue='all';state.page=1;break;case 'previous':state.page=Math.max(1,state.page-1);break;case 'next':state.page++;break;case 'export':exportRows();return;case 'table-height':state.tableHeight=state.tableHeight>442?440:800;repaint('[data-sc-action="table-height"]');return;default:return;}repaint();
  }
  function change(event) {
    if(event.target.dataset.scTrendAmazon!==undefined){
      state.trendShowAmazon=event.target.checked;
      repaint('[data-sc-trend-amazon]');
      return;
    }
    const key=event.target.dataset.scFilter;if(!key)return;state[key]=key==='pageSize'?Number(event.target.value):event.target.value;state.page=1;if(['platform','store','country'].includes(key))state.selected=null;repaint(`[data-sc-filter="${key}"]`);
  }
  function keydown(event) {
    if(event.key==='Tab'&&event.target.closest?.('.sc-trend-surface'))hideTrendTooltip();
    if(event.target.matches('.sc-trend-surface')&&trendModel){
      if(event.key==='Escape'){event.preventDefault();hideTrendTooltip();return;}
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const current=trendModel.dates.indexOf(state.trendDate),index=event.key==='Home'?0:event.key==='End'?trendModel.dates.length-1:current+(['ArrowRight','ArrowUp'].includes(event.key)?1:-1);showTrendDate(index,undefined,true);return;}
    }
    if(event.key==='Escape'&&state.drawer){event.preventDefault();closeDrawer();return;}
    if(state.drawer&&event.key==='Tab'){const focusables=[...root.querySelectorAll('.sc-drawer button,.sc-drawer [tabindex="0"]')];const first=focusables[0],last=focusables[focusables.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;}
    if(event.target.matches('[data-sc-keyword]')&&event.key==='Enter'){state.keyword=event.target.value;state.selected=null;state.page=1;repaint('[data-sc-keyword]');}
    if(event.target.getAttribute('role')==='tab'&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=salesTabs.map(([id])=>id),at=Math.max(0,tabs.indexOf(state.tab));state.tab=event.key==='Home'?tabs[0]:event.key==='End'?tabs[tabs.length-1]:tabs[(at+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];state.page=1;repaint(`[data-sc-tab="${state.tab}"]`);}
  }
  function observeTableHeight(){
    tableResizeObserver?.disconnect();tableResizeObserver=null;
    const area=root?.querySelector('.sc-product-table .sc-scroll');
    if(!area||typeof ResizeObserver==='undefined')return;
    tableResizeObserver=new ResizeObserver(()=>{
      if(!root||!root.contains(area))return;
      const height=Math.round(area.getBoundingClientRect().height);
      if(height>0){state.tableHeight=height;const button=root?.querySelector('[data-sc-action="table-height"]');if(button)button.textContent=height>442?'还原高度':'展开表格';}
    });
    tableResizeObserver.observe(area);
  }
  function unmount(){
    tableResizeObserver?.disconnect();tableResizeObserver=null;trendResizeObserver?.disconnect();trendResizeObserver=null;
    if(root&&handlers){for(const [type,handler] of Object.entries(handlers))root.removeEventListener(type,handler,['scroll','toggle'].includes(type));}
    document.removeEventListener?.('pointerdown',trendOutside,true);document.removeEventListener?.('visibilitychange',trendVisibility);window.removeEventListener?.('blur',hideTrendTooltip);
    clearPageHeading();hideTrendTooltip();root=null;handlers=null;
  }
  function mount(container,nextContext){
    unmount();root=container;context=nextContext||context;
    handlers={click,change,keydown,pointermove:trendPointer,pointerout:trendLeave,pointercancel:hideTrendTooltip,focusin:trendFocus,focusout:trendLeave,scroll:trendScroll,toggle:event=>{if(event.target.matches('[data-sc-daily-data]'))state.dailyOpen=event.target.open;}};
    for(const [type,handler] of Object.entries(handlers))root.addEventListener(type,handler,['scroll','toggle'].includes(type));
    document.addEventListener?.('pointerdown',trendOutside,true);document.addEventListener?.('visibilitychange',trendVisibility);window.addEventListener?.('blur',hideTrendTooltip);
    syncPageHeading();observeTableHeight();observeTrend();
  }
  function reset(){Object.assign(state,initialState);restoreFocus=null;periodKey='';}
  window.SalesCockpit={render,mount,unmount,reset,model:{number,delta,rate,sumKnown,filterRows,profitTotals,groupRows,sortRows,csvCell,toCsv,dailyPoints,trendScale}};
})();
