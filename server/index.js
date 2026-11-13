import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const MAX_FILE = 10 * 1024 * 1024;
const TTL = 60 * 60 * 1000;
const previews = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'analytics.sqlite'));
db.exec(`
 PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS flash_import_batch (id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, source_type TEXT NOT NULL, source_file TEXT NOT NULL, imported_at TEXT NOT NULL, UNIQUE(group_id,source_type));
 CREATE TABLE IF NOT EXISTS flash_product_inventory (id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL,source_row INTEGER NOT NULL,system_sku TEXT NOT NULL,barcode TEXT,fnsku TEXT,other_barcode TEXT,product_name TEXT,warehouse TEXT NOT NULL,stock_property TEXT,total_stock REAL,available_inventory REAL,locked_inventory REAL,distribution_occupied_inventory REAL,in_transit_inventory REAL,oms_length REAL,oms_width REAL,oms_height REAL,oms_weight REAL,wms_length REAL,wms_width REAL,wms_height REAL,wms_weight REAL,length_unit TEXT,weight_unit TEXT);
 CREATE TABLE IF NOT EXISTS flash_product_stock_age (id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL,source_row INTEGER NOT NULL,system_sku TEXT NOT NULL,product_name TEXT,warehouse TEXT NOT NULL,stock_property TEXT,stock_count_date TEXT,putaway_date TEXT,qty REAL,stock_age REAL,dimension TEXT,total_volume TEXT);
 CREATE TABLE IF NOT EXISTS flash_platform_product_relation (id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL,source_row INTEGER NOT NULL,platform_store_code TEXT NOT NULL,platform_sku TEXT NOT NULL,system_sku TEXT NOT NULL,qty REAL,system_sku_name TEXT,system_sku_status TEXT,source_create_time TEXT);
 CREATE INDEX IF NOT EXISTS idx_flash_inventory_sku ON flash_product_inventory(batch_id,system_sku);
 CREATE INDEX IF NOT EXISTS idx_flash_age_sku ON flash_product_stock_age(batch_id,system_sku);
 CREATE INDEX IF NOT EXISTS idx_flash_relation_sku ON flash_platform_product_relation(batch_id,system_sku);
`);

const text = value => String(value ?? '').trim();
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
const success = (res, data) => json(res, 200, { code: 200, data });
const fail = (res, status, msg) => json(res, status, { code: status, msg });
const number = (value, column, sourceRow) => { const raw = text(value).replaceAll(',', ''); if (!raw) return null; const n = Number(raw); if (!Number.isFinite(n)) throw new Error(`第 ${sourceRow} 行 ${column} 必须为数字`); return n; };
const allowedWarehouse = (value, sourceRow) => { if (!['美东New Brunswick(NJ)', 'FLash海外仓'].some(x => x.toLowerCase() === text(value).toLowerCase())) throw new Error(`第 ${sourceRow} 行仓库无法识别：${text(value) || '空值'}`); return 'FLash海外仓'; };

const layouts = {
 inventory: { field: 'inventoryFile', title: '产品库存表', headers: ['SKU','Barcode','FNSKU','Other Barcode','Product Name','Warehouse','Stock Property','Total Stock','Available Inventory','Locked Inventory','Distribution Occupied Inventory','In-transit inventory','Oms Length','OMS Width','OMS Height','OMS Weight','WMS Length','WMS Width','WMS Height','WMS Weight','Unit','Unit'] },
 stockAge: { field: 'stockAgeFile', title: '产品库龄表', headers: ['SKU','Product name','Warehouse','Stock properties','Stock count date','Putaway date','Qty','Stock age','Dimension','Total volume'] },
 relation: { field: 'relationFile', title: '平台产品关联表', headers: ['Platform Store Code','Platform SKU','System SKU','Qty','System SKU Name','System SKU Status','Create time'] }
};

