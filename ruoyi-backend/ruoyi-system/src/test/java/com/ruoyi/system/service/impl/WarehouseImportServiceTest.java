package com.ruoyi.system.service.impl;

import org.junit.Test;
import static org.junit.Assert.*;
import com.ruoyi.common.exception.ServiceException;

public class WarehouseImportServiceTest {
 @Test public void normalizesConfirmedFlashWarehouseAlias() {
  assertEquals("FLash海外仓", WarehouseImportService.normalizeFlashWarehouseName("1仓-91761仓(FLASH01)", "2"));
  assertEquals("FLash海外仓", WarehouseImportService.normalizeFlashWarehouseName("美东New Brunswick(NJ)", "2"));
  assertEquals("FLash海外仓", WarehouseImportService.normalizeFlashWarehouseName("FLash海外仓", "2"));
 }
 @Test public void rejectsUnknownWarehouseAlias() {
  try {
   WarehouseImportService.normalizeFlashWarehouseName("未确认仓库", "8");
   fail("Unknown warehouse must be rejected");
  } catch (ServiceException expected) {
   assertTrue(expected.getMessage().contains("第8行"));
  }
 }
}
