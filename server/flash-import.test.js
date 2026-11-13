import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import * as XLSX from 'xlsx';
import { server } from './index.js';

const headers = {
  inventory: ['SKU','Barcode','FNSKU','Other Barcode','Product Name','Warehouse','Stock Property','Total Stock','Available Inventory','Locked Inventory','Distribution Occupied Inventory','In-transit inventory','Oms Length','OMS Width','OMS Height','OMS Weight','WMS Length','WMS Width','WMS Height','WMS Weight','Unit','Unit'],
  age: ['SKU','Product name','Warehouse','Stock properties','Stock count date','Putaway date','Qty','Stock age','Dimension','Total volume'],
  relation: ['Platform Store Code','Platform SKU','System SKU','Qty','System SKU Name','System SKU Status','Create time']
};
function xlsx(rows) { const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Sheet1'); return new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'flash.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); }
test('imports all three Flash sheets while retaining many platform relations', async () => {
  server.listen(0,'127.0.0.1'); await once(server,'listening'); const port=server.address().port;
  try {
    const form=new FormData();
    form.set('inventoryFile',xlsx([headers.inventory,['SKU-1','','','','Product','美东New Brunswick(NJ)','良品',10,7,3,0,2,'','','','','','','','','','']]));
    form.set('stockAgeFile',xlsx([headers.age,['SKU-1','Product','美东New Brunswick(NJ)','良品','2026-11-09','2026-10-01',7,39,'']]));
    form.set('relationFile',xlsx([headers.relation,['Amazon-US','MSKU-1','SKU-1',7,'Product','active','2026-11-01'],['TikTok-US','MSKU-2','SKU-1',7,'Product','active','2026-11-01']]));
    const preview=await fetch(`http://127.0.0.1:${port}/prod-api/business/inventory/overseas/warehouse-imports`,{method:'POST',body:form}).then(r=>r.json());
    assert.equal(preview.code,200); assert.equal(preview.data.inventoryCount,1); assert.equal(preview.data.relationCount,2);
    const committed=await fetch(`http://127.0.0.1:${port}/prod-api/business/inventory/overseas/warehouse-imports/${preview.data.id}/commit`,{method:'POST'}).then(r=>r.json());
    assert.equal(committed.data.status,'IMPORTED');
    const result=await fetch(`http://127.0.0.1:${port}/prod-api/business/inventory/overseas/warehouse-inventory`).then(r=>r.json());
    assert.equal(result.data.rows.length,1); assert.equal(result.data.rows[0].warehouse,'FLash海外仓'); assert.equal(result.data.rows[0].availableInventory,7); assert.equal(result.data.rows[0].relations.length,2); assert.equal(result.data.rows[0].stockAges.length,1);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