function readSheet(file, layout) {
 if (!file || !file.filename.toLowerCase().endsWith('.xlsx') || !file.size || file.size > MAX_FILE) throw new Error(`${layout.title} 必须是 10MB 以内的 .xlsx 文件`);
 let book; try { book = XLSX.read(file.data, { type: 'buffer', raw: false, cellDates: true }); } catch { throw new Error(`${layout.title} 无法读取，请检查文件格式`); }
 const sheet = book.Sheets[book.SheetNames[0]]; const source = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
 if (source.length < 2) throw new Error(`${layout.title} 没有数据行`); if (source.length - 1 > 20_000) throw new Error(`${layout.title} 超过 20000 行限制`);
 layout.headers.forEach((heading, index) => { if (!text(source[0][index]).startsWith(heading)) throw new Error(`${layout.title} 第 ${index + 1} 列表头不匹配，期望 ${heading}`); });
 return source.slice(1).map((sourceRow, index) => ({ sourceRow: index + 2, values: layout.headers.map((_, column) => text(sourceRow[column])) }));
}

function parseFlash(files) {
 const inventory = readSheet(files.inventoryFile, layouts.inventory).map(({sourceRow,values:v}) => { if (!v[0]) throw new Error(`第 ${sourceRow} 行 SKU 不能为空`); return {sourceRow,systemSku:v[0],barcode:v[1],fnsku:v[2],otherBarcode:v[3],productName:v[4],warehouse:allowedWarehouse(v[5],sourceRow),stockProperty:v[6],totalStock:number(v[7],'Total Stock',sourceRow),availableInventory:number(v[8],'Available Inventory',sourceRow),lockedInventory:number(v[9],'Locked Inventory',sourceRow),distributionOccupiedInventory:number(v[10],'Distribution Occupied Inventory',sourceRow),inTransitInventory:number(v[11],'In-transit inventory',sourceRow),omsLength:number(v[12],'Oms Length',sourceRow),omsWidth:number(v[13],'OMS Width',sourceRow),omsHeight:number(v[14],'OMS Height',sourceRow),omsWeight:number(v[15],'OMS Weight',sourceRow),wmsLength:number(v[16],'WMS Length',sourceRow),wmsWidth:number(v[17],'WMS Width',sourceRow),wmsHeight:number(v[18],'WMS Height',sourceRow),wmsWeight:number(v[19],'WMS Weight',sourceRow),lengthUnit:v[20],weightUnit:v[21]}; });
 const stockAge = readSheet(files.stockAgeFile, layouts.stockAge).map(({sourceRow,values:v}) => { if (!v[0]) throw new Error(`第 ${sourceRow} 行 SKU 不能为空`); return {sourceRow,systemSku:v[0],productName:v[1],warehouse:allowedWarehouse(v[2],sourceRow),stockProperty:v[3],stockCountDate:v[4],putawayDate:v[5],qty:number(v[6],'Qty',sourceRow),stockAge:number(v[7],'Stock age',sourceRow),dimension:v[8],totalVolume:v[9]}; });
 const relation = readSheet(files.relationFile, layouts.relation).map(({sourceRow,values:v}) => { if (!v[0] || !v[1] || !v[2]) throw new Error(`第 ${sourceRow} 行店铺代码、平台 SKU、System SKU 均不能为空`); return {sourceRow,platformStoreCode:v[0],platformSku:v[1],systemSku:v[2],qty:number(v[3],'Qty',sourceRow),systemSkuName:v[4],systemSkuStatus:v[5],sourceCreateTime:v[6]}; });
 const inv = new Set(inventory.map(r => r.systemSku)), age = new Set(stockAge.map(r => r.systemSku)), rel = new Set(relation.map(r => r.systemSku)); const only = (a,b) => [...a].filter(x => !b.has(x)).length;
 return {inventory,stockAge,relation,reconciliation:{relationOnly:only(rel,inv),inventoryOnly:only(inv,rel),ageOnly:only(age,inv),inventoryWithoutAge:only(inv,age)}};
}

