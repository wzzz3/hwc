(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value);
  const fmt = (value, digits = 0) => num(value) === null ? '—' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits:digits});
  const basisLabel = value => value === 'SOURCE_SIGNED_STOCK' ? '月度报表原值（含负值）' : value || '数量口径待确认';
  const colors = ['#367ee8','#66a6ee','#59bfc0','#e8b65a','#bd7c91'];
  const array = value => Array.isArray(value) ? value : [];
  const unique = values => [...new Set(values)];
  const empty = message => `<div class="ima-empty">${esc(message)}</div>`;
  const select = (name, title, options, value) => `<label class="ima-control"><span>${esc(title)}</span><select data-ima-control="${name}" aria-label="${esc(title)}">${options.map(([key,label])=>`<option value="${esc(key)}"${String(key)===String(value)?' selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
  const known = (row, field) => num(row?.[field]) !== null && (num(row?.[`${field}Known`]) === null || Number(row[`${field}Known`]) > 0);
  const currencyKnown = value => /^[A-Z]{3}$/.test(value || '') && value !== 'UNK';
  function trendGroups(month) { return array(month?.summary?.quantityByBasis).length ? month.summary.quantityByBasis : array(month?.groups); }
  function riskGroups(data) {
    const map = new Map();
    array(data.analysis?.ageRiskRows).forEach(row => {
      if (!currencyKnown(row.currency) || !(num(row.cost)>0) || num(row.oldShare) === null || row.oldShare<0 || row.oldShare>1) return;
      const key=JSON.stringify([row.quantityBasis || '',row.currency]);
      if (!map.has(key)) map.set(key,{key,quantityBasis:row.quantityBasis,currency:row.currency,rows:[]});
      map.get(key).rows.push(row);
    });
    return [...map.values()];
  }
  function initial(data) {
    const basis=array(data.groups)[0]?.quantityBasis||'';
    return {dimension:'platform',metric:'quantity',basis,currency:array(data.groups).find(x=>(x.quantityBasis||'')===basis&&currencyKnown(x.currency))?.currency || '',age:'0',trendBasis:array(data.analysis?.trend).flatMap(trendGroups)[0]?.quantityBasis || '',risk:riskGroups(data)[0]?.key || '',selection:'all',selectedIndex:null,page:1};
  }
  function panel(title, eyebrow, controls, content, help, extra = '') {
    return `<section class="ima-card ${extra}"><div class="ima-card-heading"><div><span class="ima-eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3></div>${controls?`<div class="ima-controls">${controls}</div>`:''}</div>${content}<p class="ima-reading">${help}</p></section>`;
  }
  function distribution(data, ui) {
    const source=array(data.groups),bases=unique(source.map(x=>x.quantityBasis||'')),currencies=unique(source.filter(x=>(x.quantityBasis||'')===ui.basis).map(x=>x.currency).filter(currencyKnown));
    const controls=select('dimension','分组',[['platform','平台'],['warehouse','仓库']],ui.dimension)+select('metric','指标',[['quantity','报表数量'],['cost','库存成本']],ui.metric)+select('basis','数量口径',bases.map(x=>[x,basisLabel(x)]),ui.basis)+(ui.metric==='cost'?select('currency','原币',currencies.map(x=>[x,x]),ui.currency):'');
    const map=new Map();
    source.filter(row=>(row.quantityBasis||'')===ui.basis&&(ui.metric!=='cost'||currencyKnown(row.currency)&&row.currency===ui.currency)).forEach(row=>{
      const key=row[ui.dimension]||'待确认',item=map.get(key)||{label:key,value:0,valid:0,records:0};
      item.records+=num(row.recordCount)||0;
      if(known(row,ui.metric)){item.value+=Number(row[ui.metric]);item.valid+=num(row[`${ui.metric}Known`])??num(row.recordCount)??1;}
      map.set(key,item);
    });
    const rows=[...map.values()].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
    const lo=Math.min(0,...rows.filter(x=>x.valid).map(x=>x.value)),hi=Math.max(0,...rows.filter(x=>x.valid).map(x=>x.value)),range=hi-lo||1,zero=(0-lo)/range*100;
    const content=rows.length?`<div class="ima-bars" role="img" aria-label="${esc(ui.dimension==='platform'?'平台':'仓库')}库存${ui.metric==='cost'?'成本':'数量'}分布，负值向左、正值向右">${rows.map(row=>{const end=(row.value-lo)/range*100;return `<div class="ima-bar-row"><span class="ima-bar-label" title="${esc(row.label)}">${esc(row.label)}</span><div class="ima-bar-track"><i class="ima-zero" style="left:${zero}%"></i>${row.valid?`<i class="ima-bar${row.value<0?' ima-bar-negative':''}" style="left:${Math.min(zero,end)}%;width:${Math.abs(end-zero)}%"></i>`:''}</div><span class="ima-bar-value">${row.valid?fmt(row.value,ui.metric==='cost'?2:0):'—'}<small>有效 ${fmt(row.valid)} / ${fmt(row.records)} 条</small></span></div>`;}).join('')}</div>`:empty(ui.metric==='cost'?'当前筛选没有已确认币种的成本。请在导入时确认币种。':'当前筛选没有可展示的分组。');
    return panel('库存分布',data.period||'来源月份',controls,content,`条形长度表示${ui.metric==='cost'?esc(ui.currency)+' 原币成本':'同口径报表数量'}，负值向左保留。${ui.metric==='cost'?'未确认币种不参与金额图。':''}合计覆盖全部匹配记录；有效数不足时仅合计有效值。`);
  }
  function age(data, ui) {
    const a=data.analysis?.age||{},groups=array(a.groups),g=groups[Number(ui.age)];
    const coverage=`<div class="ima-coverage"><strong>${fmt(a.eligibleRecords)} <span>/ ${fmt(data.summary?.recordCount)} 条可分析</span></strong><span>缺失 ${fmt(a.missingRecords)} · 不完整 ${fmt(a.incompleteRecords)} · 不一致 ${fmt(a.mismatchRecords)} · 负值 ${fmt(a.negativeRecords)}</span></div>`;
    let content=empty('本月没有完整且与报表数量一致的月库龄样本。可查看来源明细核对缺失与差异。');
    if(g&&num(g.totalQuantity)>0&&array(g.quantities).every(x=>num(x)!==null&&x>=0)) {
      let offset=0;const perimeter=2*Math.PI*70;
      const arcs=g.quantities.map((value,index)=>{const length=value/g.totalQuantity*perimeter,result=`<circle cx="110" cy="110" r="70" fill="none" stroke="${colors[index%colors.length]}" stroke-width="26" stroke-dasharray="${length} ${perimeter-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 110 110)"><title>${esc(g.labels?.[index])}：${fmt(value)}（${fmt(value/g.totalQuantity*100,1)}%）</title></circle>`;offset+=length;return result;}).join('');
      content=`<div class="ima-age-chart"><svg viewBox="0 0 220 220" role="img" aria-label="来源月库龄构成">${arcs}<text x="110" y="107" text-anchor="middle" class="ima-ring-total">${fmt(g.totalQuantity)}</text><text x="110" y="130" text-anchor="middle" class="ima-svg-muted">样本库存数量</text></svg><ul class="ima-legend">${g.quantities.map((value,index)=>`<li><i style="background:${colors[index%colors.length]}"></i><span>${esc(g.labels?.[index]||'来源月桶')}</span><b>${fmt(value/g.totalQuantity*100,1)}%</b><small>${fmt(value)}</small></li>`).join('')}</ul></div>`;
    }
    return panel('来源月库龄构成','样本覆盖',groups.length?select('age','数量口径',groups.map((x,i)=>[i,`${basisLabel(x.quantityBasis)} · ${fmt(x.recordCount)} 条`]),ui.age):'',coverage+content,`${esc(a.limitation||'来源月龄分桶，快照时点未统一确认，不换算为精确天数。')}仅数量为正、月桶完整非负且合计一致的记录入图；其余记录按首个未满足的条件分类。<button type="button" class="oi-link" data-oi-action="show-age">查看月库龄来源明细 ↗</button>`);
  }
  function monthIndex(period) { const m=/^(\d{4})-(\d{2})$/.exec(period||'');return m&&+m[2]>=1&&+m[2]<=12?+m[1]*12+(+m[2]-1):null; }
  function monthName(index) {return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;}
  function trend(data, ui) {
    const raw=array(data.analysis?.trend),bases=unique(raw.flatMap(x=>trendGroups(x).map(g=>g.quantityBasis||''))),controls=select('trendBasis','数量口径',bases.map(x=>[x,basisLabel(x)]),ui.trendBasis);
    const months=new Map(raw.map(x=>[monthIndex(x.period),x]).filter(x=>x[0]!==null));
    const indices=[...months.keys()].sort((a,b)=>a-b);
    if(!indices.length)return panel('月度库存趋势','按来源月观察',controls,empty('当前筛选没有可用的月度历史。导入更多月份后可观察变化。'),'折线表示月度账面数量；库存周转天数需要销售成本与可比平均存货。','ima-wide');
    const points=[];
    for(let i=indices[0];i<=indices[indices.length-1];i++){const month=months.get(i),group=trendGroups(month).find(x=>(x.quantityBasis||'')===ui.trendBasis);points.push({period:monthName(i),value:known(group,'quantity')?num(group.quantity):null,group});}
    const values=points.map(x=>x.value).filter(x=>x!==null);
    if(!values.length)return panel('月度库存趋势','按来源月观察',controls,empty('此数量口径没有有效月度数量。'),'缺失月份与无有效值月份留空，不补零。','ima-wide');
    let low=Math.min(0,...values),high=Math.max(0,...values);if(low===high)high=low+1;
    const px=index=>54+index/Math.max(1,points.length-1)*570,py=value=>199-(value-low)/(high-low)*167;
    let paths='',segment=[];const flush=()=>{if(segment.length>1)paths+=`<polyline points="${segment.join(' ')}" fill="none" stroke="#367ee8" stroke-width="2.5"/>`;segment=[];};
    points.forEach((p,i)=>{if(p.value===null){flush();return;}segment.push(`${px(i)},${py(p.value)}`);});flush();
    const ticks=[low,(low+high)/2,high].map(v=>`<line x1="54" x2="624" y1="${py(v)}" y2="${py(v)}" class="ima-grid-line"/><text x="46" y="${py(v)+4}" text-anchor="end" class="ima-svg-muted">${fmt(v)}</text>`).join('');
    const xTicks=unique([0,...points.map((_,i)=>i).filter(i=>i%Math.max(1,Math.ceil(points.length/5))===0),points.length-1]);
    const svg=`<svg class="ima-trend" viewBox="0 0 660 238" role="img" aria-label="月度账面库存数量趋势，缺失月份断线">${ticks}${paths}${points.map((p,i)=>p.value===null?'':`<circle cx="${px(i)}" cy="${py(p.value)}" r="4" fill="#367ee8"><title>${esc(p.period)}：${fmt(p.value)}；有效 ${fmt(p.group?.quantityKnown)} / ${fmt(p.group?.recordCount)} 条</title></circle>`).join('')}${xTicks.map(i=>`<text x="${px(i)}" y="222" text-anchor="middle" class="ima-svg-muted">${points[i].period}</text>`).join('')}</svg>`;
    const table=`<details class="ima-data-disclosure"><summary>查看各月数量及覆盖</summary><div class="oi-scroll"><table class="oi-table"><thead><tr><th>来源月</th><th>报表数量</th><th>有效 / 匹配记录</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.period}</td><td>${fmt(p.value)}</td><td>${fmt(p.group?.quantityKnown)} / ${fmt(p.group?.recordCount)}</td></tr>`).join('')}</tbody></table></div></details>`;
    return panel('月度库存趋势','全部匹配记录 · 按月汇总',controls,svg+table,'折线升降表示月度账面数量变化；缺月份或无有效数量时断线。各月采用相同筛选，跨月商品归属尚未核实，变化也可能来自报表覆盖范围调整。','ima-wide');
  }
  function selectedRisk(data,ui) {
    const group=riskGroups(data).find(x=>x.key===ui.risk),rows=group?.rows||[],sorted=rows.map(x=>Number(x.cost)).sort((a,b)=>a-b),mid=Math.floor(sorted.length/2),median=sorted.length?(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2):null;
    const quadrant=row=>`${Number(row.oldShare)>=0.5?'old':'new'}-${Number(row.cost)>=median?'high':'low'}`;
    const selected=ui.selectedIndex!==null?rows.filter((_,i)=>i===ui.selectedIndex):ui.selection==='all'?rows:rows.filter(row=>quadrant(row)===ui.selection);
    return {group,rows,median,quadrant,selected};
  }
  const quadrantNames={'all':'全部可分析商品','old-high':'高月龄占比 · 高金额','new-high':'低月龄占比 · 高金额','old-low':'高月龄占比 · 低金额','new-low':'低月龄占比 · 低金额'};
  function risk(data,ui) {
    const groups=riskGroups(data),{group,rows,median,quadrant,selected}=selectedRisk(data,ui),controls=select('risk','数量口径 / 原币',groups.map(x=>[x.key,`${basisLabel(x.quantityBasis)} · ${x.currency}`]),ui.risk);
    if(!rows.length)return `<section class="ima-card ima-wide ima-risk-unavailable"><div class="ima-card-heading"><div><span class="ima-eyebrow">可分析样本 0 条</span><h3>积压风险 × 库存金额</h3></div></div><p>当前筛选需补充完整且一致的月库龄、已确认归属、已确认币种和正库存成本。</p><span>库龄合格后因归属 / 币种 / 成本未满足条件排除 ${fmt(data.analysis?.ageRiskExcludedRecords)} 条。</span></section>`;
    let content=empty('当前筛选没有可用于金额矩阵的记录。需要完整且一致的月库龄、已确认归属、已确认币种和正库存成本。');
    if(rows.length){
      const high=rows.reduce((maximum,row)=>Math.max(maximum,Number(row.cost)),0)*1.08,x=share=>62+share*548,y=value=>209-value/high*174,my=y(median),mx=x(.5);
      const regions=[['new-high',62,35,mx-62,my-35],['old-high',mx,35,610-mx,my-35],['new-low',62,my,mx-62,209-my],['old-low',mx,my,610-mx,209-my]].map(([key,left,top,width,height])=>`<rect x="${left}" y="${top}" width="${width}" height="${height}" class="ima-quadrant ima-${key}" data-ima-quadrant="${key}" tabindex="0" role="button" aria-label="查看${quadrantNames[key]}商品"><title>${quadrantNames[key]} · ${fmt(rows.filter(r=>quadrant(r)===key).length)} 条</title></rect>`).join('');
      const svg=`<svg class="ima-matrix" viewBox="0 0 660 258" role="group" aria-label="月库龄占比与库存金额矩阵">${regions}<line x1="${mx}" x2="${mx}" y1="35" y2="209" class="ima-threshold"/><line x1="62" x2="610" y1="${my}" y2="${my}" class="ima-threshold"/><text x="62" y="19" class="ima-svg-muted">库存成本 · ${esc(group.currency)}</text><text x="54" y="213" text-anchor="end" class="ima-svg-muted">0</text><text x="54" y="${my+4}" text-anchor="end" class="ima-svg-muted">${fmt(median)}</text><text x="54" y="39" text-anchor="end" class="ima-svg-muted">${fmt(high)}</text>${[0,.5,1].map(v=>`<text x="${x(v)}" y="229" text-anchor="middle" class="ima-svg-muted">${v*100}%</text>`).join('')}<text x="336" y="250" text-anchor="middle" class="ima-svg-muted">6 个月及以上来源月桶占比 →</text>${rows.map((row,i)=>`<circle class="ima-risk-point${ui.selectedIndex===i?' is-selected':''}" cx="${x(Number(row.oldShare))}" cy="${y(Number(row.cost))}" r="${ui.selectedIndex===i?6:4}" data-ima-point="${i}" tabindex="0" role="button" aria-label="${esc(row.localSku||row.platformSku||row.productName||'来源记录')}，月龄占比 ${fmt(row.oldShare*100,1)}%，${fmt(row.cost,2)} ${esc(group.currency)}"><title>${esc(row.localSku||row.platformSku||'未提供SKU')} · ${esc(row.productName)}\n${fmt(row.oldShare*100,1)}% / ${fmt(row.cost,2)} ${esc(group.currency)}\n${esc(row.platform)} / ${esc(row.warehouse)}</title></circle>`).join('')}</svg>`;
      const chips=`<div class="ima-quadrant-actions">${Object.entries(quadrantNames).map(([key,title])=>`<button type="button" data-ima-quadrant="${key}" class="${ui.selection===key&&ui.selectedIndex===null?'is-active':''}">${title}<b>${fmt(key==='all'?rows.length:rows.filter(r=>quadrant(r)===key).length)}</b></button>`).join('')}</div>`;
      const pageCount=Math.max(1,Math.ceil(selected.length/25)),page=Math.min(ui.page,pageCount),pageRows=selected.slice((page-1)*25,page*25);
      content=svg+chips+`<div class="ima-risk-detail" aria-live="polite"><div class="ima-detail-heading"><strong>${ui.selectedIndex!==null?'选中商品':quadrantNames[ui.selection]} · ${fmt(selected.length)} 条</strong>${data.canExport&&selected.length?'<button type="button" class="oi-button" data-ima-export>导出此清单</button>':''}</div>${selected.length?`<div class="oi-scroll"><table class="oi-table"><thead><tr><th>商品 / SKU</th><th>平台 / 仓库 / 店铺</th><th>报表数量</th><th>6个月及以上数量 / 占比</th><th>成本 · ${esc(group.currency)}</th><th>来源</th></tr></thead><tbody>${pageRows.map(row=>`<tr><td><strong>${esc(row.localSku||row.platformSku||'未标注 SKU')}</strong><small>${esc(row.productName||'未提供品名')}</small></td><td>${esc(row.platform||'待确认')}<small>${esc(row.warehouse||'未标注仓库')} / ${esc(row.shop||'—')}</small></td><td>${fmt(row.quantity)}</td><td>${fmt(row.oldQuantity)} / ${fmt(row.oldShare*100,1)}%</td><td>${fmt(row.cost,2)}</td><td>${esc(row.sourceSheet||'—')}<small>行 ${esc(row.sourceRow||'—')} · ${esc(row.period||data.period)}</small></td></tr>`).join('')}</tbody></table></div><div class="ima-detail-pagination"><span>第 ${page} / ${pageCount} 页</span><button type="button" class="oi-button" data-ima-page="${page-1}"${page<=1?' disabled':''}>上一页</button><button type="button" class="oi-button" data-ima-page="${page+1}"${page>=pageCount?' disabled':''}>下一页</button></div>`:empty('此象限没有匹配的商品。')}</div>`;
    }
    return panel('积压风险 × 库存金额','点击商品点或象限查看清单',controls,`<div class="ima-coverage"><strong>${fmt(rows.length)} <span>条当前口径样本</span></strong><span>库龄合格后，因归属 / 币种 / 成本未满足条件排除 ${fmt(data.analysis?.ageRiskExcludedRecords)} 条</span></div>`+content,`右侧表示 6 个月及以上来源月桶占比较高，上方表示金额较高。分界为 50% 占比${median===null?'':`与当前同口径、同币种样本成本中位数 ${fmt(median,2)} ${esc(group.currency)}`}，仅用于相对筛查，不是采购结论。每个点代表一条来源商品记录。`,'ima-wide ima-risk-card');
  }
  function content(data,ui) {
    return `<div class="ima-heading-note"><span>${esc(data.period||'未选择月份')} · Excel 月度账面库存</span><span>全部 ${fmt(data.summary?.recordCount)} 条匹配记录参与汇总 · 电子琴已排除</span></div><div class="ima-grid">${distribution(data,ui)}${age(data,ui)}${trend(data,ui)}${risk(data,ui)}</div><div class="ima-turnover-note"><strong>库存周转天数 · 待补充数据</strong><span>需同期间销售成本及同口径平均库存金额；月度数量趋势与月库龄不替代周转天数。</span></div>`;
  }
  function render(data) {return `<div class="ima-workspace">${data.analysis?content(data,initial(data)):empty('月度分析数据暂未返回，请刷新或检查月度分析服务。')}</div>`;}
  function exportRows(data, ui) {
    if(!data.canExport)return;
    const {selected}=selectedRisk(data,ui),fields=[['月份','period'],['本地SKU','localSku'],['平台SKU','platformSku'],['品名','productName'],['平台','platform'],['仓库','warehouse'],['原仓库','rawWarehouse'],['国家地区','country'],['店铺','shop'],['数量口径','quantityBasis'],['账面数量','quantity'],['6个月及以上来源月桶数量','oldQuantity'],['6个月及以上来源月桶占比','oldShare'],['库存成本','cost'],['币种','currency'],['来源工作表','sourceSheet'],['来源行','sourceRow']];
    const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)&&typeof value!=='number')text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
    const csv='\uFEFF'+[fields.map(x=>cell(x[0])).join(','),...selected.map(row=>fields.map(([,key])=>cell(key==='period'?row[key]||data.period:row[key])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download=`月度库存筛查_${data.period||'来源月'}.csv`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function mount(container,data) {
    const host=container.querySelector('.ima-workspace');if(!host||!data.analysis)return;
    const ui=initial(data),paint=()=>{host.innerHTML=content(data,ui);};
    host.addEventListener('change',event=>{const target=event.target,key=target.dataset.imaControl;if(!key)return;ui[key]=target.value;if(key==='basis'){const currencies=unique(array(data.groups).filter(x=>(x.quantityBasis||'')===ui.basis).map(x=>x.currency).filter(currencyKnown));if(!currencies.includes(ui.currency))ui.currency=currencies[0]||'';}if(key==='risk'){ui.selection='all';ui.selectedIndex=null;ui.page=1;}paint();});
    const activate=event=>{const target=event.target.closest('[data-ima-quadrant],[data-ima-point],[data-ima-page],[data-ima-export]');if(!target||target.disabled)return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(event.type==='keydown'&&target.tagName==='BUTTON')return;if(event.type==='keydown')event.preventDefault();if(target.hasAttribute('data-ima-export')){exportRows(data,ui);return;}if(target.hasAttribute('data-ima-quadrant')){ui.selection=target.dataset.imaQuadrant;ui.selectedIndex=null;ui.page=1;}else if(target.hasAttribute('data-ima-point')){ui.selectedIndex=Number(target.dataset.imaPoint);ui.page=1;}else ui.page=Math.max(1,Number(target.dataset.imaPage));paint();};
    host.addEventListener('click',activate);host.addEventListener('keydown',activate);
  }
  window.InventoryMonthlyAnalysis={render,mount};
})();
