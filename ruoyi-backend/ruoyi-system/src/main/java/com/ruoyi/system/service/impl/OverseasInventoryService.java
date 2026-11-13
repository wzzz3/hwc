package com.ruoyi.system.service.impl;

import java.io.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.alibaba.fastjson2.JSON;
import com.ruoyi.common.annotation.DataSource;
import com.ruoyi.common.config.RuoYiConfig;
import com.ruoyi.common.enums.DataSourceType;
import com.ruoyi.common.exception.ServiceException;
import com.ruoyi.common.utils.SecurityUtils;
import com.ruoyi.system.domain.inventory.OverseasInventoryWorkbookParser;
import com.ruoyi.system.domain.inventory.OverseasInventoryWorkbookParser.Parsed;
import com.ruoyi.system.mapper.OverseasInventoryMapper;

/** Previews live briefly in memory. Confirmed monthly observations live in one table. */
@Service
@DataSource(DataSourceType.ANALYTICS)
public class OverseasInventoryService
{
    private static final Logger log = LoggerFactory.getLogger(OverseasInventoryService.class);
    private static final String SOURCE = "finance_inventory";
    private static final long MAX_FILE = 10L * 1024 * 1024, TTL_SECONDS = 3600;
    /** These current API-backed platforms are not presented as Excel inventory. */
    private static final Set<String> API_BACKED_PLATFORMS = Set.of(
            "amazon", "亚马逊", "walmart", "沃尔玛", "tiktok", "tik tok", "temu");
    /** Physical overseas warehouses remain visible as monthly book stock, even when they serve an API-backed platform. */
    private static final Set<String> EXCEL_OVERSEAS_WAREHOUSES = Set.of(
            "速星海外仓", "FLash海外仓", "中南通达海外仓", "天屹海外仓", "友乐海外仓",
            "谷仓海外仓", "金仓海外仓", "神户海外仓", "日本大阪自建仓", "佑美顺海外仓",
            "天瞳海外仓", "海源一件代发海外仓", "佑美顺一件代发海外仓");
    private static final List<String> FILTERS = List.of("platform", "country", "warehouse", "shop", "owner", "category1", "currency", "quantityBasis", "mappingStatus");
    private static final List<String> IDENTITY = List.of("sourceSheet", "rawWarehouse", "platform", "platformScope", "country", "marketScope", "warehouse", "warehouseCountry", "shop", "localSku", "platformSku", "quantityBasis", "currency");
    private static final List<String> GROUPS = List.of("platform", "platformScope", "country", "marketScope", "warehouse", "warehouseCountry", "currency", "quantityBasis");
    private final OverseasInventoryMapper mapper;
    private final OverseasInventoryImportWorker worker;
    private final WarehouseImportService warehouseImports;
    private final ConcurrentMap<String, Job> jobs = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(2), task -> daemon(task, "inventory-import"), new ThreadPoolExecutor.AbortPolicy());
    private final ScheduledExecutorService janitor = Executors.newSingleThreadScheduledExecutor(task -> daemon(task, "inventory-preview-cleanup"));
    @Value("${inventory.overseas.storage-path:${user.home}/.ruoyi-private/overseas-inventory}")
    private String storagePath;

    public OverseasInventoryService(OverseasInventoryMapper mapper, OverseasInventoryImportWorker worker, WarehouseImportService warehouseImports)
    { this.mapper = mapper; this.worker = worker; this.warehouseImports = warehouseImports; }
    private static Thread daemon(Runnable task, String name) { Thread thread = new Thread(task, name); thread.setDaemon(true); return thread; }
    @PostConstruct public void startCleanup() { janitor.scheduleWithFixedDelay(this::cleanup, 1, 60, TimeUnit.SECONDS); }
    @PreDestroy public void close() { janitor.shutdownNow(); executor.shutdown(); }

    public Map<String, Object> status()
    {
        List<String> periods = availablePeriods();
        Map<String, Object> out = new LinkedHashMap<>(mapper.status(SOURCE));
        out.put("periods", periods); out.put("defaultPeriod", defaultPeriod(null, periods));
        out.putIfAbsent("importedAt", null); return out;
    }

    public synchronized Map<String, Object> startImport(MultipartFile file, Map<String, Object> settings, String username) throws IOException
    {
        cleanup(); validateSettings(settings);
        if (jobs.values().stream().filter(job -> active(job) || "PREVIEW".equals(job.status)).count() >= 4)
            throw new ServiceException("预览数量已达上限，请完成当前导入或等待预览过期。");
        if (jobs.size() >= 50) jobs.values().stream().filter(job -> !active(job) && !"PREVIEW".equals(job.status))
                .min(Comparator.comparing(job -> job.created)).ifPresent(job -> { jobs.remove(job.id, job); removeFile(job); });
        if (file == null || file.isEmpty() || file.getSize() > MAX_FILE)
            throw new ServiceException("请选择不超过 10 MB 的 .xlsx 库存文件。");
        String filename = Optional.ofNullable(file.getOriginalFilename()).orElse("inventory.xlsx").replace('\\', '/');
        filename = filename.substring(filename.lastIndexOf('/') + 1);
        if (!filename.toLowerCase(Locale.ROOT).endsWith(".xlsx") || filename.length() > 240)
            throw new ServiceException("仅支持 .xlsx 文件，请在 Excel 中另存后上传。");
        String id = UUID.randomUUID().toString(); Path destination = sourcePath(id);
        try (InputStream input = file.getInputStream(); OutputStream output = Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW)) {
            byte[] buffer = new byte[8192]; long bytes = 0; int length;
            while ((length = input.read(buffer)) != -1) { bytes += length; if (bytes > MAX_FILE) throw new ServiceException("文件超过 10 MB。"); output.write(buffer, 0, length); }
        } catch (IOException | RuntimeException error) { Files.deleteIfExists(destination); throw error; }
        restrict(destination, false);
        Job job = new Job(id, filename, username, destination, settings); jobs.put(id, job);
        try { enqueueParse(job); } catch (RuntimeException error) { jobs.remove(id); removeFile(job); throw error; }
        return Map.of("id", id, "status", "PROCESSING");
    }

    public Map<String, Object> reconfigure(String id, Map<String, Object> settings, String username)
    {
        validateSettings(settings); Job job = required(id);
        synchronized (job) {
            if (!"PREVIEW".equals(job.status)) throw new ServiceException("仅待确认预览可以调整映射，请重新上传文件。");
            Map<String, Object> previousSettings = job.settings;
            Map<String, Object> merged = new LinkedHashMap<>(previousSettings); merged.putAll(settings); validateSettings(merged);
            job.settings = JSON.parseObject(JSON.toJSONString(merged)); job.status = "PROCESSING";
            try { enqueueParse(job); } catch (RuntimeException error) { job.settings = previousSettings; job.status = "PREVIEW"; throw error; }
        }
        return Map.of("id", id, "status", "PROCESSING");
    }

    private void enqueueParse(Job job)
    {
        try { executor.execute(() -> {
            try {
                Parsed parsed = OverseasInventoryWorkbookParser.parse(job.file, job.settings);
                List<Map<String, Object>> rows = new ArrayList<>();
                for (Map<String, Object> source : parsed.rows()) {
                    Map<String, Object> row = new LinkedHashMap<>(source);
                    if (!text(row.get("period")).matches("\\d{4}-(0[1-9]|1[0-2])"))
                        throw new ServiceException("存在月份未确认的明细，请先确认报表年份和月份。");
                    row.put("sourceKey", SOURCE); row.put("sourceFile", job.filename);
                    row.putIfAbsent("quantityBasis", "SOURCE_SIGNED_STOCK");
                    row.putIfAbsent("platformScope", "UNKNOWN"); row.putIfAbsent("marketScope", "UNKNOWN");
                    row.putIfAbsent("mappingStatus", "PENDING");
                    if (row.get("ageBuckets") instanceof Collection<?> buckets && buckets.isEmpty()) row.put("ageBuckets", null);
                    String rawWarehouse = text(row.get("rawWarehouse"));
                    // Recheck the original warehouse field; a manual mapping cannot bring these rows into totals.
                    boolean excluded = "电子琴".equals(rawWarehouse) || "金仓电子琴".equals(rawWarehouse);
                    row.put("excluded", excluded);
                    if (excluded) row.put("exclusionReason", "电子琴库存单独展示，不参与库存汇总");
                    rows.add(row);
                }
                if (rows.isEmpty()) throw new ServiceException("没有可导入的月度库存明细。");
                List<String> periods = periods(rows);
                Map<String, Object> metadata = new LinkedHashMap<>(parsed.metadata());
                metadata.put("periods", periods);
                metadata.put("replacement", Map.of("periods", periods, "rowCount", rows.size(),
                        "existingRowCount", worker.countExisting(SOURCE, periods)));
                metadata.put("quantityNotice", "原始账面库存，保留负值；不代表可售库存。");
                synchronized (job) { job.rows = rows; job.metadata = metadata; job.periods = periods;
                    job.message = "请核对替换月份、明细和异常，确认后覆盖这些月份的现有数据。"; job.status = "PREVIEW"; }
            } catch (Exception error) { fail(job, error, "解析失败，请检查工作簿内容和年份映射后重新上传。"); }
        }); } catch (RejectedExecutionException error) { throw new ServiceException("已有库存文件正在处理，请稍后重试。"); }
    }

    public Map<String, Object> batch(String id) { return publicJob(required(id)); }

    public Map<String, Object> commit(String id, boolean replaceAck, boolean ackIssues)
    {
        Job job = required(id);
        synchronized (job) {
            if ("IMPORTING".equals(job.status) || "IMPORTED".equals(job.status)) return publicJob(job);
            if (!"PREVIEW".equals(job.status)) throw new ServiceException("预览尚未完成或已失效，请重新上传。");
            if (!replaceAck || !ackIssues) throw new ServiceException("请先确认替换月份和异常提示。");
            Object blockers = job.metadata.get("blockingErrors");
            if (blockers instanceof Collection<?> values && !values.isEmpty())
                throw new ServiceException("存在阻止导入的问题，请修正源文件或映射后重新预览。");
            job.status = "IMPORTING"; job.message = "正在事务内替换所选月份。";
            try { executor.execute(() -> {
                try {
                    Timestamp importedAt = Timestamp.from(Instant.now());
                    List<Map<String, Object>> persisted = new ArrayList<>();
                    for (Map<String, Object> source : job.rows) {
                        Map<String, Object> row = new LinkedHashMap<>(source); row.put("importedAt", importedAt);
                        if (row.get("extra") != null && !(row.get("extra") instanceof String)) row.put("extra", JSON.toJSONString(row.get("extra")));
                        if (row.get("ageBuckets") != null && !(row.get("ageBuckets") instanceof String)) row.put("ageBuckets", JSON.toJSONString(row.get("ageBuckets")));
                        persisted.add(row);
                    }
                    worker.replace(SOURCE, job.periods, persisted);
                    synchronized (job) { job.rows = List.of(); job.settings = Map.of(); job.status = "IMPORTED";
                        job.message = "导入完成，所含月份已替换。"; job.metadata.put("importedAt", importedAt.toInstant().toString()); }
                    removeFile(job);
                } catch (Exception error) { fail(job, error, "导入失败，原有库存保持不变。请检查服务器日志后重新上传。"); }
            }); } catch (RejectedExecutionException error) { job.status = "PREVIEW"; throw new ServiceException("导入队列繁忙，请稍后确认。"); }
            return publicJob(job);
        }
    }

    public Map<String, Object> inventory(Map<String, String> params)
    {
        validateParams(params); Preview preview = preview(params);
        List<String> periods = preview == null ? availablePeriods() : preview.periods;
        String period = text(params.get("period")); if (period.isEmpty()) period = defaultPeriod(preview, periods);
        validatePeriod(period);
        String view = params.getOrDefault("view", "overview"); boolean excluded = "excluded".equals(view);
        List<Map<String, Object>> base = readRows(preview, period, excluded);
        if (!excluded && ("overview".equals(view) || "analysis".equals(view)))
            base = base.stream().filter(OverseasInventoryService::includeInExcelPresentation).toList();
        if ("age".equals(view)) base = base.stream().filter(row -> !list(row.get("ageBuckets")).isEmpty()).toList();
        List<Map<String, Object>> selected = base.stream().filter(row -> matches(row, params)).toList();
        int page = integer(params.get("page"), 1, 1, 100000), size = integer(params.get("pageSize"), 50, 1, 200);
        int offset = Math.min(selected.size(), (page - 1) * size);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("period", period); result.put("periods", periods); result.put("rows", selected.subList(offset, Math.min(offset + size, selected.size())));
        result.put("total", selected.size()); result.put("page", page); result.put("pageSize", size);
        result.put("search", search(params));
        List<Map<String, Object>> groups = excluded ? List.of() : group(selected, GROUPS);
        result.put("groups", groups); result.put("summary", excluded ? Map.of() : summary(selected));
        result.put("facets", facets(base)); result.put("importedAt", latest(base));
        result.put("quantityNotice", "月度表为原始账面库存；FLash 快照为可用库存，按口径分别汇总。");
        if ("analysis".equals(view)) result.put("analysis", analysis(selected, preview, params, periods));
        return result;
    }

    public Map<String, Object> history(Map<String, String> params)
    {
        validateParams(params); validateIdentity(params); Preview preview = preview(params);
        List<Map<String, Object>> rows = historyRows(preview, params);
        Map<String, Object> result = new LinkedHashMap<>(); result.put("rows", rows); result.put("quantityNotice", "同一商品和库存口径的月度原始账面记录。"); return result;
    }

    private List<Map<String, Object>> historyRows(Preview preview, Map<String, String> params)
    {
        boolean excluded = "excluded".equals(params.get("view"));
        List<Map<String, Object>> rows;
        if (preview != null) rows = preview.rows.stream().filter(row -> excluded(row) == excluded && sameIdentity(row, params)).map(OverseasInventoryService::decode).toList();
        else {
            Map<String, Object> query = new LinkedHashMap<>(); query.put("sourceKey", SOURCE); query.put("excluded", excluded ? 1 : 0);
            query.put("historyExact", true); for (String field : IDENTITY) query.put(field, text(params.get(field)));
            rows = mapper.selectRows(query).stream().map(OverseasInventoryService::decode).toList();
        }
        return rows;
    }

    public void export(Map<String, String> params, Writer writer) throws IOException
    {
        validateParams(params); String type = params.getOrDefault("type", "inventory");
        if (!Set.of("inventory", "history", "issues", "reconciliation").contains(type)) throw new ServiceException("不支持的导出类型。");
        Preview preview = preview(params); writer.write('\ufeff');
        if ("issues".equals(type) || "reconciliation".equals(type)) {
            if (preview == null) throw new ServiceException("解析异常和对账报告仅在当前导入预览中提供。");
            List<Map<String, Object>> rows = list(preview.metadata.get(type));
            LinkedHashSet<String> columns = new LinkedHashSet<>(); rows.forEach(row -> columns.addAll(row.keySet()));
            csv(writer, new ArrayList<>(columns)); for (Map<String, Object> row : rows) csv(writer, columns.stream().map(row::get).toList());
        } else {
            List<Map<String, Object>> rows;
            if ("history".equals(type)) { validateIdentity(params); rows = historyRows(preview, params); }
            else {
                List<String> periods = preview == null ? availablePeriods() : preview.periods;
                String period = text(params.get("period")); if (period.isEmpty()) period = defaultPeriod(preview, periods); validatePeriod(period);
                rows = readRows(preview, period, "excluded".equals(params.get("view"))).stream()
                    .filter(row -> !("overview".equals(params.getOrDefault("view", "overview")) || "analysis".equals(params.get("view"))) || includeInExcelPresentation(row))
                    .filter(row -> matches(row, params)).filter(row -> !"age".equals(params.get("view")) || !list(row.get("ageBuckets")).isEmpty()).toList();
            }
            String[] keys = {"period","rawWarehouse","platform","platformScope","country","marketScope","warehouse","warehouseCountry","shop","localSku","platformSku","productName","quantity","quantityBasis","cost","currency","category1","category2","category3","owner","quality","mappingStatus","excluded","exclusionReason","sourceFile","sourceSheet","sourceRow","importedAt","ageBuckets","extra"};
            csv(writer, List.of("月份","原始仓库","平台","平台范围","国家或区域","市场范围","仓库","仓库所在国","店铺","本地SKU","平台SKU","品名","库存数量（见数量口径）","数量口径","原始成本","币种","一级分类","二级分类","三级分类","负责人","数据状态","映射状态","是否排除汇总","排除原因","来源文件","来源工作表","来源行","导入时间","本月库龄桶","原始字段"));
            for (Map<String, Object> row : rows) csv(writer, Arrays.stream(keys).map(row::get).toList());
        }
        writer.flush();
    }

    private List<Map<String, Object>> readRows(Preview preview, String period, boolean excluded)
    {
        if (period.isEmpty()) return List.of();
        if (preview != null) return preview.rows.stream().filter(row -> period.equals(row.get("period")) && excluded(row) == excluded).map(OverseasInventoryService::decode).toList();
        List<Map<String, Object>> rows = new ArrayList<>(mapper.selectRows(Map.of("sourceKey", SOURCE, "period", period, "excluded", excluded ? 1 : 0)).stream().map(OverseasInventoryService::decode).toList());
        if (!excluded && period.equals(currentPeriod())) {
            List<Map<String, Object>> snapshot = flashRows(period);
            if (!snapshot.isEmpty()) {
                rows.removeIf(row -> "FLash海外仓".equalsIgnoreCase(text(row.get("warehouse"))));
                rows.addAll(snapshot);
            }
        }
        return rows;
    }
    private static String currentPeriod() { return YearMonth.now(ZoneId.of("Asia/Shanghai")).toString(); }
    private List<String> availablePeriods() {
        List<String> periods = new ArrayList<>(mapper.listPeriods(SOURCE));
        if (!flashRows(currentPeriod()).isEmpty() && !periods.contains(currentPeriod())) periods.add(currentPeriod());
        Collections.sort(periods); return periods;
    }
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> flashRows(String period) {
        List<Map<String, Object>> rows = (List<Map<String, Object>>) warehouseImports.inventory().get("rows");
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> source : rows) {
            if (!"FLash海外仓".equalsIgnoreCase(text(source.get("warehouse")))) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("period", period); row.put("warehouse", "FLash海外仓"); row.put("rawWarehouse", "美东New Brunswick(NJ)");
            row.put("warehouseCountry", "美国"); row.put("localSku", source.get("systemSku"));
            row.put("productName", source.get("productName")); row.put("quantity", source.get("availableInventory"));
            row.put("quantityBasis", "可用库存"); row.put("cost", null); row.put("quality", "VALID");
            row.put("sourceFile", source.get("sourceFile")); row.put("sourceSheet", "海外仓产品库存快照");
            row.put("sourceRow", source.get("sourceRow")); row.put("importedAt", source.get("importedAt"));
            row.put("mappingStatus", "快照"); row.put("excluded", false);
            result.add(row);
        }
        return result;
    }
    private Preview preview(Map<String, String> params)
    {
        String id = text(params.get("previewId")); if (id.isEmpty()) return null;
        Job job = required(id);
        synchronized (job) {
            if (!"PREVIEW".equals(job.status)) throw new ServiceException("当前预览不可查询，请等待解析完成或查询正式库存。");
            // Published rows and periods are replaced, never mutated. Keep their references
            // together so committing or reconfiguring cannot change an in-flight read.
            return new Preview(job.rows, job.periods, new LinkedHashMap<>(job.metadata));
        }
    }
    private Job required(String id)
    {
        validateId(id); Job job = jobs.get(id);
        if (job == null || (!active(job) && job.created.isBefore(Instant.now().minusSeconds(TTL_SECONDS))))
            throw new ServiceException("预览已过期或服务已重启，请重新上传文件。");
        if (!job.username.equals(SecurityUtils.getUsername()) && !SecurityUtils.isAdmin()) throw new ServiceException("无权访问此导入预览。");
        return job;
    }
    private static Map<String, Object> publicJob(Job job)
    {
        synchronized (job) { Map<String, Object> result = new LinkedHashMap<>(); result.put("id", job.id); result.put("status", job.status);
            result.put("fileName", job.filename); result.put("message", job.message); result.put("metadata", new LinkedHashMap<>(job.metadata)); return result; }
    }
    private static boolean matches(Map<String, Object> row, Map<String, String> params)
    {
        for (String field : FILTERS) {
            String value = text(params.get(field));
            if (value.isEmpty() || "ALL".equals(value) || "all".equals(value)) continue;
            if ("platform".equals(field)) {
                String platform = text(row.get("platform"));
                String scope = text(row.get("platformScope"));
                boolean shared = "SHARED".equals(scope);
                boolean unknown = !shared && (platform.isEmpty() || "UNKNOWN".equals(scope));
                if ("__SHARED__".equals(value)) {
                    if (!shared) return false;
                } else if ("__UNKNOWN__".equals(value)) {
                    if (!unknown) return false;
                } else if (shared || unknown || !value.equals(platform)) return false;
                continue;
            }
            if ("__UNKNOWN__".equals(value)) {
                boolean unknown = text(row.get(field)).isEmpty()
                        || "country".equals(field) && "UNKNOWN".equals(text(row.get("marketScope")));
                if (!unknown) return false;
                continue;
            }
            if (!value.equals(text(row.get(field)))) return false;
        }
        Map<String, String> search = search(params);
        String keyword = search.get("keyword");
        if (keyword.isEmpty()) return true;
        if ("sku".equals(search.get("mode")))
            return List.of("localSku", "platformSku").stream().anyMatch(key -> text(row.get(key)).equalsIgnoreCase(keyword));
        String term = keyword.toLowerCase(Locale.ROOT);
        return List.of("localSku", "platformSku", "productName").stream().anyMatch(key -> text(row.get(key)).toLowerCase(Locale.ROOT).contains(term));
    }
    private static Map<String, String> search(Map<String, String> params)
    {
        String requested = params.getOrDefault("searchMode", "keyword");
        String keyword = text(params.get("keyword"));
        boolean sku = "sku".equals(requested) || "auto".equals(requested)
                && keyword.matches("(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9._/-]+");
        return Map.of("requestedMode", requested, "mode", sku ? "sku" : "keyword", "keyword", keyword);
    }
    private static boolean includeInExcelPresentation(Map<String, Object> row)
    {
        return EXCEL_OVERSEAS_WAREHOUSES.contains(text(row.get("warehouse")))
                || !API_BACKED_PLATFORMS.contains(text(row.get("platform")).toLowerCase(Locale.ROOT));
    }
    private static boolean sameIdentity(Map<String, Object> row, Map<String, String> params)
    { return IDENTITY.stream().allMatch(field -> text(row.get(field)).equals(text(params.get(field)))); }
    private static void validateIdentity(Map<String, String> params)
    {
        if (text(params.get("localSku")).isEmpty() && text(params.get("platformSku")).isEmpty()) throw new ServiceException("请先选择要查看历史的商品。");
        if (!params.keySet().containsAll(IDENTITY)) throw new ServiceException("商品库存身份字段不完整，请从明细重新选择历史。");
    }
    private static void validateParams(Map<String, String> params)
    {
        if (params.containsKey("searchMode") && (params.get("searchMode") == null
                || !Set.of("auto", "sku", "keyword").contains(params.get("searchMode"))))
            throw new ServiceException("搜索模式无效，searchMode 仅支持 auto、sku 或 keyword。");
        for (Map.Entry<String, String> entry : params.entrySet()) if (text(entry.getValue()).length() > 1000) throw new ServiceException("筛选内容过长。");
        if (!Set.of("overview", "details", "age", "excluded", "analysis").contains(params.getOrDefault("view", "overview"))) throw new ServiceException("不支持的库存视图。");
    }
    private static void validatePeriod(String period) { if (!period.isEmpty() && !period.matches("\\d{4}-(0[1-9]|1[0-2])")) throw new ServiceException("请指定有效的库存月份。"); }
    /** Analysis is derived from complete filtered rows, never from the display page. */
    private Map<String, Object> analysis(List<Map<String, Object>> rows, Preview preview,
            Map<String, String> params, List<String> periods)
    {
        List<String> labels = List.of("3个月内", "3-6个月", "6-9个月", "9-12个月", "12个月以上");
        int eligible = 0, missing = 0, incomplete = 0, mismatch = 0, negative = 0, zero = 0, riskExcluded = 0;
        final int reconciliationLimit = 20;
        List<Map<String, Object>> reconciliationRows = new ArrayList<>();
        Map<String, BigDecimal[]> bucketTotals = new LinkedHashMap<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        List<Map<String, Object>> riskRows = new ArrayList<>();
        for (Map<String, Object> row : rows)
        {
            List<Map<String, Object>> buckets = list(row.get("ageBuckets"));
            if (buckets.isEmpty()) { missing++; continue; }
            BigDecimal quantity = analysisNumber(row.get("quantity"));
            BigDecimal[] values = new BigDecimal[labels.size()];
            boolean complete = buckets.size() == labels.size() && quantity != null;
            for (int i = 0; complete && i < labels.size(); i++)
            {
                Map<String, Object> bucket = buckets.get(i);
                values[i] = analysisNumber(bucket.get("quantity"));
                BigDecimal lower = analysisNumber(bucket.get("minAgeMonths"));
                BigDecimal upper = analysisNumber(bucket.get("maxAgeMonths"));
                complete = values[i] != null && "MONTH".equals(text(bucket.get("unit")))
                        && labels.get(i).equals(text(bucket.get("label")))
                        && lower != null && lower.compareTo(BigDecimal.valueOf(i * 3L)) == 0
                        && (i == 4 ? bucket.get("maxAgeMonths") == null
                                : upper != null && upper.compareTo(BigDecimal.valueOf((i + 1) * 3L)) == 0);
            }
            if (!complete) { incomplete++; continue; }
            if (quantity.signum() < 0 || Arrays.stream(values).anyMatch(value -> value.signum() < 0))
            { negative++; continue; }
            BigDecimal total = Arrays.stream(values).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (total.compareTo(quantity) != 0)
            {
                mismatch++;
                if (reconciliationRows.size() < reconciliationLimit)
                {
                    Map<String, Object> reconciliation = new LinkedHashMap<>();
                    for (String field : List.of("localSku", "platformSku", "productName", "platform", "warehouse", "shop",
                            "period", "sourceSheet", "sourceRow", "quantity", "quantityBasis"))
                        reconciliation.put(field, row.get(field));
                    reconciliation.put("ageQuantity", total); reconciliation.put("difference", total.subtract(quantity));
                    reconciliation.put("buckets", buckets);
                    Object extra = row.get("extra");
                    reconciliation.put("quantityColumn", extra instanceof Map<?, ?> fields ? fields.get("quantityColumn") : null);
                    reconciliationRows.add(reconciliation);
                }
                continue;
            }
            if (quantity.signum() == 0) { zero++; continue; }
            eligible++;
            String basis = text(row.get("quantityBasis"));
            BigDecimal[] sums = bucketTotals.computeIfAbsent(basis, key -> {
                BigDecimal[] initial = new BigDecimal[labels.size()]; Arrays.fill(initial, BigDecimal.ZERO); return initial;
            });
            for (int i = 0; i < values.length; i++) sums[i] = sums[i].add(values[i]);
            counts.merge(basis, 1, Integer::sum);
            String currency = text(row.get("currency"));
            BigDecimal cost = analysisNumber(row.get("cost"));
            boolean confirmed = Set.of("SOURCE_CONFIRMED", "MANUAL_CONFIRMED").contains(text(row.get("mappingStatus")));
            if (!confirmed || !currency.matches("[A-Z]{3}") || "UNK".equals(currency) || cost == null || cost.signum() <= 0)
            { riskExcluded++; continue; }
            Map<String, Object> risk = new LinkedHashMap<>();
            for (String field : IDENTITY) risk.put(field, row.get(field));
            for (String field : List.of("period", "productName", "sourceRow", "quantity", "cost", "mappingStatus"))
                risk.put(field, row.get(field));
            BigDecimal old = values[2].add(values[3]).add(values[4]);
            risk.put("oldQuantity", old);
            risk.put("oldShare", old.divide(quantity, 8, java.math.RoundingMode.HALF_UP));
            riskRows.add(risk);
        }
        List<Map<String, Object>> ageGroups = new ArrayList<>();
        bucketTotals.forEach((basis, values) -> {
            Map<String, Object> group = new LinkedHashMap<>();
            group.put("quantityBasis", basis); group.put("unit", "MONTH"); group.put("labels", labels);
            group.put("quantities", Arrays.asList(values)); group.put("recordCount", counts.get(basis));
            group.put("totalQuantity", Arrays.stream(values).reduce(BigDecimal.ZERO, BigDecimal::add)); ageGroups.add(group);
        });
        Map<String, Object> age = new LinkedHashMap<>();
        age.put("eligibleRecords", eligible); age.put("missingRecords", missing); age.put("incompleteRecords", incomplete);
        age.put("mismatchRecords", mismatch); age.put("negativeRecords", negative); age.put("groups", ageGroups);
        age.put("zeroRecords", zero); age.put("reconciliationRows", reconciliationRows);
        age.put("reconciliationTotal", mismatch); age.put("reconciliationLimit", reconciliationLimit);
        age.put("limitation", "源月龄分桶，快照时点未统一确认；6个月及以上不等于精确180天。");
        List<Map<String, Object>> source = preview == null ? new ArrayList<>(mapper.selectTrendRows(SOURCE)) : preview.rows;
        if (preview == null) {
            List<Map<String, Object>> snapshot = flashRows(currentPeriod());
            if (!snapshot.isEmpty()) {
                source.removeIf(row -> currentPeriod().equals(text(row.get("period"))) && "FLash海外仓".equalsIgnoreCase(text(row.get("warehouse"))));
                source.addAll(snapshot);
            }
        }
        Map<String, List<Map<String, Object>>> monthly = new TreeMap<>();
        for (Map<String, Object> row : source)
            if (!excluded(row) && matches(row, params))
                monthly.computeIfAbsent(text(row.get("period")), key -> new ArrayList<>()).add(row);
        List<Map<String, Object>> trend = new ArrayList<>();
        monthly.forEach((period, values) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("period", period); item.put("summary", summary(values));
            List<Map<String, Object>> groups = group(values, List.of("quantityBasis"));
            // Amounts remain exclusively in summary.costByCurrency; never sum currencies by quantity basis.
            groups.forEach(value -> value.remove("cost")); item.put("groups", groups); trend.add(item);
        });
        Map<String, Object> result = new LinkedHashMap<>(); result.put("periods", periods);
        result.put("crossPeriodIdentityVerified", false); result.put("age", age); result.put("ageRiskRows", riskRows);
        result.put("ageRiskExcludedRecords", riskExcluded); result.put("trend", trend);
        result.put("trendDefinition", "各月原始账面库存，同筛选范围但跨月商品归属未统一核验；缺月不补零，不代表库存周转率。");
        return result;
    }
    private static BigDecimal analysisNumber(Object value)
    {
        if (!(value instanceof Number)) return null;
        try { return new BigDecimal(value.toString()); } catch (NumberFormatException ignored) { return null; }
    }
    private static Map<String, Object> summary(List<Map<String, Object>> rows)
    {
        Map<String, Object> result = totals(rows); result.remove("cost");
        List<Map<String, Object>> byBasis = group(rows, List.of("quantityBasis"));
        for (Map<String, Object> value : byBasis) value.remove("cost");
        result.put("quantity", byBasis.size() == 1 ? byBasis.get(0).get("quantity") : null);
        result.put("quantityByBasis", byBasis); result.put("quantityBasis", byBasis.size() == 1 ? byBasis.get(0).get("quantityBasis") : "MIXED");
        result.put("costByCurrency", group(rows, List.of("currency", "quantityBasis")));
        result.put("warehouseCount", rows.stream().map(row -> text(row.get("warehouse"))).filter(value -> !value.isEmpty()).distinct().count());
        result.put("skuCount", rows.stream().map(row -> text(row.get("localSku"))).filter(value -> !value.isEmpty()).distinct().count());
        result.put("quantitySemantics", "BY_QUANTITY_BASIS"); return result;
    }
    private static List<Map<String, Object>> group(List<Map<String, Object>> rows, List<String> fields)
    {
        Map<List<String>, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) grouped.computeIfAbsent(fields.stream().map(field -> text(row.get(field))).toList(), key -> new ArrayList<>()).add(row);
        List<Map<String, Object>> result = new ArrayList<>();
        grouped.forEach((key, values) -> { Map<String, Object> value = totals(values); for (int i = 0; i < fields.size(); i++) value.put(fields.get(i), key.get(i)); result.add(value); });
        return result;
    }
    private static Map<String, Object> totals(List<Map<String, Object>> rows)
    {
        BigDecimal quantity = BigDecimal.ZERO, cost = BigDecimal.ZERO; int quantityKnown = 0, costKnown = 0, negative = 0, issues = 0;
        for (Map<String, Object> row : rows) {
            if (row.get("quantity") != null) { BigDecimal value = decimal(row.get("quantity")); quantity = quantity.add(value); quantityKnown++; if (value.signum() < 0) negative++; }
            if (row.get("cost") != null) { cost = cost.add(decimal(row.get("cost"))); costKnown++; }
            if (!"VALID".equals(row.get("quality"))) issues++;
        }
        Map<String, Object> result = new LinkedHashMap<>(); result.put("recordCount", rows.size()); result.put("quantity", quantityKnown == 0 ? null : quantity);
        result.put("cost", costKnown == 0 ? null : cost); result.put("quantityKnown", quantityKnown); result.put("costKnown", costKnown);
        result.put("negativeQuantityCount", negative); result.put("issueCount", issues); return result;
    }
    private static Map<String, Object> facets(List<Map<String, Object>> rows)
    {
        Map<String, Object> facets = new LinkedHashMap<>();
        for (String field : FILTERS) {
            facets.put(field, rows.stream()
                    .filter(row -> !"platform".equals(field)
                            || !List.of("SHARED", "UNKNOWN").contains(text(row.get("platformScope"))))
                    .map(row -> text(row.get(field))).filter(value -> !value.isEmpty()).distinct().sorted().toList());
        }
        return facets;
    }
    private static Object latest(List<Map<String, Object>> rows) { return rows.stream().map(row -> row.get("importedAt")).filter(Objects::nonNull).max(Comparator.comparing(Object::toString)).orElse(null); }
    private static List<String> periods(List<Map<String, Object>> rows) { return rows.stream().map(row -> text(row.get("period"))).distinct().sorted().toList(); }
    private static String last(List<String> periods) { return periods.isEmpty() ? "" : periods.get(periods.size() - 1); }
    private String defaultPeriod(Preview preview, List<String> periods)
    {
        if (periods.isEmpty()) return "";
        String preferred = preview == null ? mapper.defaultPeriod(SOURCE) : text(preview.metadata.get("defaultPeriod"));
        return preview == null && periods.contains(currentPeriod()) ? currentPeriod() : periods.contains(preferred) ? preferred : last(periods);
    }
    private static Map<String, Object> decode(Map<String, Object> source)
    {
        Map<String, Object> row = new LinkedHashMap<>(source); Object extra = row.get("extra"), age = row.get("ageBuckets");
        if (extra instanceof String value) row.put("extra", JSON.parseObject(value));
        if (age instanceof String value) row.put("ageBuckets", JSON.parseArray(value));
        row.put("excluded", excluded(row));
        for (String field : IDENTITY) row.putIfAbsent(field, "");
        return row;
    }
    private static boolean excluded(Map<String, Object> row) { Object value = row.get("excluded"); return Boolean.TRUE.equals(value) || value instanceof Number number && number.intValue() != 0; }
    private static void validateSettings(Map<String, Object> settings) { if (JSON.toJSONString(settings).length() > 65536) throw new ServiceException("导入配置过大。"); }
    private void fail(Job job, Exception error, String fallback)
    {
        log.warn("Inventory job {} failed", job.id, error);
        synchronized (job) { job.status = "FAILED"; job.message = error instanceof ServiceException || error instanceof OverseasInventoryWorkbookParser.ValidationException ? error.getMessage() : fallback; job.rows = List.of(); job.settings = Map.of(); }
        removeFile(job);
    }
    private void removeFile(Job job) { try { Files.deleteIfExists(job.file); } catch (IOException error) { log.warn("Could not remove inventory temporary file {}", job.id); } }
    private static boolean active(Job job) { return "PROCESSING".equals(job.status) || "IMPORTING".equals(job.status); }
    private void cleanup()
    {
        try {
            Instant cutoff = Instant.now().minusSeconds(TTL_SECONDS);
            jobs.forEach((id, job) -> { synchronized (job) { if (!active(job) && job.created.isBefore(cutoff) && jobs.remove(id, job)) removeFile(job); } });
            Path root = Path.of(storagePath).toAbsolutePath().normalize(); if (!Files.isDirectory(root)) return;
            root = root.toRealPath(); requirePrivateStorage(root);
            try (DirectoryStream<Path> files = Files.newDirectoryStream(root, "*.xlsx")) {
                for (Path file : files) { String name = file.getFileName().toString();
                    if (!name.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.xlsx") || Files.isSymbolicLink(file)) continue;
                    if (!jobs.containsKey(name.substring(0, 36)) && Files.getLastModifiedTime(file).toInstant().isBefore(cutoff)) Files.deleteIfExists(file);
                }
            }
        } catch (Exception error) { log.warn("Inventory preview cleanup failed: {}", error.getClass().getSimpleName()); }
    }
    private Path sourcePath(String id) throws IOException
    {
        validateId(id); Path root = Path.of(storagePath).toAbsolutePath().normalize(); Files.createDirectories(root); root = root.toRealPath();
        requirePrivateStorage(root);
        restrict(root, true); Path file = root.resolve(id + ".xlsx"); if (Files.isSymbolicLink(file)) throw new ServiceException("临时文件路径不可用。"); return file;
    }
    private static void requirePrivateStorage(Path root) throws IOException
    {
        if (RuoYiConfig.getProfile() == null) return;
        Path profile = Path.of(RuoYiConfig.getProfile()).toAbsolutePath().normalize();
        if (Files.exists(profile)) profile = profile.toRealPath();
        if (root.startsWith(profile)) throw new ServiceException("库存临时文件必须存放在公开上传目录之外。");
    }
    private static void restrict(Path path, boolean directory) throws IOException
    { try { Files.setPosixFilePermissions(path, PosixFilePermissions.fromString(directory ? "rwx------" : "rw-------")); } catch (UnsupportedOperationException ignored) { } }
    private static void validateId(String id) { if (id == null || !id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) throw new ServiceException("无效预览标识。"); }
    private static int integer(String value, int fallback, int min, int max) { try { return Math.max(min, Math.min(max, Integer.parseInt(value))); } catch (Exception ignored) { return fallback; } }
    private static String text(Object value) { return value == null ? "" : value.toString().trim(); }
    private static BigDecimal decimal(Object value) { return new BigDecimal(value.toString()); }
    @SuppressWarnings("unchecked") private static List<Map<String, Object>> list(Object value) { return value instanceof List ? (List<Map<String, Object>>) value : List.of(); }
    private static void csv(Writer writer, List<?> values) throws IOException
    {
        List<String> cells = new ArrayList<>(); for (Object value : values) { String cell = value == null ? "" : value instanceof Map || value instanceof List ? JSON.toJSONString(value) : value.toString();
            if (!(value instanceof Number) && cell.stripLeading().matches("(?s)^[=+@\\-\\t\\r].*")) cell = "'" + cell;
            cells.add("\"" + cell.replace("\"", "\"\"") + "\""); }
        writer.write(String.join(",", cells)); writer.write("\r\n");
    }
    private record Preview(List<Map<String, Object>> rows, List<String> periods, Map<String, Object> metadata) { }

    private static final class Job
    {
        final String id, filename, username; final Path file; final Instant created = Instant.now();
        volatile String status = "PROCESSING", message = "正在解析 Excel。";
        volatile Map<String, Object> settings, metadata = new LinkedHashMap<>();
        volatile List<Map<String, Object>> rows = List.of(); volatile List<String> periods = List.of();
        Job(String id, String filename, String username, Path file, Map<String, Object> settings)
        { this.id = id; this.filename = filename; this.username = username; this.file = file; this.settings = JSON.parseObject(JSON.toJSONString(settings)); }
    }
}
