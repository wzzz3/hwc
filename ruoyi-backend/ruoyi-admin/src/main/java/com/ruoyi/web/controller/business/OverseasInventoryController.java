package com.ruoyi.web.controller.business;

import java.io.IOException;
import java.util.*;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import com.alibaba.fastjson2.JSON;
import com.ruoyi.common.annotation.Log;
import com.ruoyi.common.core.controller.BaseController;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.enums.BusinessType;
import com.ruoyi.common.exception.ServiceException;
import com.ruoyi.system.service.impl.MarketplaceInventoryService;
import com.ruoyi.system.service.impl.OverseasInventoryService;

/** Independent inventory source. None of these actions write Amazon inventory tables. */
@RestController
@RequestMapping("/business/inventory/overseas")
@PreAuthorize("isAuthenticated()")
public class OverseasInventoryController extends BaseController
{
    private final OverseasInventoryService service;
    private final MarketplaceInventoryService marketplaceInventoryService;

    public OverseasInventoryController(OverseasInventoryService service, MarketplaceInventoryService marketplaceInventoryService)
    {
        this.service = service;
        this.marketplaceInventoryService = marketplaceInventoryService;
    }

    @GetMapping("/status")
    public AjaxResult status()
    {
        return success(service.status());
    }
    @PostMapping("/imports")
    @Log(title = "海外仓库存导入预览", businessType = BusinessType.IMPORT, isSaveRequestData = false, isSaveResponseData = false)
    public AjaxResult upload(@RequestParam("file") MultipartFile file,
            @RequestParam(value = "settings", defaultValue = "{}") String settings) throws IOException
    {
        if (settings.length() > 65536) throw new ServiceException("导入配置过大。");
        Map<String, Object> options;
        try { options = JSON.parseObject(settings); }
        catch (RuntimeException error) { throw new ServiceException("导入配置格式不正确。"); }
        if (options == null) options = new LinkedHashMap<>();
        return success(service.startImport(file, options, getUsername()));
    }
    @GetMapping("/imports/{id}")
    public AjaxResult preview(@PathVariable String id) { return success(service.batch(id)); }

    @PostMapping("/imports/{id}/reconfigure")
    @Log(title = "海外仓库存映射预览", businessType = BusinessType.UPDATE, isSaveRequestData = false, isSaveResponseData = false)
    public AjaxResult reconfigure(@PathVariable String id, @RequestBody Map<String, Object> settings) throws IOException
    { return success(service.reconfigure(id, settings, getUsername())); }

    @PostMapping("/imports/{id}/commit")
    @Log(title = "月度库存导入", businessType = BusinessType.IMPORT, isSaveRequestData = false, isSaveResponseData = false)
    public AjaxResult commit(@PathVariable String id, @RequestBody Map<String, Object> body)
    { return success(service.commit(id, Boolean.TRUE.equals(body.get("replaceAck")), Boolean.TRUE.equals(body.get("ackIssues")))); }

    @GetMapping("/inventory")
    public AjaxResult inventory(@RequestParam Map<String, String> params) { return success(service.inventory(params)); }

    /**
     * Current marketplace API snapshot. This is intentionally separate from
     * Excel monthly accounting inventory, which has a different time grain.
     */
    @GetMapping("/marketplace")
    public AjaxResult marketplace() { return success(marketplaceInventoryService.snapshot()); }

    @GetMapping("/history")
    public AjaxResult history(@RequestParam Map<String, String> params) { return success(service.history(params)); }

    @GetMapping("/export")
    @Log(title = "海外仓库存导出", businessType = BusinessType.EXPORT, isSaveResponseData = false)
    public void export(@RequestParam Map<String, String> params, HttpServletResponse response) throws IOException
    {
        response.setContentType("text/csv;charset=UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=overseas-inventory.csv");
        response.setHeader("Cache-Control", "no-store");
        service.export(params, response.getWriter());
    }
    @ExceptionHandler(org.springframework.dao.DataAccessException.class)
    public AjaxResult databaseUnavailable(org.springframework.dao.DataAccessException error)
    {
        logger.error("Inventory snapshot database operation failed", error);
        return AjaxResult.error("库存数据暂不可用，请确认 inventory_snapshot 单表迁移已执行并检查服务器日志。");
    }
}
