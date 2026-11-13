package com.ruoyi.system.service.impl;

import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import com.ruoyi.common.annotation.DataSource;
import com.ruoyi.common.enums.DataSourceType;
import com.ruoyi.common.exception.ServiceException;

/** Three source files are parsed together and quantities remain at their original grain. */
@Service
@DataSource(DataSourceType.ANALYTICS)
public class WarehouseImportService {
 private final JdbcTemplate jdbc;
 private final Map<String, Batch> previews = new ConcurrentHashMap<>();
 private record Batch(List<List<String>> inventory, List<List<String>> age, List<List<String>> relation, List<String> files, String owner, long created) {}
 public WarehouseImportService(JdbcTemplate jdbc) { this.jdbc=jdbc; }
 public Map<String,Object> preview(MultipartFile inventoryFile, MultipartFile stockAgeFile, MultipartFile relationFile, String owner) throws IOException {
  previews.entrySet().removeIf(e -> System.currentTimeMillis()-e.getValue().created()>3600000);
  if(previews.size()>=20) throw new ServiceException("预览数量已达上限，请稍后重试。");
  Batch b = new Batch(read(inventoryFile,22,"SKU","Barcode"), read(stockAgeFile,10,"SKU","Product name"), read(relationFile,7,"Platform Store Code","Platform SKU"), List.of(name(inventoryFile),name(stockAgeFile),name(relationFile)),owner,System.currentTimeMillis());
  normalizeWarehouse(b.inventory(), 5, 22); normalizeWarehouse(b.age(), 2, 10);
  String id=UUID.randomUUID().toString(); previews.put(id,b);
  Set<String> warehouses=new TreeSet<>(); for(List<String> r:b.inventory()) if(!r.get(5).isBlank()) warehouses.add(r.get(5));
  Map<String,Object> out=new LinkedHashMap<>(); out.put("id",id); out.put("status","PREVIEW"); out.put("inventoryCount",b.inventory().size()); out.put("stockAgeCount",b.age().size()); out.put("relationCount",b.relation().size()); out.put("warehouses",warehouses); return out;
 }
 private void normalizeWarehouse(List<List<String>> rows, int column, int cols) {
  for (List<String> row : rows) {
   String warehouse = row.get(column).trim();
   if (row.get(0).isBlank()) throw new ServiceException("第" + row.get(cols) + "行 SKU 不能为空。");
   row.set(column, normalizeFlashWarehouseName(warehouse, row.get(cols)));
  }
 }
 static String normalizeFlashWarehouseName(String warehouse, String sourceRow) {
  String value = Objects.requireNonNullElse(warehouse, "").trim();
  if (value.equalsIgnoreCase("美东New Brunswick(NJ)")
      || value.equalsIgnoreCase("FLash海外仓")
      || value.equalsIgnoreCase("1仓-91761仓(FLASH01)")) {
   return "FLash海外仓";
  }
  throw new ServiceException("第" + sourceRow + "行仓库无法识别：" + value);
 }
 private String name(MultipartFile f) { return Objects.requireNonNullElse(f.getOriginalFilename(),"upload.xlsx").replaceAll("^.*[/\\\\]",""); }
 private List<List<String>> read(MultipartFile f,int cols,String first,String second) throws IOException {
  if(f==null || f.isEmpty() || f.getSize()>10*1024*1024 || !name(f).toLowerCase(Locale.ROOT).endsWith(".xlsx")) throw new ServiceException("请选择不超过10MB的xlsx文件。");
  try(InputStream in=f.getInputStream(); Workbook book=new XSSFWorkbook(in)) {
   Sheet s=book.getSheetAt(0); DataFormatter fmt=new DataFormatter(Locale.ROOT); Row h=s.getRow(0);
   if(h==null || !fmt.formatCellValue(h.getCell(0)).startsWith(first) || !fmt.formatCellValue(h.getCell(1)).startsWith(second)) throw new ServiceException("文件表头不匹配，请检查三份文件。");
   String[] expected = cols==22 ? new String[]{"SKU","Barcode","FNSKU","Other Barcode","Product Name","Warehouse","Stock Property","Total Stock","Available Inventory","Locked Inventory","Distribution Occupied Inventory","In-transit inventory","Oms Length","OMS Width","OMS Height","OMS Weight","WMS Length","WMS Width","WMS Height","WMS Weight","Unit","Unit"} : cols==10 ? new String[]{"SKU","Product name","Warehouse","Stock properties","Stock count date","Putaway date","Qty","Stock age","Dimension","Total volume"} : new String[]{"Platform Store Code","Platform SKU","System SKU","Qty","System SKU Name","System SKU Status","Create time"};
   for(int c=0;c<expected.length;c++) if(h.getCell(c)==null || !fmt.formatCellValue(h.getCell(c)).startsWith(expected[c])) throw new ServiceException("文件第"+(c+1)+"列表头不匹配。");
   if(s.getLastRowNum()>20000) throw new ServiceException("文件超过20000行限制。");
   List<List<String>> rows=new ArrayList<>();
   for(int i=1;i<=s.getLastRowNum();i++){ Row row=s.getRow(i); if(row==null) continue; List<String> values=new ArrayList<>(); boolean any=false;
    for(int c=0;c<cols;c++){Cell cell=row.getCell(c); if(cell!=null && cell.getCellType()==CellType.FORMULA) throw new ServiceException("文件不能包含公式。"); String v=cell==null?"":(cell.getCellType()==CellType.NUMERIC && DateUtil.isCellDateFormatted(cell) ? new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(cell.getDateCellValue()) : fmt.formatCellValue(cell).trim()); if(v.length()>500) throw new ServiceException("单元格内容过长。"); values.add(v); any|=!v.isEmpty();} if(any){values.add(Integer.toString(i+1)); rows.add(values);} }
   if(rows.isEmpty()) throw new ServiceException("文件没有数据行。");
   int[] numeric = cols==22 ? new int[]{7,8,9,10,11,12,13,14,15,16,17,18,19} : cols==10 ? new int[]{6,7} : new int[]{3};
   for(List<String> row:rows) for(int index:numeric) if(!row.get(index).isEmpty()) try { new java.math.BigDecimal(row.get(index).replace(",", "")); row.set(index,row.get(index).replace(",", "")); } catch(NumberFormatException e) { throw new ServiceException("第"+row.get(cols)+"行数值格式不正确。"); }
   return rows;
  } catch(ServiceException e){throw e;} catch(Exception e){throw new ServiceException("文件解析失败，请检查文件格式。");}
 }
 @Transactional(rollbackFor=Exception.class)
 public synchronized Map<String,Object> commit(String id, String owner){
  Batch b=previews.get(id); if(b==null || !b.owner().equals(owner) || System.currentTimeMillis()-b.created()>3600000) throw new ServiceException("预览已失效，请重新上传。");
  String[] types={"inventory","stock_age","relation"}; List<List<List<String>>> all=List.of(b.inventory(),b.age(),b.relation());
  String[] tables={"ow_product_inventory","ow_product_stock_age","ow_platform_product_relation"};
  String[] fields={"system_sku,barcode,fnsku,other_barcode,product_name,warehouse,stock_property,total_stock,available_inventory,locked_inventory,distribution_occupied_inventory,in_transit_inventory,oms_length,oms_width,oms_height,oms_weight,wms_length,wms_width,wms_height,wms_weight,length_unit,weight_unit", "system_sku,product_name,warehouse,stock_properties,stock_count_date,putaway_date,qty,stock_age,dimension,total_volume", "platform_store_code,platform_sku,system_sku,qty,system_sku_name,system_sku_status,source_create_time"};
  for(int k=0;k<3;k++) { jdbc.update("INSERT INTO rpa_database.ow_import_batch(group_id,source_type,source_file) VALUES(?,?,?)",id,types[k],b.files().get(k)); Long batch=jdbc.queryForObject("SELECT LAST_INSERT_ID()",Long.class); int n=fields[k].split(",").length; String placeholders=String.join(",",Collections.nCopies(n+2,"?")); String sql="INSERT INTO rpa_database."+tables[k]+" (batch_id,source_row,"+fields[k]+") VALUES ("+placeholders+")";
   for(List<String> row:all.get(k)){Object[] args=new Object[n+2]; args[0]=batch; args[1]=Integer.valueOf(row.get(n)); for(int j=0;j<n;j++) args[j+2]=row.get(j).isEmpty()?null:row.get(j); jdbc.update(sql,args);}
  }
  previews.remove(id); return Map.of("id",id,"status","IMPORTED");
 }
 public Map<String,Object> inventory(){
  List<Map<String,Object>> groups=jdbc.queryForList("SELECT i.warehouse, MAX(b.id) batchId FROM rpa_database.ow_product_inventory i JOIN rpa_database.ow_import_batch b ON b.id=i.batch_id WHERE b.source_type='inventory' AND i.warehouse IS NOT NULL AND EXISTS (SELECT 1 FROM rpa_database.ow_import_batch x WHERE x.group_id=b.group_id AND x.source_type='stock_age') AND EXISTS (SELECT 1 FROM rpa_database.ow_import_batch x WHERE x.group_id=b.group_id AND x.source_type='relation') GROUP BY i.warehouse");
  List<Map<String,Object>> result = new ArrayList<>(); Object importedAt = null;
  for (Map<String,Object> selected : groups) {
   Long batchId = ((Number) selected.get("batchId")).longValue();
   Map<String,Object> batch = jdbc.queryForMap("SELECT group_id, imported_at FROM rpa_database.ow_import_batch WHERE id=?", batchId);
   String group = batch.get("group_id").toString(); Object warehouse = selected.get("warehouse");
   importedAt = batch.get("imported_at");
   List<Map<String,Object>> rows=jdbc.queryForList("SELECT i.system_sku systemSku,i.warehouse,i.stock_property stockProperty,i.total_stock totalStock,i.available_inventory availableInventory,i.in_transit_inventory inTransitInventory,i.product_name productName,i.source_row sourceRow,b.source_file sourceFile FROM rpa_database.ow_product_inventory i JOIN rpa_database.ow_import_batch b ON b.id=i.batch_id WHERE i.batch_id=? AND i.warehouse=?",batchId,warehouse);
   List<Map<String,Object>> rel=jdbc.queryForList("SELECT r.system_sku systemSku,r.platform_store_code platformStoreCode,r.platform_sku platformSku,r.qty FROM rpa_database.ow_platform_product_relation r JOIN rpa_database.ow_import_batch b ON b.id=r.batch_id WHERE b.group_id=? AND b.source_type='relation'",group);
   List<Map<String,Object>> ages=jdbc.queryForList("SELECT a.system_sku systemSku,a.warehouse,a.stock_properties stockProperty,a.qty,a.stock_age stockAge,a.putaway_date putawayDate FROM rpa_database.ow_product_stock_age a JOIN rpa_database.ow_import_batch b ON b.id=a.batch_id WHERE b.group_id=? AND b.source_type='stock_age' AND a.warehouse=?",group,warehouse);
   for(Map<String,Object> row:rows){row.put("relations",rel.stream().filter(r->Objects.equals(r.get("systemSku"),row.get("systemSku")) && row.get("systemSku")!=null).toList()); row.put("stockAges",ages.stream().filter(a->Objects.equals(a.get("systemSku"),row.get("systemSku")) && row.get("systemSku")!=null && Objects.equals(a.get("warehouse"),row.get("warehouse")) && Objects.equals(a.get("stockProperty"),row.get("stockProperty"))).toList()); row.put("importedAt", batch.get("imported_at"));}
   result.addAll(rows);
  }
  Map<String,Object> out = new LinkedHashMap<>(); out.put("rows",result); out.put("importedAt",importedAt); return out;
 }
}
