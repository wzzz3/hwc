# 库存中心独立版（开发交付包）

## 状态

当前包是库存中心的可运行开发底座，适合继续独立开发和页面替换验证。Flash 三表导入、SQLite 原始明细保存和当前批次查询已完成。它不是可直接上线的生产成品：其余库存业务 API、通用 Excel 导入导出和现有若依数据迁移尚未完成。

## 运行环境

- Linux Node.js 22.13+
- 本地目录读写权限
- SQLite 使用 Node 内置 `node:sqlite`，不需要云端数据库服务

## 启动

```bash
npm start
```

默认监听 `127.0.0.1:3000`。用 `PORT` 指定端口，例如 `PORT=3100 npm start`。

健康检查：`GET /api/health`。

## 当前接口状态

静态页面和健康检查可以运行。已实现 Flash 三表接口：`POST /prod-api/business/inventory/overseas/warehouse-imports`、`POST /warehouse-imports/{id}/commit`、`GET /warehouse-inventory`。其余未迁移的 `/prod-api/**` 请求会明确返回 HTTP `501`，避免误以为数据已经接通。

## 数据与安全

运行产生的 SQLite 文件在 `data/`；该目录不包含在交付 ZIP 中。不要将生产口令、令牌、导入的原始业务文件或 SQLite 数据文件提交进源码包。