function parseMultipart(req) {
 const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] || ''); const boundary = match?.[1] || match?.[2]; if (!boundary) throw new Error('需要 multipart/form-data 上传三份文件');
 return new Promise((resolve,reject) => { const chunks=[]; let size=0; req.on('data',chunk => { size += chunk.length; if (size > MAX_FILE * 3 + 1024 * 1024) { reject(new Error('上传内容过大')); req.destroy(); } else chunks.push(chunk); }); req.on('error',reject); req.on('end',() => {
  const body=Buffer.concat(chunks), marker=Buffer.from(`--${boundary}`), files={}; let at=body.indexOf(marker)+marker.length;
  while(at >= marker.length && at < body.length) { if(body.subarray(at,at+2).equals(Buffer.from('--'))) break; if(body.subarray(at,at+2).equals(Buffer.from('\r\n'))) at+=2; const next=body.indexOf(marker,at); if(next<0) break; const part=body.subarray(at,next-2), divider=part.indexOf(Buffer.from('\r\n\r\n')); if(divider>=0){const head=part.subarray(0,divider).toString('utf8'),name=/name="([^"]+)"/.exec(head)?.[1],filename=/filename="([^"]*)"/.exec(head)?.[1];if(name&&filename){const content=part.subarray(divider+4);files[name]={filename:path.basename(filename),data:content,size:content.length};}} at=next+marker.length; }
  resolve(files);
 }); });
}

