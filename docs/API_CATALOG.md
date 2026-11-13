# 经营看板 API 清单与迁移边界

依据：`work/sales-cockpit-20261104/web/analytics-api.js` 和 `marketplace-inventory-view.js` 的静态调用审计。路径为浏览器请求路径；`/prod-api` 是否由网关剥离应按部署配置验证。这里列出前端封装的接口，部分封装可能未被当前页面调用，并不证明服务端已实现或当前生产可用。

| 前缀 | 方法与相对路径 | 功能和依赖 |
|---|---|---|
| `/prod-api/business/analytics` | GET `/status`, `/options`, `/sales`, `/multiplatform-sales`, `/sales/summary`, `/sales/details`, `/sales/periods`, `/seasonality` | 销售、筛选、季节性和多平台销售数据 |
| 同上 | GET `/advertising`, `/advertising/summary`, `/advertising/details`, `/advertising/periods`, `/inventory`, `/asin/{asin}`, `/report`, `/changes` | 广告、库存和报表数据 |
| `/prod-api/business/logistics` | GET `/status`, `/overview`, `/trend`, `/breakdown`, `/items`, `/anomalies`; POST `/sync` | 物流统计和同步；同步是有副作用的操作 |
| `/prod-api/business/alerts/dingtalk` | GET `/status`, `/rules/metrics`; POST `/test`, `/rules/run` | 钉钉通知和规则；测试及运行规则有副作用 |
| `/prod-api/business/funds/dingtalk` | GET `/status`, `/sheets`, `/fields`, `/records` | 钉钉资金数据 |
| `/prod-api/business/exchange-rates` | GET `/status`; POST `/refresh` | 汇率状态及刷新；刷新会使前端分析缓存失效 |
| `/prod-api/business/inventory/overseas` | GET `/status`, `/inventory`, `/history`, `/warehouse-inventory`, `/marketplace` | 海外仓与平台仓库存；平台仓由独立脚本直接请求，展示领星实时数据及销量配对状态 |
| 同上 | POST `/warehouse-imports`, `/warehouse-imports/{id}/commit`, `/imports`, `/imports/{id}/reconfigure`, `/imports/{id}/commit`; GET `/imports/{id}`, `/export` | 导入、配置、提交及 CSV 导出；导入为 multipart，提交改变服务端数据 |

`/prod-api/operation/metrics` 仅作为 `metricsBaseUrl` 暴露；本次静态搜索未发现通过它发起请求，不能据此认定需要实现具体接口。除海外仓固定前缀和平台仓直接请求外，各服务前缀可通过 `window` 上对应的 `*_API_BASE` 配置覆盖。

## 运行契约

普通请求默认 GET，使用同源凭据、`Admin-Token` cookie 或嵌入父页面通过 `RUOYI_AUTH_REQUEST` / `RUOYI_AUTH` 传入的 Bearer token；401/403 可向父页面发送 `RUOYI_AUTH_FAILED`。前端接受 JSON，若存在 `code` 则要求 200，使用 `data`（如存在）和 `msg`/`message`；各接口的字段适配逻辑在 `analytics-api.js`。海外仓导出需支持文件流及 JSON 错误，导入需支持 multipart，且历史查询保留空身份字段。普通 GET 会丢弃空参数；页面还依赖缓存、取消和超时行为。

## 迁移范围与未证实项

独立部署至少需要静态资源、上述实际启用功能的后端路由及其数据源、认证授权和同源代理；不能只复制页面。应优先保留 API 响应结构和筛选语义，逐项验证导入提交、同步、规则运行、汇率刷新等写操作权限。资金/通知依赖钉钉，平台库存界面标识领星来源；具体外部凭据、数据库表、任务调度及其他上游依赖必须从实际后端部署配置和源码核实，不能从前端推断。当前审计未确认服务端实现及生产可用性；仓库搜索存在不可读目录，因此不能声称后端源码不存在。迁移验收应以真实账号逐项验证状态、筛选、分页、异常、导入/导出及权限。
