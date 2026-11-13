package com.ruoyi.system.service.impl;
import java.lang.reflect.Proxy;
import java.time.*;
import java.util.*;
import java.io.StringWriter;
import org.junit.Test;
import static org.junit.Assert.*;
import com.ruoyi.system.mapper.OverseasInventoryMapper;
public class OverseasSnapshotIntegrationTest {
 @Test public void currentMonthReplacesOnlyFlashAndExportMatches() throws Exception {
  String current=YearMonth.now(ZoneId.of("Asia/Shanghai")).toString();
  Map<String,Object> flash=new LinkedHashMap<>(Map.of("warehouse","FLash海外仓","period",current,"quantity",99,"quantityBasis","账面库存","quality","VALID"));
  Map<String,Object> other=new LinkedHashMap<>(Map.of("warehouse","速星海外仓","period",current,"quantity",7,"quantityBasis","账面库存","quality","VALID"));
  OverseasInventoryMapper mapper=(OverseasInventoryMapper)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{OverseasInventoryMapper.class},(o,m,a)-> {
   switch(m.getName()) {case "listPeriods":return List.of(current); case "defaultPeriod":return current; case "selectRows":return List.of(flash,other); default:throw new UnsupportedOperationException(m.getName());}
  });
  WarehouseImportService imports=new WarehouseImportService(null) { @Override public Map<String,Object> inventory() { return Map.of("rows",List.of(Map.of("warehouse","FLash海外仓","systemSku","SKU1","availableInventory",3,"sourceFile","source.xlsx"))); }};
  OverseasInventoryService service=new OverseasInventoryService(mapper,null,imports);
  Map<String,Object> result=service.inventory(Map.of("period",current));
  List<?> rows=(List<?>)result.get("rows"); assertEquals(2,rows.size());
  Map<?,?> replacement=(Map<?,?>)rows.get(1); assertEquals("可用库存",replacement.get("quantityBasis")); assertEquals(3,replacement.get("quantity")); assertNull(replacement.get("cost"));
  assertNull(((Map<?,?>)result.get("summary")).get("quantity"));
  StringWriter out=new StringWriter(); service.export(Map.of("period",current),out); assertTrue(out.toString().contains("SKU1")); assertFalse(out.toString().contains(",99,"));
  String past=YearMonth.now(ZoneId.of("Asia/Shanghai")).minusMonths(1).toString();
  List<?> historic=(List<?>)service.inventory(Map.of("period",past)).get("rows"); assertEquals(99,((Map<?,?>)historic.get(0)).get("quantity"));
 }
}
