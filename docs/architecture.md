# 架构说明

## 总体架构

本实践演示「用 TypeScript 以六边形架构组织一个 Serverless CRUD API」：客户端通过公网 HTTPS 入口发起四类 REST 请求，由四个各自独立的函数分别承接商品列表、单条查询、写入与删除；四个入口只依赖 `ProductStore` 抽象端口，具体存储适配器在入口层完成绑定；商品数据统一落在托管 NoSQL 表中，结构化日志、自定义指标与链路标识由云日志服务采集。

```
                            ┌────────────┐
                            │   客户端   │
                            └──────┬─────┘
                                   │ ① HTTPS 请求
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│              APIG 专享版（公网入口，四个已发布 API）               │
│          GET /products  ·  GET|PUT|DELETE /products/{id}           │
└───────┬─────────────────┬─────────────────┬─────────────────┬──────┘
        │                 │   ② 同步调用    │                 │
        ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ getProducts  │  │  getProduct  │  │  putProduct  │  │deleteProduct │
│   列表函数   │  │   单查函数   │  │   写入函数   │  │   删除函数   │
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                 │                 │                 │
        └─────────────────┴────────┬────────┴─────────────────┘
                                   │ ③ 只依赖 ProductStore 端口
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│          领域层：Product 领域模型 + ProductStore 端口接口          │
│               入口层与具体存储实现解耦（六边形架构）               │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ ④ GeminiDbStore 适配器
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│          GeminiDB（DynamoDB 兼容接口，内网负载均衡地址）           │
│         Products 表（主键 id，读 Get/Scan，写 Put/Delete）         │
└────────────────────────────────────────────────────────────────────┘
```

**图例**：① 客户端经公网入口发起请求；② 网关按方法同步调用对应函数；③ 四个入口只依赖领域层端口；④ 适配器把端口操作落到托管表。四个函数共享同一份部署包，由 `handler` 字段区分入口。

## 关键组件

| 组件 | 服务 | 职责 |
|---|---|---|
| 公网接口 | API 网关（APIG）专享版 | 对外提供 `GET /products`、`GET /products/{id}`、`PUT /products/{id}`、`DELETE /products/{id}`；开启跨域，同步调用函数；API 需显式发布到 `RELEASE` 环境 |
| 四个函数 | 函数工作流（FunctionGraph） | Node.js 18.18 运行时、256 MB、30 s；四个函数各自独立，分别由 `getProducts.handler` / `getProduct.handler` / `putProduct.handler` / `deleteProduct.handler` 进入 |
| 键值存储 | 云数据库 GeminiDB（DynamoDB 兼容接口） | 存放 `Products` 表，主键 `id`；集群形态经负载均衡内网地址的高可用端口 80 访问，首次访问按需建表 |
| 结构化日志 | 云日志服务（LTS） | 一个日志组 + 一个日志流，保留期 7 天；函数只向标准输出写 JSON 行 |
| 自定义指标 | 应用运维管理（AOM） | 结构化指标行带命名空间与维度，可配置日志指标提取规则转为自定义指标 |
| 凭据来源 | 统一身份认证（IAM）云服务委托 | 以 `op_svc_cff` 为被委托服务，使函数可挂接私有网络 |
| 网络 | 虚拟私有云（VPC）/ 子网 / 安全组 | 托管表无公网端点，函数与网关实例均接入同一 VPC；安全组放通负载均衡端口 80 与节点端口 8000 |

## 工作流程

1. 客户端向 `GET /products` 或 `/products/{id}` 发起 HTTPS 请求，`PUT` 请求在请求体中携带商品 JSON。
2. API 网关按方法与路径匹配已发布的 API，同步调用对应函数并传入代理事件。
3. 入口层中间件链解析事件：从 `pathParameters`、查询参数或路径尾段取 `id`；请求体支持明文字符串、base64 字符串与已解析对象；从 `x-trace-id` 请求头或网关请求 ID 生成链路标识。
4. 业务 handler 通过 `ProductStore` 端口发起操作，全部成功时返回业务响应；缺少 `id`、请求体为空、JSON 解析失败、路径与请求体 `id` 不一致均返回 400，单条查询未命中返回 404，写入成功返回 201，删除与列表返回 200。
5. 中间件链统一记录耗时、完成指标与结构化日志，任何未捕获异常收敛为 500，并写入错误日志。
6. `GeminiDbStore` 适配器把端口操作翻译为兼容协议的 Get / Scan / Put / Delete 命令；首次访问先探测表，缺失时按 `id` 字符串主键创建。
7. 标准输出的 JSON 行由 LTS 采集；带 `type=metric` 的行可经 AOM 日志指标提取形成自定义指标。

## 六边形分层

| 层 | 源码位置 | 依赖方向 | 说明 |
|---|---|---|---|
| 入口层（composition root） | `src/functions/src/getProducts.ts`、`getProduct.ts`、`putProduct.ts`、`deleteProduct.ts` | 端口 → 适配器 | 把 `ProductStore` 端口绑定到 `GeminiDbStore`，并注入可观测门面 |
| 业务处理层 | `src/functions/src/handlers.ts` | 只依赖端口 | 四个 handler 工厂；不含任何具体存储实现，由 `store` / `storeFactory` 注入 |
| 领域层 | `src/functions/src/model/Product.ts`、`src/functions/src/store/ProductStore.ts` | 无外部依赖 | 领域模型 `Product` 与四方法端口接口 |
| 适配器层 | `src/functions/src/store/GeminiDbStore.ts` | 实现端口 | 唯一存储适配器，`ensureTable` 按需建表 |
| 横切层 | `src/functions/src/event.ts`、`response.ts`、`middleware.ts`、`observability.ts` | 被入口层复用 | 事件归一、代理响应、链路与计时、结构化日志、错误边界 |

