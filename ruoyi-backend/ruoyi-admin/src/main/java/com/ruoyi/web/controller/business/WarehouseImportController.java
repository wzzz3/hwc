package com.ruoyi.web.controller.business;
import java.io.IOException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.security.access.prepost.PreAuthorize;
import com.ruoyi.common.core.controller.BaseController;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.system.service.impl.WarehouseImportService;
@RestController
@RequestMapping("/business/inventory/overseas")
@PreAuthorize("isAuthenticated()")
public class WarehouseImportController extends BaseController {
 private final WarehouseImportService service;
 public WarehouseImportController(WarehouseImportService service){this.service=service;}
 @PostMapping("/warehouse-imports") public AjaxResult preview(@RequestParam MultipartFile inventoryFile,@RequestParam MultipartFile stockAgeFile,@RequestParam MultipartFile relationFile) throws IOException { return success(service.preview(inventoryFile,stockAgeFile,relationFile,getUsername())); }
 @PostMapping("/warehouse-imports/{id}/commit") public AjaxResult commit(@PathVariable String id){return success(service.commit(id,getUsername()));}
 @GetMapping("/warehouse-inventory") public AjaxResult inventory(){return success(service.inventory());}
}
