# Flash 三表导入的若依后端源码

本目录是与本地 `ruoyi-admin/target/ruoyi-admin.jar` 已编译类逐项核对过的 Flash 功能源码快照，不包含整个若依框架或可直接单独编译的 Maven 工程。

## 文件

- `WarehouseImportController.java`：三文件预览、确认导入、库存查询接口。
- `WarehouseImportService.java`：Excel 校验、同批次事务写入和按 System SKU 关联查询。
- `OverseasInventoryService.java` 与 `OverseasInventoryController.java`：将 Flash 当前批次的可用库存替换进当月海外仓展示。
- `OverseasInventoryMapper.xml`：海外库存查询所需 Mapper。
- `sql/overseas_warehouse_import.sql`：三张原始明细表与导入批次表 DDL。

## 接入

将这些文件应用到同版本的 RuoYi 3.9.2 完整源码后，先在 `rpa_database` 执行 SQL，再从根目录构建：

```bash
mvn -pl ruoyi-admin -am clean package -DskipTests
```

数据库必须启用 analytics 数据源并拥有 `rpa_database` 的写入权限。上传接口当前仅要求已登录；上线前应补充菜单权限和操作审计。