function createPreview(files) { for(const [key,layout] of Object.entries(layouts)) if(!files[layout.field]) throw new Error(`缺少${layout.title}`); const parsed=parseFlash(files); const id=randomUUID(); const value={id,createdAt:Date.now(),...parsed,files:{inventory:files.inventoryFile,stock_age:files.stockAgeFile,relation:files.relationFile}}; previews.set(id,value); for(const [key,p] of previews)if(Date.now()-p.createdAt>TTL)previews.delete(key); return value; }
function latest() { return db.prepare('SELECT group_id FROM flash_import_batch GROUP BY group_id HAVING COUNT(*)=3 ORDER BY MAX(imported_at) DESC,MAX(id) DESC LIMIT 1').get()?.group_id; }
function commit(preview) {
 const groupId=randomUUID(), importedAt=new Date().toISOString(), batch={}; const batchInsert=db.prepare('INSERT INTO flash_import_batch(group_id,source_type,source_file,imported_at) VALUES(?,?,?,?)');
 const invInsert=db.prepare('INSERT INTO flash_product_inventory(batch_id,source_row,system_sku,barcode,fnsku,other_barcode,product_name,warehouse,stock_property,total_stock,available_inventory,locked_inventory,distribution_occupied_inventory,in_transit_inventory,oms_length,oms_width,oms_height,oms_weight,wms_length,wms_width,wms_height,wms_weight,length_unit,weight_unit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const ageInsert=db.prepare('INSERT INTO flash_product_stock_age(batch_id,source_row,system_sku,product_name,warehouse,stock_property,stock_count_date,putaway_date,qty,stock_age,dimension,total_volume) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
 const relInsert=db.prepare('INSERT INTO flash_platform_product_relation(batch_id,source_row,platform_store_code,platform_sku,system_sku,qty,system_sku_name,system_sku_status,source_create_time) VALUES(?,?,?,?,?,?,?,?,?)');
 db.exec('BEGIN IMMEDIATE'); try { for(const [type,file] of Object.entries(preview.files))batch[type]=Number(batchInsert.run(groupId,type,file.filename,importedAt).lastInsertRowid); for(const r of preview.inventory)invInsert.run(batch.inventory,r.sourceRow,r.systemSku,r.barcode,r.fnsku,r.otherBarcode,r.productName,r.warehouse,r.stockProperty,r.totalStock,r.availableInventory,r.lockedInventory,r.distributionOccupiedInventory,r.inTransitInventory,r.omsLength,r.omsWidth,r.omsHeight,r.omsWeight,r.wmsLength,r.wmsWidth,r.wmsHeight,r.wmsWeight,r.lengthUnit,r.weightUnit); for(const r of preview.stockAge)ageInsert.run(batch.stock_age,r.sourceRow,r.systemSku,r.productName,r.warehouse,r.stockProperty,r.stockCountDate,r.putawayDate,r.qty,r.stockAge,r.dimension,r.totalVolume); for(const r of preview.relation)relInsert.run(batch.relation,r.sourceRow,r.platformStoreCode,r.platformSku,r.systemSku,r.qty,r.systemSkuName,r.systemSkuStatus,r.sourceCreateTime); db.exec('COMMIT'); }catch(error){db.exec('ROLLBACK');throw error;}
 return {id:preview.id,groupId,status:'IMPORTED',importedAt,inventoryCount:preview.inventory.length,stockAgeCount:preview.stockAge.length,relationCount:preview.relation.length};
}
function inventory() {
 const groupId=latest(); if(!groupId)return {rows:[],groupId:null,importedAt:null}; const records=db.prepare('SELECT id,source_type,source_file,imported_at FROM flash_import_batch WHERE group_id=?').all(groupId); const batches=Object.fromEntries(records.map(x=>[x.source_type,x]));
 const rows=db.prepare('SELECT source_row sourceRow,system_sku systemSku,warehouse,stock_property stockProperty,total_stock totalStock,available_inventory availableInventory,locked_inventory lockedInventory,distribution_occupied_inventory distributionOccupiedInventory,in_transit_inventory inTransitInventory,product_name productName FROM flash_product_inventory WHERE batch_id=? ORDER BY source_row').all(batches.inventory.id);
 const relations=db.prepare('SELECT system_sku systemSku,platform_store_code platformStoreCode,platform_sku platformSku,qty,system_sku_name systemSkuName,system_sku_status systemSkuStatus FROM flash_platform_product_relation WHERE batch_id=? ORDER BY source_row').all(batches.relation.id); const ages=db.prepare('SELECT system_sku systemSku,warehouse,stock_property stockProperty,qty,stock_age stockAge,stock_count_date stockCountDate,putaway_date putawayDate FROM flash_product_stock_age WHERE batch_id=? ORDER BY source_row').all(batches.stock_age.id);
 const bySku=(values)=>Map.groupBy(values,x=>x.systemSku);const relationsBySku=bySku(relations),agesBySku=bySku(ages);return {groupId,importedAt:batches.inventory.imported_at,rows:rows.map(row=>({...row,sourceFile:batches.inventory.source_file,relations:relationsBySku.get(row.systemSku)||[],stockAges:agesBySku.get(row.systemSku)||[]}))};
}

export const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),base='/prod-api/business/inventory/overseas';if(url.pathname==='/api/health'&&req.method==='GET')return success(res,{status:'ok',storage:'sqlite'});if(url.pathname===`${base}/warehouse-imports`&&req.method==='POST'){const preview=createPreview(await parseMultipart(req));return success(res,{id:preview.id,status:'PREVIEW',inventoryCount:preview.inventory.length,stockAgeCount:preview.stockAge.length,relationCount:preview.relation.length,warehouses:['FLash海外仓'],reconciliation:preview.reconciliation});}const matched=new RegExp(`^${base}/warehouse-imports/([^/]+)/commit$`).exec(url.pathname);if(matched&&req.method==='POST'){const preview=previews.get(matched[1]);if(!preview)return fail(res,404,'预览已失效，请重新上传');const result=commit(preview);previews.delete(preview.id);return success(res,result);}if(url.pathname===`${base}/warehouse-inventory`&&req.method==='GET')return success(res,inventory());if(url.pathname.startsWith('/prod-api/')||url.pathname.startsWith('/api/'))return fail(res,501,`独立版尚未接入此接口或数据源：${url.pathname}`);if(!['GET','HEAD'].includes(req.method))return fail(res,405,'不支持此请求方法');const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),target=path.resolve(web,'.'+name);if(!target.startsWith(web+path.sep)||!existsSync(target))return fail(res,404,'文件不存在');const actual=await realpath(target),actualWeb=await realpath(web);if(!actual.startsWith(actualWeb+path.sep))return fail(res,403,'禁止访问');const content=await readFile(actual);res.writeHead(200,{'Content-Type':mime[path.extname(actual).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);}catch(error){fail(res,400,error instanceof Error?error.message:'请求无效');}});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}`));}
