(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v);
  const fmt = (v,d=0) => num(v) === null ? '—' : Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
  const colors = ['#367ee8','#73a7ed','#a6c7f3','#d3e0f1','#b8c4d3'];
  const pct = (a,b) => b>0 ? `${fmt(a/b*100,1)}%` : '—';
  function model(rows, snap) {
    // Shared warehouse stock has no audited shop allocation or shop sales key.
    // Keep it visible in the scope summary, outside shop-level forecast buckets.
    rows=rows.filter(r=>!r.sharedWarehouse);
    const days = rows.filter(r=>num(r.forecastSellableDays)!==null&&num(r.forecastSellableDays)>=0);
    const thresholds=[10,20,30,45,60,Infinity],labels=['0–10天','10–20天','20–30天','30–45天','45–60天','60天以上'];
    const bins=thresholds.map((upper,i)=>({label:labels[i],rows:days.filter(r=>(i?r.forecastSellableDays>thresholds[i-1]:r.forecastSellableDays>=0)&&r.forecastSellableDays<=upper)}));
    const stocked=rows.filter(r=>(r.available===null||r.available>=0)&&(r.fbm===null||r.fbm>=0)&&(r.available>0||r.fbm>0));
    const known=stocked.filter(r=>snap.salesStatsAvailable!==false&&r.observed===30&&r.sales!==null&&r.sales>=0);
    const moving=known.filter(r=>r.sales>0),idle=known.filter(r=>r.sales===0);
    const partial=stocked.filter(r=>snap.salesStatsAvailable!==false&&r.observed>0&&r.observed<30&&r.sales!==null&&r.sales>=0);
    const unknown=stocked.filter(r=>!known.includes(r)&&!partial.includes(r));
    const candidates=days.filter(r=>snap.salesStatsAvailable!==false&&r.observed===30&&r.sales!==null&&r.sales>=0);
    const positive=candidates.map(r=>r.sales).filter(v=>v>0).sort((a,b)=>a-b);
    const middle=Math.floor(positive.length/2),median=positive.length?(positive.length%2?positive[middle]:(positive[middle-1]+positive[middle])/2):null;
    const quads=[{id:'watch',title:'关注销售',hint:'覆盖较充足 · 销量较高',color:'blue'},{id:'urgent',title:'优先核查补货',hint:'覆盖不足14天 · 销量较高',color:'red'},{id:'stable',title:'常规观察',hint:'覆盖较充足 · 销量较低',color:'muted'},{id:'review',title:'核对供需',hint:'覆盖不足14天 · 销量较低',color:'amber'}].map((q,i)=>({...q,rows:median===null?[]:candidates.filter(r=>(r.forecastSellableDays<14)===(i%2===1)&&(r.sales>=median)===(i<2))}));
    return {rows,days,bins,average:days.length?days.reduce((s,r)=>s+Number(r.forecastSellableDays),0)/days.length:null,stocked,moving,idle,partial,unknown,candidates,median,quads,totalSales:candidates.reduce((s,r)=>s+r.sales,0)};
  }
  function gauge(value) {
    if(value===null)return '<div class="ia-no-data">暂无已确认可售天数</div>';
    const capped=Math.min(value,120),angle=Math.PI*(1-capped/120),x=120+75*Math.cos(angle),y=116-75*Math.sin(angle);
    return `<svg class="ia-gauge" viewBox="0 0 240 172" role="img" aria-label="平均可售天数 ${esc(fmt(value,1))} 天"><path d="M25 116 A95 95 0 0 1 215 116" fill="none" stroke="var(--line-2)" stroke-width="17"/><path d="M25 116 A95 95 0 0 1 215 116" fill="none" stroke="#73a7ed" stroke-width="17" pathLength="120" stroke-dasharray="${capped} 120"/><line x1="120" y1="116" x2="${x}" y2="${y}" stroke="var(--ink)" stroke-width="3.5" stroke-linecap="round"/><circle cx="120" cy="116" r="6" fill="var(--ink)"/><text x="22" y="145" text-anchor="middle">0</text><text x="120" y="12" text-anchor="middle">60</text><text x="217" y="145" text-anchor="middle">120</text><text class="ia-gauge-value" x="120" y="160" text-anchor="middle">${fmt(value,1)}<tspan class="ia-svg-unit"> 天</tspan></text></svg>`;
  }
  function barChart(bins) {
    const max=Math.max(1,...bins.map(b=>b.rows.length)),top=Math.ceil(max/4)*4;
    const grid=[0,1,2,3,4].map(i=>{const y=182-i*36;return `<line x1="36" x2="492" y1="${y}" y2="${y}" stroke="var(--line-2)"/><text x="28" y="${y+4}" text-anchor="end">${fmt(top*i/4)}</text>`;}).join('');
    return `<svg class="ia-bars" viewBox="0 0 510 218" role="img" aria-label="按商品记录统计可售天数分布，点击柱形查看对应清单">${grid}${bins.map((b,i)=>{const h=b.rows.length/top*144,x=46+i*76;return `<g class="ia-bar-select" data-ia-select="coverage-${i}" role="button" tabindex="0" aria-label="查看覆盖${esc(b.label)}的${fmt(b.rows.length)}条商品"><rect x="${x}" y="${182-h}" width="42" height="${h}" rx="3" fill="${i<2?'#efb566':'#73a7ed'}"/><text x="${x+21}" y="${172-h}" text-anchor="middle" class="ia-bar-value">${fmt(b.rows.length)}</text><text x="${x+21}" y="205" text-anchor="middle">${esc(b.label)}</text></g>`;}).join('')}</svg>`;
  }
  function donut(items,total) {
    if(!total)return '<div class="ia-no-data">当前范围没有可分类的库存商品</div>';
    let offset=0;
    return `<svg class="ia-donut" viewBox="0 0 210 210" role="img" aria-label="库存商品动销分类">${items.map((x,i)=>{const part=x.rows.length/total*100,mark=`<circle cx="105" cy="105" r="76" fill="none" stroke="${colors[i]}" stroke-width="23" pathLength="100" stroke-dasharray="${part} ${100-part}" stroke-dashoffset="${-offset}" transform="rotate(-90 105 105)"><title>${esc(x.label)}：${fmt(x.rows.length)} 条，${pct(x.rows.length,total)}</title></circle>`;offset+=part;return mark;}).join('')}<text x="105" y="99" text-anchor="middle" class="ia-donut-label">有库存商品</text><text x="105" y="129" text-anchor="middle" class="ia-donut-value">${fmt(total)}</text></svg>`;
  }
  function cardHead(title,tag,sub='') {return `<header class="ia-card-head"><div><h3>${title}</h3>${sub?`<p>${sub}</p>`:''}</div>${tag?`<span class="ia-tag">${tag}</span>`:''}</header>`;}
  function healthNotes(m) {
    const urgent=m.quads.find(q=>q.id==='urgent'),complete=m.moving.length+m.idle.length;
    const notes=[
      ['优先核查',m.median===null?'缺少完整30天的正销量样本，暂不能判断高销量商品的缺货关注优先级。':`覆盖不足14天且销量较高的商品记录有 ${fmt(urgent.rows.length)} 条，占矩阵样本销量 ${pct(urgent.rows.reduce((s,r)=>s+r.sales,0),m.totalSales)}，可从对应分区核查库存及在途。`],
      ['动销状态',complete?`完整观测的有库存商品记录中，${fmt(m.moving.length)} 条有动销，${fmt(m.idle.length)} 条为零销量；零销量占完整观测记录 ${pct(m.idle.length,complete)}。`:m.stocked.length?'有库存商品尚无完整30天销量观测，暂不能判断动销与无动销比例。':'当前没有已确认有库存的商品记录，暂不判断动销状态。'],
      ['数据完整性',`预测可售天数未知 ${fmt(m.rows.length-m.days.length)} 条；有库存商品中，销量部分观测 ${fmt(m.partial.length)} 条，未知或异常 ${fmt(m.unknown.length)} 条。${!m.stocked.length?'当前没有已确认有库存的商品记录。':m.partial.length+m.unknown.length?'先补齐观测，再判断这些记录的动销状态。':'当前有库存记录均具备完整30天销量观测。'}`]
    ];
    return `<div class="ia-health-notes">${notes.map(([title,body])=>`<section><h4>${title}</h4><p>${body}</p></section>`).join('')}</div>`;
  }
  function render(rows,snap,options={}) {
    const m=model(rows,snap),sharedRows=rows.filter(r=>r.sharedWarehouse),sharedQty=sharedRows.reduce((sum,r)=>sum+(num(r.available)??0),0),items=[{id:'moving',label:'动销',rows:m.moving,hint:'完整30天 · 销量 > 0'},{id:'idle',label:'无动销',rows:m.idle,hint:'完整30天 · 销量 = 0'},{id:'partial',label:'部分观测',rows:m.partial,hint:'只记录了1–29天'},{id:'unknown',label:'销量未知 / 异常',rows:m.unknown,hint:'未读取、无观测或值异常'}];
    const low=m.days.filter(r=>r.forecastSellableDays<14).length,high=m.days.filter(r=>r.forecastSellableDays>=90).length;
    const date=v=>Array.isArray(v)?v.slice(0,3).map((x,i)=>i?String(x).padStart(2,'0'):x).join('-'):String(v||'未提供').slice(0,10);
    return `<div class="ia-dashboard" data-ia-root><div class="ia-scope"><span><b>Amazon 库存健康</b>快照 ${esc(date(snap.dataDate||snap.snapshotDate))}</span><span>销量窗口 ${esc(date(snap.salesWindowStart))} — ${esc(date(snap.salesWindowEnd))}</span><span>共享仓单列 ${fmt(sharedRows.length)} 条 / ${fmt(sharedQty)} 件，不分摊店铺</span></div>${!options.complete?'<p class="ia-alert">商品明细尚未完整返回，以下图表仅覆盖已加载记录。</p>':''}<div class="ia-kpis"><div><span>分析商品记录</span><strong>${fmt(rows.length)}</strong><small>按店铺、站点、SKU、ASIN区分</small></div><div><span>低库存关注</span><strong class="ia-warm">${m.days.length?fmt(low):'—'}</strong><small>预测可售天数 &lt; 14</small></div><div><span>高库存关注</span><strong>${m.days.length?fmt(high):'—'}</strong><small>预测可售天数 ≥ 90</small></div></div>
      <div class="ia-chart-grid"><article class="ia-card ia-coverage-card">${cardHead('库存覆盖天数','预测可售天数','按当前筛选商品记录统计；点击图表分区可查看清单')}<div class="ia-coverage ia-coverage-distribution"><div class="ia-coverage-summary"><span>可预测覆盖天数</span><strong>${fmt(m.days.length)}<small>/ ${fmt(rows.length)} 条</small></strong><p>${m.days.length?`其中 ${fmt(low)} 条不足14天，${fmt(high)} 条达到90天以上。`:'当前没有可预测的可售天数。'}</p><small>未知 ${fmt(rows.length-m.days.length)} 条，不补 0。</small></div><div><h4>商品覆盖天数分布</h4>${barChart(m.bins)}</div></div><p class="ia-interpret">${m.days.length?`当前有 ${fmt(low)} 条商品预测覆盖不足14天，可优先核对可售库存及在途到仓。`:'当前没有可预测的可售天数，需核对库存与销量匹配。'}预测未知 ${fmt(rows.length-m.days.length)} 条；真实零天计入不足14天。</p></article>
      <article class="ia-card">${cardHead('缺货关注 × 销量贡献','点击分区看清单','比较同一30天完整销量样本')}<div class="ia-matrix-shell"><span class="ia-y-label">销量较高 ↑</span><div class="ia-matrix">${m.quads.map(q=>`<button type="button" data-ia-select="${q.id}" class="ia-quadrant ia-${q.color}"${m.median===null?' disabled':''}><span>${q.title}</span><b>${m.median===null?'—':fmt(q.rows.length)}<small> 条</small></b><small>${m.median===null?'缺少完整正销量样本':`占样本销量 ${pct(q.rows.reduce((s,r)=>s+r.sales,0),m.totalSales)}`}</small><small>${q.hint}</small></button>`).join('')}</div><span class="ia-x-label">覆盖充足 ← 可售天数14天 → 覆盖不足</span></div><p class="ia-interpret">销量分界：正销量样本中位数 ${fmt(m.median,1)} 件；可分类 ${fmt(m.candidates.length)} / ${fmt(rows.length)} 条。用于排查优先级，实际补货仍需采购周期与在途数据。</p></article>
      <article class="ia-card">${cardHead('近30天动销','有库存商品','FBA可售 + FBM可用 > 0；两项都须有效')}<div class="ia-movement">${donut(items,m.stocked.length)}<div class="ia-legend">${items.map((x,i)=>`<button type="button" data-ia-select="${x.id}"><i style="background:${colors[i]}"></i><span>${x.label}<small>${x.hint}</small></span><b>${fmt(x.rows.length)}<small>${pct(x.rows.length,m.stocked.length)}</small></b></button>`).join('')}</div></div><p class="ia-interpret">完整观测的零销量才归为“无动销”。未分类库存记录 ${fmt(rows.length-m.stocked.length)} 条；部分观测与未知记录单列。</p></article>
      <article class="ia-card ia-health-card">${cardHead('库存健康解读','当前筛选范围','结合覆盖、动销与观测完整度')} ${healthNotes(m)}<p class="ia-interpret">以上均按商品记录统计，不是去重SKU；补货数量与采购时点需另结合采购周期及在途数据。</p></article></div>
      <section class="ia-card ia-drill" data-ia-drill hidden></section>
      <section class="ia-pending"><div><strong>库存周转天数趋势</strong><span>待补齐同口径历史库存与同期销量</span></div><p>当前接口提供库存快照。可售天数、月末库存变化均不等于实际周转天数；接入可比历史后再生成趋势。</p><a href="#replenishment">查看采购与补货数据准备 →</a></section>
      <details class="ia-method"><summary>统计范围与口径</summary><p>预测可售天数按 FBA 可售库存 ÷（近30天销量 ÷ 有销量记录天数）计算；销量未匹配、零销量、异常库存均显示未知，不补零。平均值仅统计可预测记录；分布区间为 0–10、10–20、20–30、30–45、45–60 和 60 天以上，零天计入第一档。动销以已确认有FBA或FBM库存的记录为范围，完整30天观测的非负销量才能判定动销状态。风险矩阵仅使用完整30天非负销量及已预测天数。图表使用全部已加载匹配记录，表格分页不影响分析。</p></details></div>`;
  }
  function mount(container,rows,snap) {
    const root=container?.querySelector('[data-ia-root]');if(!root)return;
    const drill=root.querySelector('[data-ia-drill]'),movement=root.querySelector('.ia-movement')?.closest('.ia-card');
    if(drill&&movement){drill.classList.add('ia-wide');movement.before(drill);}
    const coverageHint=root.querySelector('.ia-coverage-card .ia-card-head p'),matrixHint=root.querySelector('.ia-matrix')?.closest('.ia-card')?.querySelector('.ia-card-head p');
    if(coverageHint)coverageHint.textContent='按当前筛选商品记录统计；点击图表分区后，紧接下方显示对应清单。';
    if(matrixHint)matrixHint.textContent='选择分区后，紧接下方显示对应商品清单；比较同一30天完整销量样本。';
    const m=model(rows,snap);let selected=[];
    const selections={moving:['动销商品',m.moving],idle:['无动销商品',m.idle],partial:['销量部分观测',m.partial],unknown:['销量未知 / 异常',m.unknown]};m.quads.forEach(q=>selections[q.id]=[q.title,q.rows]);m.bins.forEach((bin,index)=>selections[`coverage-${index}`]=[`覆盖 ${bin.label}`,bin.rows]);
    root.addEventListener('click',event=>{
      const button=event.target.closest('button,[data-ia-select]');if(!button||!root.contains(button))return;
      if(button.dataset.iaSelect){const group=selections[button.dataset.iaSelect];if(!group)return;selected=group[1].slice().sort((a,b)=>(num(a.forecastSellableDays)??Infinity)-(num(b.forecastSellableDays)??Infinity));const panel=root.querySelector('[data-ia-drill]');panel.hidden=false;panel.innerHTML=`${cardHead(esc(group[0]),`${fmt(selected.length)} 条`)}<div class="ia-drill-actions"><span>显示前100条；导出包含本清单全部记录。</span><button type="button" data-ia-export${selected.length?'':' disabled'}>导出清单</button><button type="button" data-ia-close>收起</button></div><div class="ia-scroll"><table><thead><tr><th>SKU / ASIN</th><th>店铺 / 站点</th><th>FBA可售</th><th>FBM可用</th><th>预测可售天数</th><th>近30天销量</th><th>观测天数</th></tr></thead><tbody>${selected.slice(0,100).map(r=>`<tr><td><b>${esc(r.sku||'未标注SKU')}</b><small>${esc(r.asin)}</small></td><td>${esc(r.seller)}<small>${esc(r.country)}</small></td><td>${fmt(r.available)}</td><td>${fmt(r.fbm)}</td><td>${num(r.forecastSellableDays)!==null?fmt(r.forecastSellableDays,1):'未确认'}</td><td>${fmt(r.sales)}</td><td>${fmt(r.observed)}</td></tr>`).join('')||'<tr><td colspan="7">当前分类暂无商品。</td></tr>'}</tbody></table></div>`;root.querySelectorAll('[data-ia-select]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));panel.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});}
      if(button.hasAttribute('data-ia-close'))root.querySelector('[data-ia-drill]').hidden=true;
      if(button.hasAttribute('data-ia-export')){
        const csvCell=v=>'"'+(typeof v==='string'&&/^[\s]*[=+@-]/.test(v)?"'"+v:String(v??'')).replace(/"/g,'""')+'"';
        const data=[['SKU','ASIN','店铺','站点','FBA可售','FBM可用','预测可售天数','近30天销量','观测天数'],...selected.map(r=>[r.sku,r.asin,r.seller,r.country,r.available,r.fbm,r.forecastSellableDays,r.sales,r.observed])];
        const url=URL.createObjectURL(new Blob(['\ufeff'+data.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='Amazon库存分析清单.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    });
    root.addEventListener('keydown',event=>{const control=event.target.closest('[data-ia-select]');if(!control||!root.contains(control)||!['Enter',' '].includes(event.key))return;event.preventDefault();control.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  }
  window.InventoryAnalysis={render,mount};
})();