`handlers.ts` 的编译产物中不允许出现 `GeminiDbStore` 字样；本地端到端检查对此设有专门断言，用于保证端口与适配器的解耦不会在后续维护中被写死。

## 两套凭据的分工

| 平面 | 目标 | 凭据 | 提供位置 |
|---|---|---|---|
| 控制面 | 函数挂接私有网络、平台侧调用 | IAM 云服务委托下发的临时凭据 | `infra/functions.tf` 中的 `huaweicloud_identity_agency.functiongraph` |
| 数据面 | 托管表兼容端点 | 实例账号 `rwuser` + 实例管理员密码 | `infra/functions.tf` 的 `user_data`，来自 `geminidb_password` |

数据面只认实例账号与实例管理员密码，不接受云服务委托临时凭据，也不接受临时凭据标识；控制面凭据不会出现在环境变量中。二者不可互换。实例密码由部署参数提供，Terraform 标记为 `sensitive`，`terraform.tfvars` 被版本控制忽略。

## 安全设计

| 项 | 设计 |
|---|---|
| 长期凭据 | 部署包与配置中不含长期密钥；访问密钥由 shell 环境提供，实例密码只在部署期下发为敏感参数 |
| 网络边界 | 托管表不绑定公网地址，仅 VPC 内网可达；安全组只放通 VPC 网段的数据端口 |
| 接口鉴权 | 教学演示接口未启用访问鉴权；生产使用应在 API 网关上启用认证与限流，并把跨域来源从通配符改为具体站点 |
| 传输 | 对外接口使用 HTTPS；VPC 内的数据面连接使用 `http`（与实例 TLS 开关一致，可用 `geminidb_protocol` 调整） |
| 输入校验 | 路径 `id` 与请求体 `id` 必须一致；请求体必须可解析为带字符串 `id` 的对象 |
| 环境净化 | FunctionGraph 拒绝空字符串环境变量，部署前过滤空值，避免 `FSS.1009` |
| 日志 | 结构化日志只写标准输出，函数内不持有日志凭据或网络客户端 |

## 配置对应关系

| 配置项 | 位置 | 说明 |
|---|---|---|
| `GEMINIDB_ENDPOINT` | `infra/functions.tf` → `user_data` | 由实例负载均衡地址与端口 80 推导 |
| `GEMINIDB_PROTOCOL` | `infra/variables.tf` → `geminidb_protocol` | 数据面客户端使用的协议，默认 `http` |
| `PRODUCT_TABLE` | `infra/variables.tf` → `product_table_name` | 四个函数共用的表名，默认 `Products` |
| `CORS_ALLOW_ORIGIN` | `infra/variables.tf` → `cors_allowed_origins` | 代理响应允许来源，默认通配符 |
| `LOG_LEVEL` / `SERVICE_NAME` / `METRIC_NAMESPACE` | `infra/variables.tf` | 结构化日志级别、服务名与指标命名空间 |
| `LTS_GROUP_ID` / `LTS_STREAM_ID` | `infra/observability.tf` | 日志组与日志流标识，随环境变量下发 |
| `enable_public_api` | `infra/variables.tf` | 是否创建网关专享实例与公网入口，默认 `true` |
| `apig_ingress_bandwidth_size` | `infra/variables.tf` | 网关公网入口带宽规格 |
| `lts_ttl_in_days` | `infra/variables.tf` | 日志保留天数，默认 7 |

## 轻量验证档拓扑

把 `enable_public_api` 设为 `false` 时，网关专享实例、分组、四个 API 与发布动作均不创建；VPC、托管表、日志流与四个函数保持不变。链路变化只在「谁去触发函数」这一环，函数内部的分层与数据访问完全一致。

```
┌────────────────────────────────────────────────────────────────────┐
│             直接调用函数（CLI / 测试事件，无公网入口）             │
│                  四个函数各自独立调用，不经过网关                  │
└───────┬─────────────────┬─────────────────┬─────────────────┬──────┘
        │                 │   ① 直接调用    │                 │
        ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ getProducts  │  │  getProduct  │  │  putProduct  │  │deleteProduct │
│   列表函数   │  │   单查函数   │  │   写入函数   │  │   删除函数   │
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                 │                 │                 │
        └─────────────────┴────────┬────────┴─────────────────┘
                                   │ ② 只依赖 ProductStore 端口
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│          领域层：Product 领域模型 + ProductStore 端口接口          │
│               入口层与具体存储实现解耦（六边形架构）               │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ ③ GeminiDbStore 适配器
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│          GeminiDB（DynamoDB 兼容接口，内网负载均衡地址）           │
│         Products 表（主键 id，读 Get/Scan，写 Put/Delete）         │
└────────────────────────────────────────────────────────────────────┘
```

两档的判废条件相同：只要仍由四个各自独立的函数分别承接列表 / 单查 / 写入 / 删除请求，且入口层仍通过 `ProductStore` 端口与具体适配器解耦，主题即成立。差别在于轻量档没有公网入口，验证证据不含 HTTPS 调用。
