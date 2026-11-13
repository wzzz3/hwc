(function(){
  'use strict';

  const SOURCE_URL='https://docs.dingtalk.com/i/nodes/gvNG4YZ7JnNj2LYjFN5Pw5o5J2LD0oRE?iframeQuery=entrance%3Ddata%26sheetId%3DhERWDMS';
  const BASE_ID='gvNG4YZ7JnNj2LYjFN5Pw5o5J2LD0oRE';
  const DEFAULT_SHEET_ID='hERWDMS';
  const state={columns:[],rows:[],fileName:'',importedAt:'',sourceTime:'',search:'',start:'',end:'',store:'',dateKey:'',storeKey:'',page:1,pageSize:50,sortKey:null,sortDirection:'asc',showAllColumns:false,renderLimit:250,resetScroll:false,expanded:new Set(),error:'',busy:false};
  const remote={phase:'idle',metaPhase:'idle',mode:'remote',sheets:[],sheetId:DEFAULT_SHEET_ID,loadedSheetId:'',error:'',warning:'',fetchedAt:'',sourceUpdatedAt:'',cache:null,complete:true,nextToken:'',hasMore:false};
  const remoteCache=new Map();
  const remoteRequests=new Map();
  let remoteSequence=0;
  let fileSequence=0;
  let metadataRequest=null;
  let authScope=window.AnalyticsApi?.authScopeVersion?.()??0;
  const bound=new WeakSet();
  let mounted=null;
  let composing=false;
  let displayedRows=[];
  let renderedCount=0;
  let sortCache=null;
  const textOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
  const canonical=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]/g,'');
  const cell=(row,key)=>row.values[key]??'';
  const knownCurrencies=new Set('CNY USD EUR GBP JPY CAD AUD HKD SGD NZD CHF AED MXN BRL PLN SEK NOK DKK SAR TRY INR IDR THB PHP MYR VND KRW TWD ZAR'.split(' '));
  const currencyNames={'人民币':'CNY','人民币元':'CNY','美元':'USD','欧元':'EUR','英镑':'GBP','日元':'JPY','日币':'JPY','加元':'CAD','加拿大元':'CAD','澳元':'AUD','澳大利亚元':'AUD','澳洲':'AUD','港币':'HKD','港元':'HKD','新加坡元':'SGD','新币':'SGD','纽元':'NZD','新西兰元':'NZD','瑞士法郎':'CHF','阿联酋迪拉姆':'AED','墨西哥比索':'MXN','巴西雷亚尔':'BRL','波兰兹罗提':'PLN','瑞典克朗':'SEK','挪威克朗':'NOK','丹麦克朗':'DKK','沙特里亚尔':'SAR','土耳其里拉':'TRY','印度卢比':'INR','印尼盾':'IDR','印度尼西亚盾':'IDR','泰铢':'THB','菲律宾比索':'PHP','马来西亚林吉特':'MYR','越南盾':'VND','韩元':'KRW','新台币':'TWD','南非兰特':'ZAR','RMB':'CNY'};
  // "澳洲" is an AUD alias confirmed by the source owner. Ambiguous currency
  // families still require an explicit country/site field on the same row.
  const contextCurrencyLabels=['克朗'];
  const currencyTextTokens=[...new Set([...knownCurrencies,...Object.keys(currencyNames),...contextCurrencyLabels])].sort((left,right)=>right.length-left.length);

  function apiCall(method,params){
    const call=window.AnalyticsApi?.[method];
    if(typeof call!=='function')return Promise.reject(new Error('资金读取接口尚未加载，请更新页面文件后重新加载。'));
    return call(params);
  }

  function resetAuthScope(generation){
    if(generation===authScope)return;
    authScope=generation;remoteSequence++;fileSequence++;composing=false;metadataRequest=null;remoteRequests.clear();remoteCache.clear();
    Object.assign(remote,{phase:'idle',metaPhase:'idle',mode:'remote',sheets:[],sheetId:DEFAULT_SHEET_ID,loadedSheetId:'',error:'',warning:'',fetchedAt:'',sourceUpdatedAt:'',cache:null,complete:true,nextToken:'',hasMore:false});
    state.rows=[];state.columns=[];state.fileName='';state.importedAt='';state.sourceTime='';state.dateKey='';state.storeKey='';state.showAllColumns=false;state.busy=false;state.expanded.clear();sortCache=null;displayedRows=[];renderedCount=0;resetFilters();
    paint();
    // Token discovery can emit this event synchronously inside apiCall. Defer
    // reloading until that call has assigned its promise, avoiding re-entrancy.
    Promise.resolve().then(()=>{if(authScope===generation&&mounted?.isConnected)void ensureLoaded();});
  }

  window.addEventListener('analytics-auth-changed',event=>{
    resetAuthScope(event.detail?.generation??window.AnalyticsApi?.authScopeVersion?.()??authScope);
  });

  function synchronizeAuthScope(){
    const previous=authScope;
    const generation=window.AnalyticsApi?.syncAuthScopeVersion?.()??window.AnalyticsApi?.authScopeVersion?.()??authScope;
    if(generation!==authScope)resetAuthScope(generation);
    return authScope!==previous;
  }

  window.addEventListener('focus',synchronizeAuthScope);
  document.addEventListener('visibilitychange',synchronizeAuthScope);

  function denyRemoteAccess(error){
    const status=Number(error?.status??error?.code??error?.httpStatus);
    if(status!==401&&status!==403)return false;
    remoteSequence++;fileSequence++;metadataRequest=null;remoteRequests.clear();remoteCache.clear();
    state.rows=[];state.columns=[];state.fileName='';state.importedAt='';state.sourceTime='';state.busy=false;state.expanded.clear();sortCache=null;displayedRows=[];renderedCount=0;resetFilters();
    Object.assign(remote,{phase:'denied',metaPhase:'idle',mode:'remote',loadedSheetId:'',sheets:[],cache:null,fetchedAt:'',sourceUpdatedAt:'',warning:'',hasMore:false,nextToken:'',complete:true,error:error?.message||(status===401?'登录状态已失效，请重新登录。':'当前资金表暂不可访问，请核对权限。')});
    paint();return true;
  }

  function assertBase(payload){
    if(payload?.baseId&&payload.baseId!==BASE_ID)throw new Error('返回的数据源与当前资金表不一致，已停止显示。');
  }

  function sheetName(){return '数据表';}
  function recordsAllowed(sheet){return sheet?.id===DEFAULT_SHEET_ID&&(sheet.recordsAllowed===true||sheet.allowed===true||(sheet.recordsAllowed===undefined&&sheet.allowed===undefined));}

  function sheetSourceUrl(){
    return SOURCE_URL;
  }

  function displayTime(value){
    if(value===null||value===undefined||value==='')return '未提供';
    const raw=String(value),numeric=/^\d{10,13}$/.test(raw)?Number(raw)*(raw.length===10?1000:1):null;
    const date=new Date(numeric??value);
    return Number.isNaN(date.getTime())?raw:date.toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'});
  }

  function displayCell(value,column){
    if(value===null||value===undefined)return '';
    if(Array.isArray(value)){
      const parts=value.map(item=>displayCell(item,column)).filter(item=>item!==''&&item!==null);
      return parts.length===1?parts[0]:parts.map(text).join(' / ');
    }
    if(typeof value==='object'){
      if(['user','person','creator','lastModifiedBy'].includes(column?.type)||Object.prototype.hasOwnProperty.call(value,'unionId'))return value.name||'未提供姓名';
      for(const key of ['text','value','name','label'])if(Object.prototype.hasOwnProperty.call(value,key))return displayCell(value[key],column);
      return JSON.stringify(value);
    }
    if(['user','person','creator','lastModifiedBy'].includes(column?.type))return String(value).trim()?'未提供姓名':'';
    if(['date','lastModifiedTime','createdTime'].includes(column?.type)&&/^\d{10,13}$/.test(String(value)))return displayTime(value);
    return value;
  }

  function setRows(columns,rows,{append=false,preserveFilters=false,valuesDisplayed=false}={}){
    const normalized=columns.map((column,index)=>({
      ...column,key:String(column.key??column.id??column.name??index),label:String(column.label??column.name??column.key??`字段 ${index+1}`)
    }));
    state.columns=append?[...new Map([...state.columns,...normalized].map(column=>[column.key,column])).values()]:normalized;
    const byId=new Map((append?state.rows:[]).map(row=>[row.sourceId,row]));
    rows.forEach((row,index)=>{
      const values=row.fields||row.values||{};
      const sourceId=String(row.id??row.recordId??`__row_${append?state.rows.length+index:index}`);
      byId.set(sourceId,{sourceId,values:Object.fromEntries(state.columns.map(column=>[
        column.key,valuesDisplayed?(Object.prototype.hasOwnProperty.call(values,column.key)?values[column.key]:values[column.label]):displayCell(Object.prototype.hasOwnProperty.call(values,column.key)?values[column.key]:values[column.label],column)
      ]))});
    });
    state.rows=[...byId.values()].map((row,index)=>({...row,id:index}));
    sortCache=null;
    if(!append)state.expanded.clear();
    if(!append&&!preserveFilters)resetFilters();
    if(preserveFilters){state.page=1;state.renderLimit=250;if(!state.columns.some(column=>column.key===state.sortKey))state.sortKey=null;}
    const kinds=fieldKinds();
    if(!kinds.dates.some(column=>column.key===state.dateKey))state.dateKey=kinds.dates[0]?.key||'';
    if(!kinds.stores.some(column=>column.key===state.storeKey))state.storeKey=kinds.stores[0]?.key||'';
  }

  function applyRemote(payload,{append=false,valuesDisplayed=false,fromMemory=false}={}){
    assertBase(payload);
    if(!payload||!Array.isArray(payload.columns)||!Array.isArray(payload.rows))throw new Error('资金接口未返回有效的字段和记录，请刷新后重试。');
    if(payload?.sheet?.id&&String(payload.sheet.id)!==remote.sheetId)throw new Error('返回的工作表与当前选择不一致，请重试。');
    const columns=Array.isArray(payload?.columns)?payload.columns:[];
    const rows=Array.isArray(payload?.rows)?payload.rows:[];
    if(!columns.length&&rows.length)throw new Error('资金表字段尚未返回，请刷新后重试。');
    setRows(columns,rows,{append,valuesDisplayed,preserveFilters:!append&&remote.loadedSheetId===remote.sheetId});
    remote.loadedSheetId=remote.sheetId;
    remote.fetchedAt=payload.fetchedAt||'';
    const oldTime=append?new Date(remote.sourceUpdatedAt).getTime():NaN;
    const nextTime=new Date(payload.sourceUpdatedAt).getTime();
    if(!append||!Number.isFinite(oldTime)||nextTime>oldTime)remote.sourceUpdatedAt=payload.sourceUpdatedAt||'';
    remote.cache=payload.cache||null;
    remote.complete=payload.complete!==false&&!payload.hasMore&&!payload.truncated;
    remote.nextToken=payload.nextToken||'';remote.hasMore=Boolean(payload.hasMore||payload.truncated);
    remote.warning=payload.warning||'';
    remote.phase='ready';remote.error='';
    state.fileName='';state.importedAt='';state.sourceTime='';state.error='';
    const ttl=Number(payload.cache?.ttlSeconds)||60,age=Number(payload.cache?.ageMs)||0;
    if(!fromMemory)remoteCache.set(remote.sheetId,{payload:{...payload,columns:state.columns,rows:state.rows.map(row=>({id:row.sourceId,fields:row.values})),complete:remote.complete,hasMore:remote.hasMore,nextToken:remote.nextToken,sourceUpdatedAt:remote.sourceUpdatedAt},storedAt:Date.now(),expiresAt:Date.now()+Math.max(15000,ttl*1000-age)});
  }

  async function loadRemoteSheet({refresh=false,append=false}={}){
    if(synchronizeAuthScope())return;
    if(remote.mode!=='remote')return;
    const sheetId=DEFAULT_SHEET_ID;
    if(!recordsAllowed(remote.sheets.find(sheet=>sheet.id===sheetId))){denyRemoteAccess({status:403,message:'当前工作表尚未启用明细读取，请核对服务器授权范围。'});return;}
    const cached=remoteCache.get(sheetId);
    if(!refresh&&!append&&cached&&cached.expiresAt>Date.now()){
      applyRemote({...cached.payload,cache:{...cached.payload.cache,hit:true,layer:'browser-memory',ageMs:Math.max(0,(Number(cached.payload.cache?.ageMs)||0)+Date.now()-cached.storedAt)}},{valuesDisplayed:true,fromMemory:true});paint();return;
    }
    const nextToken=append?remote.nextToken:'';
    if(append&&!nextToken)return;
    const sequence=++remoteSequence;
    remote.phase='loading';remote.error='';
    if(!append&&remote.loadedSheetId!==sheetId){state.rows=[];state.columns=[];remote.fetchedAt='';remote.sourceUpdatedAt='';remote.cache=null;remote.warning='';}
    paint();
    const requestKey=JSON.stringify([authScope,sheetId,nextToken,refresh]);
    let request=remoteRequests.get(requestKey);
    if(!request){
      request=apiCall('cashflowRecords',{sheetId,all:true,pageSize:100,...(nextToken?{nextToken}:{}),...(refresh?{refresh:true}:{})});
      remoteRequests.set(requestKey,request);
    }
    try{
      const payload=await request;
      if(sequence!==remoteSequence||remote.mode!=='remote'||sheetId!==remote.sheetId)return;
      applyRemote(payload,{append});
    }catch(error){
      if(sequence!==remoteSequence||remote.mode!=='remote'||sheetId!==remote.sheetId)return;
      if(denyRemoteAccess(error))return;
      remote.phase='error';remote.error=error?.message||'钉钉资金表读取失败，请重试。';
    }finally{
      if(remoteRequests.get(requestKey)===request)remoteRequests.delete(requestKey);
      if(sequence===remoteSequence)paint();
    }
  }

  async function ensureLoaded({refresh=false}={}){
    synchronizeAuthScope();
    if(remote.mode!=='remote'||remote.phase==='loading')return;
    if(remote.phase==='denied'&&!refresh)return;
    const scope=authScope;
    if(remote.metaPhase!=='ready'||refresh){
      if(remote.metaPhase==='error'&&!refresh)return;
      if(!metadataRequest){
        remote.metaPhase='loading';remote.error='';paint();
        metadataRequest=apiCall('cashflowSheets',refresh?{refresh:true}:{});
      }else remote.metaPhase='loading';
      const request=metadataRequest;
      try{
        const payload=await request;
        if(scope!==authScope||request!==metadataRequest)return;
        assertBase(payload);
        remote.sheets=(Array.isArray(payload?.sheets)?payload.sheets:[]).filter(sheet=>String(sheet.id)===DEFAULT_SHEET_ID).map(sheet=>({...sheet,id:DEFAULT_SHEET_ID,name:'数据表'}));
        remote.sheetId=DEFAULT_SHEET_ID;
        if(!remote.sheets.some(recordsAllowed)){const error=new Error('数据表不可访问，请核对钉钉表格权限或服务器授权范围。');error.status=403;throw error;}
        remote.metaPhase='ready';remote.error='';
      }catch(error){if(scope!==authScope)return;if(denyRemoteAccess(error))return;remote.metaPhase='error';remote.phase='error';remote.error=error?.message||'钉钉工作表列表读取失败。';paint();return;}
      finally{if(scope===authScope&&metadataRequest===request)metadataRequest=null;}
    }
    if(remote.mode!=='remote'||remote.phase==='loading')return;
    if(refresh||remote.phase==='idle'||remote.phase==='error'||!remoteCache.has(remote.sheetId)||remoteCache.get(remote.sheetId).expiresAt<=Date.now())await loadRemoteSheet({refresh});
  }

  function returnToRemote(){
    remoteSequence++;fileSequence++;state.busy=false;remote.mode='remote';remote.phase='idle';remote.error='';
    if(remote.metaPhase==='error')remote.metaPhase='idle';
    remote.sheetId=DEFAULT_SHEET_ID;remote.loadedSheetId='';remote.fetchedAt='';remote.sourceUpdatedAt='';remote.cache=null;remote.warning='';remote.hasMore=false;remote.nextToken='';remote.complete=true;
    state.rows=[];state.columns=[];state.fileName='';state.importedAt='';state.sourceTime='';state.showAllColumns=false;state.expanded.clear();resetFilters();
    paint();void ensureLoaded();
  }

  function currencyCode(value){
    const raw=String(value??'').normalize('NFKC').trim().toUpperCase();
    return currencyNames[raw]||(knownCurrencies.has(raw)?raw:'');
  }

  function currencyToken(value,{allowAmount=false}={}){
    const raw=String(value??'').normalize('NFKC').trim();
    if(!raw)return {raw:'',code:''};
    const direct=raw.match(/^([A-Za-z]{3})$/);
    if(direct)return {raw:direct[1].toUpperCase(),code:currencyCode(direct[1])};
    if(allowAmount){
      const code=/^([A-Za-z]{3})(?=[\s\d+\-($€£¥])|(?:\s|\d)([A-Za-z]{3})$/.exec(raw);
      if(code){const value=code[1]||code[2];return {raw:value.toUpperCase(),code:currencyCode(value)};}
    }
    for(const name of currencyTextTokens){
      const upper=raw.toUpperCase(),token=name.toUpperCase();
      if(upper===token)return {raw:name,code:currencyCode(name)};
      if(allowAmount&&upper.startsWith(token)&&/^[\s\d+\-($€£¥]/.test(raw.slice(name.length)))return {raw:name,code:currencyCode(name)};
      if(allowAmount&&upper.endsWith(token)&&/[\s\d.)]$/.test(raw.slice(0,-name.length)))return {raw:name,code:currencyCode(name)};
    }
    return {raw:allowAmount?'':raw,code:''};
  }

  function dateValue(value){
    const raw=String(value??'').trim();
    const match=/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|(?=[T\s])|$)/.exec(raw);
    if(!match)return '';
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day
      ?`${match[1]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
  }

  function amountColumn(column){
    const header=String(column.label).normalize('NFKC').replace(/\s/g,'');
    const match=/^(回款金额|到账金额|收款金额|打款金额|转账金额|申请转账金额)(?:\(([^)]+)\))?$/.exec(header);
    if(!match)return null;
    const transfer=['转账金额','申请转账金额'].includes(match[1]);
    const currencyRaw=match[2]||column.currency||column.property?.currencyCode||column.property?.currency||'';
    return {key:column.key,label:transfer?'申请转账金额':column.label,transfer,currency:currencyCode(currencyRaw),currencyRaw};
  }

  function tableKind(){
    if(state.columns.some(column=>amountColumn(column)?.transfer))return 'transfer';
    if((remote.mode==='remote'&&/存档|档案/.test(sheetName()))||state.columns.some(column=>canonical(column.label)==='最低提现金额'))return 'archive';
    return 'generic';
  }

  function visibleColumns(){
    if(state.showAllColumns)return state.columns;
    const kind=tableKind();
    const groups=kind==='transfer'?[
      ['date',['申请转账日期','转账日期','申请日期']],
      ['store',['店铺名称','店铺','店铺名','收款店铺']],
      ['site',['站点','国家','国家/站点']],
      ['currency',['货币单位','币种','货币','结算币种']],
      ['amount',['转账金额','申请转账金额']],
      ['status',['运行状态','处理状态','状态']],
      ['tail',['收款尾号','收款账号尾号','收款账户尾号','账户尾号']],
      ['updated',['最后更新日期','更新时间','最后更新时间','更新日期']]
    ]:kind==='archive'?[
      ['store',['店铺名称','店铺','店铺名']],
      ['site',['站点','国家','国家/站点']],
      ['currency',['货币单位','币种','货币']],
      ['minimum',['最低提现金额']],
      ['owner',['店铺直接负责人','店铺负责人','直接负责人','负责人']]
    ]:null;
    if(!groups)return state.columns.slice(0,6);
    const columns=[];
    groups.forEach(([role,labels])=>{
      const column=labels.map(label=>state.columns.find(item=>canonical(item.label)===canonical(label))).find(Boolean);
      if(column&&!columns.some(item=>item.key===column.key))columns.push({...column,role});
    });
    return columns.length?columns:state.columns.slice(0,6);
  }

  function valueCurrency(value){
    return currencyToken(value,{allowAmount:true});
  }

  function amountValue(value){
    if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))return null;
    let raw=String(value??'').normalize('NFKC').trim();
    if(!raw)return null;
    let negative=false;
    if(/^\(.*\)$/.test(raw)){negative=true;raw=raw.slice(1,-1).trim();}
    for(const token of currencyTextTokens){
      const upper=raw.toUpperCase(),value=token.toUpperCase();
      if(upper.startsWith(value)&&/^[\s\d+\-($€£¥]/.test(raw.slice(token.length))){raw=raw.slice(token.length).trim();break;}
      if(upper.endsWith(value)&&/[\s\d.)]$/.test(raw.slice(0,-token.length))){raw=raw.slice(0,-token.length).trim();break;}
    }
    raw=raw.replace(/^[$€£¥]\s*/,'').replace(/\s/g,'');
    if(raw.includes(',')&&!/^[+\-]?\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?$/.test(raw))return null;
    raw=raw.replace(/,/g,'');
    if(!/^[+\-]?(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(raw))return null;
    if(negative&&raw.startsWith('-'))return null;
    const sign=raw.startsWith('-')?-1n:1n;
    const parts=raw.replace(/^[+\-]/,'').split('.');
    const scaled=(BigInt(parts[0]||'0')*1000000n+BigInt((parts[1]||'').padEnd(6,'0')))*sign*(negative?-1n:1n);
    return scaled;
  }

  function formatAmount(value){
    const sign=value<0n?'-':'';
    const absolute=value<0n?-value:value;
    const integer=(absolute/1000000n).toLocaleString('zh-CN');
    let fraction=(absolute%1000000n).toString().padStart(6,'0');
    while(fraction.length>2&&fraction.endsWith('0'))fraction=fraction.slice(0,-1);
    return `${sign}${integer}.${fraction}`;
  }

  function csvRows(source){
    const input=String(source).replace(/^\uFEFF/,'');
    const first=[];
    let inQuote=false;
    for(let index=0;index<input.length;index++){
      const char=input[index];
      if(char==='"'){if(inQuote&&input[index+1]==='"'){index++;continue;}inQuote=!inQuote;}
      if(!inQuote&&(char==='\r'||char==='\n'))break;
      if(!inQuote&&[',','\t',';'].includes(char))first.push(char);
    }
    const delimiter=[',','\t',';'].sort((left,right)=>first.filter(value=>value===right).length-first.filter(value=>value===left).length)[0];
    const rows=[];
    let row=[],field='',quoted=false,closed=false;
    for(let index=0;index<input.length;index++){
      const char=input[index];
      if(quoted){
        if(char==='"'&&input[index+1]==='"'){field+='"';index++;}
        else if(char==='"'){quoted=false;closed=true;}
        else field+=char;
      }else if(char==='"'&&field===''){quoted=true;closed=false;}
      else if(char===delimiter){row.push(field);field='';closed=false;}
      else if(char==='\n'||char==='\r'){
        if(char==='\r'&&input[index+1]==='\n')index++;
        row.push(field);if(row.some(value=>value.trim()!==''))rows.push(row);row=[];field='';closed=false;
      }else if(closed&&char.trim()!=='')throw new Error('CSV 引号结束后出现了多余内容，请检查文件格式。');
      else if(!closed)field+=char;
    }
    if(quoted)throw new Error('CSV 存在未闭合的引号，请检查文件后重新导入。');
    row.push(field);if(row.some(value=>value.trim()!==''))rows.push(row);
    if(!rows.length)throw new Error('文件为空，请导出含表头的资金明细。');
    const headers=rows.shift();
    if(rows.some(values=>values.length>headers.length))throw new Error('部分行比表头多出列，请检查分隔符或引号。');
    return {columns:headers.map((label,index)=>({key:String(index),label:label.trim()||`未命名列 ${index+1}`})),rows:rows.map(values=>({values:Object.fromEntries(headers.map((_,index)=>[String(index),values[index]??'']))}))};
  }

  function jsonRows(source){
    const payload=JSON.parse(String(source).replace(/^\uFEFF/,''));
    const rows=Array.isArray(payload)?payload:payload?.rows;
    if(!Array.isArray(rows))throw new Error('JSON 应包含记录数组，或包含 rows 数组。');
    if(!rows.length)throw new Error('文件没有明细记录。');
    if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('每条 JSON 记录应使用带字段名称的对象。');
    const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
    if(!keys.length)throw new Error('文件没有可显示的字段。');
    return {columns:keys.map(key=>({key,label:key})),rows:rows.map(row=>({values:Object.fromEntries(keys.map(key=>[key,Object.prototype.hasOwnProperty.call(row,key)?row[key]:'']))})),sourceTime:!Array.isArray(payload)?text(payload.sourceTime??payload.updatedAt??''):''};
  }

  function fieldKinds(){
    const dateNames=['申请转账日期','转账日期','申请日期','到账日期','回款日期','收款日期','打款日期','结算日期','日期','到账时间','回款时间','收款时间','打款时间','结算时间','最后更新日期','更新时间','时间','paymentdate','receiveddate','settlementdate','date'];
    const storeNames=['店铺','店铺名称','店铺名','收款店铺','sellername','storename','shopname','store','shop'];
    const dates=state.columns.filter(column=>dateNames.includes(canonical(column.label))&&state.rows.some(row=>dateValue(cell(row,column.key))));
    dates.sort((left,right)=>dateNames.indexOf(canonical(left.label))-dateNames.indexOf(canonical(right.label)));
    const stores=state.columns.filter(column=>storeNames.includes(canonical(column.label))&&state.rows.some(row=>text(cell(row,column.key)).trim()));
    stores.sort((left,right)=>storeNames.indexOf(canonical(left.label))-storeNames.indexOf(canonical(right.label)));
    const currencies=state.columns.filter(column=>['币种','货币','货币单位','结算币种','回款币种','到账币种','收款币种','付款币种','currency','currencycode','currencyunit'].includes(canonical(column.label)));
    const siteNames=['站点','国家','国家/站点','site','country','marketplacecountry'];
    const sites=state.columns.filter(column=>siteNames.includes(canonical(column.label)));
    return {dates,stores,currency:currencies[0]||null,sites,amounts:state.columns.map(amountColumn).filter(Boolean)};
  }

  function filteredRows(){
    const query=state.search.trim().toLocaleLowerCase();
    return state.rows.filter(row=>{
      if(query&&!state.columns.some(column=>text(cell(row,column.key)).toLocaleLowerCase().includes(query)))return false;
      if(state.store&&text(cell(row,state.storeKey)).trim()!==state.store)return false;
      if(state.start||state.end){const date=dateValue(cell(row,state.dateKey));if(!date||(state.start&&date<state.start)||(state.end&&date>state.end))return false;}
      return true;
    });
  }

  function sortDate(value){
    const day=dateValue(value);
    if(!day)return null;
    const time=/[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(String(value));
    return day+'T'+(time?`${time[1].padStart(2,'0')}:${time[2]}:${time[3]||'00'}.${(time[4]||'').padEnd(6,'0')}`:'00:00:00.000000');
  }

  function sortNumber(value){
    const raw=text(value).normalize('NFKC').trim();
    return amountValue(raw.endsWith('%')?raw.slice(0,-1):value);
  }

  function emptySortValue(value){
    return value===null||value===undefined||['','—','–','-','n/a','null'].includes(text(value).trim().toLowerCase());
  }

  function orderedRows(rows){
    if(state.sortKey===null)return rows;
    if(!sortCache||sortCache.key!==state.sortKey){
      const values=state.rows.map(row=>cell(row,state.sortKey));
      const known=values.filter(value=>!emptySortValue(value));
      const kind=known.length&&known.every(value=>sortDate(value)!==null)?'date':known.length&&known.every(value=>sortNumber(value)!==null)?'number':'text';
      sortCache={key:state.sortKey,kind,values:new Map(state.rows.map((row,index)=>[row.id,emptySortValue(values[index])?null:kind==='date'?sortDate(values[index]):kind==='number'?sortNumber(values[index]):text(values[index])]))};
    }
    const direction=state.sortDirection==='desc'?-1:1;
    return rows.slice().sort((left,right)=>{
      const a=sortCache.values.get(left.id),b=sortCache.values.get(right.id);
      if(a===null||b===null)return a===null&&b===null?left.id-right.id:a===null?1:-1;
      const difference=sortCache.kind==='number'?(a<b?-1:a>b?1:0):textOrder.compare(a,b);
      return difference?difference*direction:left.id-right.id;
    });
  }

  function rowMarkup(row,columns){
    const expanded=state.expanded.has(row.id);
    return `<tr>${columns.map(column=>`<td title="${esc(text(cell(row,column.key)))}"><span>${esc(text(cell(row,column.key))||'—')}</span></td>`).join('')}<td class="cf-detail-action"><button type="button" data-cf-detail="${row.id}" aria-expanded="${expanded}" aria-controls="cf-row-${row.id}">${expanded?'收起':'详情'}</button></td></tr>${expanded?`<tr class="cf-expanded-row" id="cf-row-${row.id}"><td colspan="${columns.length+1}"><dl>${state.columns.map(column=>`<div><dt>${esc(column.label)}</dt><dd>${esc(text(cell(row,column.key))||'—')}</dd></div>`).join('')}</dl></td></tr>`:''}`;
  }

  function appendRows(){
    if(!mounted?.isConnected||state.pageSize!==0||renderedCount>=displayedRows.length)return;
    const body=mounted.querySelector('.cf-table tbody');
    if(!body)return;
    const next=displayedRows.slice(renderedCount,renderedCount+250);
    const columns=visibleColumns();
    body.insertAdjacentHTML('beforeend',next.map(row=>rowMarkup(row,columns)).join(''));
    renderedCount+=next.length;state.renderLimit=renderedCount;
    const status=mounted.querySelector('[data-cf-page-status]');
    if(status)status.textContent=`已显示 ${renderedCount.toLocaleString('zh-CN')} / ${displayedRows.length.toLocaleString('zh-CN')} 条`;
    const button=mounted.querySelector('[data-cf-action="more"]');
    if(button)button.hidden=renderedCount>=displayedRows.length;
  }

  function siteCurrency(row,kinds){
    const siteCodes={
      '澳大利亚':'AUD','australia':'AUD','au':'AUD',
      '瑞典':'SEK','sweden':'SEK','se':'SEK',
      '挪威':'NOK','norway':'NOK','no':'NOK',
      '丹麦':'DKK','denmark':'DKK','dk':'DKK',
      '墨西哥':'MXN','mexico':'MXN','mx':'MXN'
    };
    const values=(kinds.sites||[]).map(column=>text(cell(row,column.key)).normalize('NFKC').trim().toLowerCase()).filter(Boolean);
    if(!values.length)return '';
    const codes=values.map(value=>siteCodes[value]||'');
    return codes.every(Boolean)&&new Set(codes).size===1?codes[0]:'';
  }

  function totals(rows,kinds){
    const groups=new Map(),unrecognized=new Map(),inferred=new Map();
    let missing=0,invalid=0,conflicts=0;
    rows.forEach(row=>kinds.amounts.forEach(column=>{
      const raw=cell(row,column.key);
      if(text(raw).trim()==='')return;
      const amount=amountValue(raw);
      if(amount===null){invalid++;return;}
      const candidates=[];
      if(kinds.currency)candidates.push(currencyToken(cell(row,kinds.currency.key)));
      if(column.currencyRaw)candidates.push(currencyToken(column.currencyRaw));
      const inline=valueCurrency(raw);
      if(inline.raw||inline.code)candidates.push(inline);
      const siteCode=siteCurrency(row,kinds);
      const inferredCodes=[];
      const unresolvedLabels=new Set();
      const resolved=candidates.map(candidate=>{
        if(candidate.code)return candidate.code;
        if(candidate.raw==='克朗'&&['SEK','NOK','DKK'].includes(siteCode)){inferredCodes.push(siteCode);return siteCode;}
        if(candidate.raw)unresolvedLabels.add(candidate.raw.slice(0,48));
        return '';
      });
      unresolvedLabels.forEach(label=>unrecognized.set(label,(unrecognized.get(label)||0)+1));
      const hasUnrecognized=resolved.some((code,index)=>!code&&candidates[index]?.raw);
      if(hasUnrecognized)return;
      const codes=resolved.filter(Boolean);
      if(!codes.length){missing++;return;}
      if(new Set(codes).size>1){conflicts++;return;}
      const code=codes[0];
      const key=JSON.stringify([column.key,code]);
      const group=groups.get(key)||{label:column.label,currency:code,amount:0n,count:0};
      group.amount+=amount;group.count++;groups.set(key,group);
      new Set(inferredCodes).forEach(inferredCode=>inferred.set(inferredCode,(inferred.get(inferredCode)||0)+1));
    }));
    return {groups:[...groups.values()],missing,unrecognized:[...unrecognized].sort((a,b)=>b[1]-a[1]),inferred:[...inferred],invalid,conflicts};
  }

  function importButton(label='导入 CSV / JSON'){
    return `<label class="cf-import ${state.busy?'is-busy':''}"><span>${state.busy?'正在读取…':label}</span><input type="file" data-cf-file accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" ${state.busy?'disabled':''} aria-label="导入资金明细文件"></label>`;
  }

  function sourceBar(){
    const loading=remote.phase==='loading'||remote.metaPhase==='loading';
    const selector=remote.mode==='remote'?'<span class="cf-fixed-sheet" aria-label="资金工作表：数据表">工作表 <b>数据表</b></span>':'';
    return `<header class="cf-sourcebar"><div><h2>${remote.mode==='file'?'本地资金预览':'资金明细'}</h2>${selector}<a href="${esc(sheetSourceUrl())}" target="_blank" rel="noopener noreferrer">打开钉钉源表 ↗</a></div><div class="cf-source-actions">${remote.mode==='file'?`<button type="button" class="cf-button cf-primary" data-cf-action="remote">返回钉钉数据</button>`:`<button type="button" class="cf-button cf-primary" data-cf-action="refresh" ${loading||state.busy?'disabled':''}>${loading?'正在读取…':'刷新当前表'}</button>`}</div></header>`;
  }

  function sourceMeta(){
    if(remote.mode==='file')return `<div class="cf-import-meta"><span class="cf-source-badge">本地文件</span><span title="${esc(state.fileName)}">${esc(state.fileName)}</span><time>读取：${esc(state.importedAt)}</time>${state.sourceTime?`<span>源表时间：${esc(state.sourceTime)}</span>`:''}<span>仅在本次页面中预览</span></div>`;
    const cache=remote.cache;
    const cacheLabel=cache?.stale?'上次成功缓存':cache?.hit?`${cache.layer==='browser-memory'?'本页缓存':'服务器缓存'} · ${Math.max(0,Math.round((Number(cache.ageMs)||0)/1000))} 秒前`:cache?'实时读取':'待读取';
    return `<div class="cf-import-meta cf-remote-meta"><span class="cf-source-badge">钉钉 · ${esc(sheetName())}</span><span>源数据更新：${esc(displayTime(remote.sourceUpdatedAt))}</span><span>读取时间：${esc(displayTime(remote.fetchedAt))}</span><span class="${cache?.stale?'cf-cache-stale':''}">${esc(cacheLabel)}${cache?.ttlSeconds?` · 有效期 ${Number(cache.ttlSeconds)} 秒`:''}</span><span>工作表全部记录 · 未应用原链接视图</span></div>`;
  }

  function sourceMessages(){
    const error=state.error?`<div class="cf-error" role="alert">${esc(state.error)}</div>`:'';
    if(remote.mode==='file')return error;
    const loading=remote.phase==='loading'||remote.metaPhase==='loading';
    const failure=remote.error?`<div class="cf-error" role="alert">${esc(remote.error)}${state.rows.length?' · 当前保留上次成功读取的记录。':''} <button type="button" class="cf-button" data-cf-action="retry" ${loading?'disabled':''}>重试</button></div>`:'';
    const warning=remote.warning?`<div class="cf-source-note ${remote.cache?.stale?'cf-cache-stale':''}" role="status">${esc(remote.warning)}</div>`:'';
    const partial=remote.loadedSheetId===remote.sheetId&&!remote.complete?`<div class="cf-source-note" role="status">已读取 ${state.rows.length.toLocaleString('zh-CN')} 条，后续记录尚未读取；当前筛选和合计基于已读取记录。${remote.nextToken?`<button type="button" class="cf-button" data-cf-action="fetch-more" ${loading?'disabled':''}>继续读取后续记录</button>`:''}</div>`:'';
    return `${error}${failure}${warning}${partial}${loading?'<div class="cf-loading" role="status"><i></i>正在读取当前工作表…</div>':''}`;
  }

  function importTools(){
    return `<details class="cf-import-tools" ${remote.mode==='file'?'open':''}><summary>本地文件预览 <span>CSV / JSON</span></summary><div>${importButton(remote.mode==='file'?'重新选择文件':'选择文件')}${remote.mode==='file'?`<button type="button" class="cf-button" data-cf-action="clear" ${state.busy?'disabled':''}>关闭本地预览</button>`:''}<small>文件仅在浏览器读取，不上传至钉钉或服务器。</small></div></details>`;
  }

  function markup(){
    const chrome=`${sourceBar()}${sourceMeta()}${sourceMessages()}`;
    if(!state.rows.length){displayedRows=[];renderedCount=0;sortCache=null;const empty=remote.mode==='file'?'文件没有可显示的记录。':remote.phase==='ready'?'当前工作表暂无记录。':['error','denied'].includes(remote.phase)?'暂未读取到资金表数据。':'正在准备钉钉资金表…';return `${chrome}<div class="cf-empty">${empty}</div>${importTools()}`;}
    const kinds=fieldKinds();
    const rows=orderedRows(filteredRows());
    const summary=totals(rows,kinds);
    const storeValues=state.storeKey?[...new Set(state.rows.map(row=>text(cell(row,state.storeKey)).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')):[];
    const dateColumn=state.columns.find(column=>column.key===state.dateKey);
    const storeColumn=state.columns.find(column=>column.key===state.storeKey);
    const dateSelector=kinds.dates.length>1?`<select data-cf-filter="dateKey" aria-label="日期字段">${kinds.dates.map(column=>`<option value="${esc(column.key)}" ${state.dateKey===column.key?'selected':''}>${esc(column.label)}</option>`).join('')}</select>`:`<span>${esc(dateColumn?.label||'日期')}</span>`;
    const filters=`<div class="cf-filters"><label class="cf-search"><span class="cf-sr-only">搜索全部明细</span><input type="search" data-cf-filter="search" placeholder="搜索全部明细" value="${esc(state.search)}"></label>${kinds.dates.length?`<div class="cf-date-filter">${dateSelector}<input type="date" data-cf-filter="start" value="${esc(state.start)}" aria-label="${esc(dateColumn?.label||'日期')}开始"><span>至</span><input type="date" data-cf-filter="end" value="${esc(state.end)}" aria-label="${esc(dateColumn?.label||'日期')}结束"></div>`:''}${kinds.stores.length?`<label class="cf-store-filter"><span class="cf-sr-only">${esc(storeColumn?.label||'店铺')}</span><select data-cf-filter="store" aria-label="${esc(storeColumn?.label||'店铺')}"><option value="">全部${esc(storeColumn?.label||'店铺')}</option>${storeValues.map(value=>`<option value="${esc(value)}" ${state.store===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`:''}<button type="button" class="cf-button" data-cf-action="reset">重置</button><span class="cf-result-count">${rows.length.toLocaleString('zh-CN')} / ${state.rows.length.toLocaleString('zh-CN')} 条</span></div>`;
    const amountGroups=summary.groups.length?`<div class="cf-totals" aria-label="当前筛选的原币金额">${summary.groups.map(group=>`<article><span>${esc(group.label)} <b>${esc(group.currency)}</b></span><strong>${formatAmount(group.amount)}</strong><small>${group.count.toLocaleString('zh-CN')} 条有金额记录</small></article>`).join('')}</div>`:'';
    const notes=[];
    if(summary.missing)notes.push(`${summary.missing.toLocaleString('zh-CN')} 个金额单元格缺少币种`);
    if(summary.unrecognized.length){
      const shown=summary.unrecognized.slice(0,8).map(([label,count])=>`“${label}”（${count.toLocaleString('zh-CN')}）`);
      const rest=summary.unrecognized.length-shown.length;
      notes.push(`有值未识别币种：${shown.join('、')}${rest?`，另有 ${rest} 种`:''}`);
    }
    if(summary.invalid)notes.push(`${summary.invalid.toLocaleString('zh-CN')} 笔金额格式无法识别`);
    if(summary.conflicts)notes.push(`${summary.conflicts.toLocaleString('zh-CN')} 笔金额的币种标注不一致`);
    const inferredNote=summary.inferred.length?`按站点识别并计入汇总 ${summary.inferred.reduce((sum,[,count])=>sum+count,0).toLocaleString('zh-CN')} 个金额单元格（${summary.inferred.map(([code,count])=>`${code} ${count.toLocaleString('zh-CN')}`).join('、')}）。`:'';
    const amountNote=notes.length||inferredNote?`<p class="cf-amount-note">${notes.length?`${esc(notes.join('；'))}；缺少或未识别币种的金额未计入汇总。`:''}${inferredNote?`${notes.length?' ':''}${esc(inferredNote)}`:''}</p>`:summary.groups.length?'<p class="cf-amount-note">按原币、按金额列分别汇总当前表的筛选记录。</p>':!kinds.amounts.length?'<p class="cf-amount-note">当前表没有转账或回款金额列，显示原始记录。</p>':'';
    const transferNote=kinds.amounts.some(column=>column.transfer)?'<p class="cf-amount-note">转账金额为申请金额；到账情况需另行核对。运行状态保留原表值。</p>':'';
    const columns=visibleColumns();
    const all=state.pageSize===0;
    const pages=all?1:Math.max(1,Math.ceil(rows.length/state.pageSize));
    state.page=Math.min(pages,Math.max(1,state.page));
    const pageRows=all?rows.slice(0,state.renderLimit):rows.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
    displayedRows=rows;renderedCount=pageRows.length;
    const header=columns.map(column=>{
      const active=state.sortKey===column.key;
      const direction=active?state.sortDirection:'none';
      const next=active&&direction==='asc'?'降序':'升序';
      return `<th scope="col" ${column.role?`class="cf-column-${column.role}"`:''} aria-sort="${direction==='asc'?'ascending':direction==='desc'?'descending':'none'}"><button type="button" class="cf-sort" data-cf-sort="${esc(column.key)}" title="${esc(column.label)}：${next}；数值按原值比较" aria-label="按${esc(column.label)}${next}排序"><span>${esc(column.label)}</span><i aria-hidden="true">${active?(direction==='asc'?'↑':'↓'):'↕'}</i></button></th>`;
    }).join('');
    const table=rows.length?`<div class="cf-table-wrap" tabindex="0" aria-label="资金明细，可滚动查看记录"><table class="cf-table ${state.showAllColumns?'cf-all-columns':`cf-key-columns cf-${tableKind()}-columns`}" style="--cf-column-count:${columns.length}"><thead><tr>${header}<th class="cf-detail-heading" scope="col"><span class="cf-sr-only">完整记录</span></th></tr></thead><tbody>${pageRows.map(row=>rowMarkup(row,columns)).join('')}</tbody></table></div>`:'<div class="cf-no-match">没有符合条件的记录。<button type="button" class="cf-button" data-cf-action="reset">清空筛选</button></div>';
    const range=rows.length?`${((state.page-1)*state.pageSize+1).toLocaleString('zh-CN')}–${Math.min(state.page*state.pageSize,rows.length).toLocaleString('zh-CN')} / ${rows.length.toLocaleString('zh-CN')} 条`: '0 条';
    const pagination=`<footer class="cf-pagination"><label>显示 <select data-cf-filter="pageSize" aria-label="每页条数">${[25,50,100,0].map(size=>`<option value="${size}" ${state.pageSize===size?'selected':''}>${size||'全部'}</option>`).join('')}</select>${all?'':'条 / 页'}</label><span data-cf-page-status>${all?`已显示 ${renderedCount.toLocaleString('zh-CN')} / ${rows.length.toLocaleString('zh-CN')} 条`:`${range} · 第 ${state.page} / ${pages} 页`}</span>${all?`<button type="button" class="cf-button" data-cf-action="more" ${renderedCount>=rows.length?'hidden':''}>继续显示</button>`:`<button type="button" class="cf-button" data-cf-action="prev" ${state.page<=1?'disabled':''}>上一页</button><button type="button" class="cf-button" data-cf-action="next" ${state.page>=pages?'disabled':''}>下一页</button>`}</footer>`;
    return `${chrome}${filters}${amountGroups}${amountNote}${transferNote}<div class="cf-ledger"><div class="cf-table-title"><strong>${remote.mode==='file'?'文件明细':esc(sheetName())}</strong><div class="cf-column-controls"><span>${state.showAllColumns?`${state.columns.length} 列`:`关键 ${columns.length} 列 · 详情查看完整记录`}</span><label><input type="checkbox" data-cf-columns-all ${state.showAllColumns?'checked':''}>全部字段</label></div></div>${table}${pagination}</div>${importTools()}`;
  }

  function paint(focusKey){
    if(!mounted||!mounted.isConnected)return;
    const old=focusKey?mounted.querySelector(`[data-cf-filter="${focusKey}"]`):null;
    const selection=old?.selectionStart;
    const previousTable=mounted.querySelector('.cf-table-wrap');
    const scrollTop=state.resetScroll?0:(previousTable?.scrollTop||0),scrollLeft=previousTable?.scrollLeft||0;
    mounted.innerHTML=markup();
    const table=mounted.querySelector('.cf-table-wrap');
    if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
    state.resetScroll=false;
    if(focusKey){const input=mounted.querySelector(`[data-cf-filter="${focusKey}"]`);input?.focus({preventScroll:true});if(selection!==null&&selection!==undefined&&input?.type==='search')input.setSelectionRange(selection,selection);}
  }

  async function readFile(file){
    if(!file)return;
    if(synchronizeAuthScope())return;
    const scope=authScope;
    const fileIntent=++fileSequence;
    state.busy=true;state.error='';paint();
    try{
      if(!/\.(csv|tsv|json)$/i.test(file.name))throw new Error('请导入 CSV 或 JSON 文件；Excel 文件请先另存为 CSV。');
      if(file.size>20*1024*1024)throw new Error('文件超过 20 MB，请分批导出资金明细。');
      const bytes=await file.arrayBuffer();
      synchronizeAuthScope();
      if(scope!==authScope||fileIntent!==fileSequence)return;
      let source;
      try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(error){
        try{source=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch(decodeError){throw new Error('无法读取文件文字，请重新导出为 UTF-8 CSV 后导入。');}
      }
      const parsed=/\.json$/i.test(file.name)||/^[\s\uFEFF]*[\[{]/.test(source)?jsonRows(source):csvRows(source);
      if(!parsed.rows.length)throw new Error('文件只有表头，没有明细记录。');
      if(parsed.rows.length>100000)throw new Error('记录超过 100,000 条，请分批导出资金明细。');
      remoteSequence++;remote.mode='file';if(remote.phase==='loading')remote.phase='idle';
      state.columns=parsed.columns;state.rows=parsed.rows.map((row,index)=>({...row,id:index}));
      state.fileName=file.name;state.importedAt=new Date().toLocaleString('zh-CN',{hour12:false});state.sourceTime=parsed.sourceTime||'';
      state.search='';state.start='';state.end='';state.store='';state.page=1;state.sortKey=null;state.sortDirection='asc';state.showAllColumns=false;state.renderLimit=250;state.resetScroll=true;state.expanded.clear();sortCache=null;
      const kinds=fieldKinds();state.dateKey=kinds.dates[0]?.key||'';state.storeKey=kinds.stores[0]?.key||'';
    }catch(error){if(scope!==authScope||fileIntent!==fileSequence)return;state.error=error instanceof SyntaxError?'JSON 格式无法识别，请检查文件后重新导入。':error.message||'文件无法读取，请重新导出后导入。';}
    finally{if(scope===authScope&&fileIntent===fileSequence){state.busy=false;paint();}}
  }

  function resetFilters(){state.search='';state.start='';state.end='';state.store='';state.page=1;state.sortKey=null;state.sortDirection='asc';state.renderLimit=250;state.resetScroll=true;state.error='';}

  function mount(root){
    const host=typeof root==='string'?document.querySelector(root):root;
    mounted=host?.matches?.('.cashflow-view')?host:host?.querySelector?.('.cashflow-view');
    if(!mounted)return;
    synchronizeAuthScope();
    if(bound.has(mounted)){void ensureLoaded();return;}
    bound.add(mounted);
    mounted.addEventListener('click',event=>{
      if(synchronizeAuthScope())return;
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-cf-sort')){const key=button.dataset.cfSort;state.sortDirection=state.sortKey===key&&state.sortDirection==='asc'?'desc':'asc';state.sortKey=key;state.page=1;state.renderLimit=250;state.resetScroll=true;paint();mounted.querySelectorAll('[data-cf-sort]').forEach(node=>{if(node.dataset.cfSort===key)node.focus({preventScroll:true});});return;}
      if(button.hasAttribute('data-cf-detail')){const id=Number(button.dataset.cfDetail);state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);paint();mounted.querySelector(`[data-cf-detail="${id}"]`)?.focus({preventScroll:true});return;}
      const action=button.dataset.cfAction;
      if(action==='more'){appendRows();return;}
      if(action==='remote'||action==='clear'){returnToRemote();return;}
      if(action==='refresh'||action==='retry'){void ensureLoaded({refresh:true});return;}
      if(action==='fetch-more'){void loadRemoteSheet({append:true});return;}
      if(action==='reset')resetFilters();
      else if(action==='prev'){state.page--;state.resetScroll=true;}
      else if(action==='next'){state.page++;state.resetScroll=true;}
      else return;
      paint();
    });
    mounted.addEventListener('input',event=>{
      if(synchronizeAuthScope())return;
      if(event.target.dataset.cfFilter!=='search'||event.isComposing||composing)return;
      state.search=event.target.value;state.page=1;state.renderLimit=250;state.resetScroll=true;paint('search');
    });
    mounted.addEventListener('compositionstart',()=>{if(!synchronizeAuthScope())composing=true;});
    mounted.addEventListener('compositionend',event=>{
      if(synchronizeAuthScope())return;
      composing=false;
      if(event.target.dataset.cfFilter!=='search')return;
      state.search=event.target.value;state.page=1;state.renderLimit=250;state.resetScroll=true;paint('search');
    });
    mounted.addEventListener('change',event=>{
      if(synchronizeAuthScope())return;
      if(event.target.hasAttribute('data-cf-file')){void readFile(event.target.files?.[0]);return;}
      if(event.target.hasAttribute('data-cf-columns-all')){
        state.showAllColumns=event.target.checked;state.resetScroll=true;
        if(!state.showAllColumns&&!visibleColumns().some(column=>column.key===state.sortKey)){state.sortKey=null;state.sortDirection='asc';sortCache=null;}
        paint();return;
      }
      const key=event.target.dataset.cfFilter;if(!key||key==='search')return;
      state[key]=key==='pageSize'?Number(event.target.value):event.target.value;state.page=1;state.renderLimit=250;state.resetScroll=true;
      if(key==='dateKey'){state.start='';state.end='';}
      if(state.start&&state.end&&state.start>state.end){state.error='开始日期不能晚于结束日期。';paint(key);return;}
      state.error='';paint();
    });
    mounted.addEventListener('scroll',event=>{
      if(synchronizeAuthScope())return;
      const table=event.target;
      if(table?.matches?.('.cf-table-wrap')&&table.scrollHeight-table.scrollTop-table.clientHeight<150)appendRows();
    },{capture:true,passive:true});
    void ensureLoaded();
  }

  window.CashflowView=Object.freeze({render:()=>{synchronizeAuthScope();return `<section class="cashflow-view" aria-label="回款与资金明细">${markup()}</section>`;},mount,ensureLoaded,refresh:()=>ensureLoaded({refresh:true})});
})();
