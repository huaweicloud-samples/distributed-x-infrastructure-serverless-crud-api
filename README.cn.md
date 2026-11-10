# distributed-x-infrastructure-serverless-crud-api 华为云实践

> [English](README.md)

[![License](https://img.shields.io/badge/License-MIT%20No%20Attribution-blue.svg)](LICENSE)
[![Huawei Cloud](https://img.shields.io/badge/Huawei%20Cloud-FunctionGraph-red.svg)](https://support.huaweicloud.com/intl/en-us/)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](#)

> 华为云上的六边形架构 TypeScript Serverless CRUD API

---

## 1. 简介

四个各自独立的 FunctionGraph 函数分别承接商品列表、单条查询、写入与删除四类 REST 请求。四个入口只依赖 `ProductStore` 抽象端口，由唯一适配器把该端口绑定到托管键值表；结构化日志、自定义指标与链路标识以 JSON 行输出，由云日志服务（LTS）与应用运维管理（AOM）采集。

面向希望在无服务器 TypeScript 代码库中落地六边形架构的后端工程师：端口放在哪里、组合根如何保持轻薄、一份部署包如何支撑四个独立部署的函数，本实践给出可直接复现的参考。

### 核心能力

- 四个已发布接口：`GET /products`、`GET /products/{id}`、`PUT /products/{id}`、`DELETE /products/{id}`。
- 四个独立的 Node.js 18 函数共享同一份 TypeScript 编译产物，由 `handler` 字段区分入口。
- 端口—适配器解耦：`handlers.ts` 不导入任何具体存储实现，四个组合根负责绑定 `GeminiDbStore`。
- GeminiDB 实例使用 DynamoDB 兼容协议，经 VPC 内网地址访问，首次访问时按需建表。
- 结构化日志、单次请求耗时、完成指标与统一的 500 错误边界。
- 轻量验证档可省略公网网关，同时保留四个函数与完整数据链路。

---

## 2. 目录

- [1. 简介](#1-简介)
- [2. 目录](#2-目录)
- [3. 架构图](#3-架构图)
- [4. 方案亮点](#4-方案亮点)
- [5. 涉及云服务](#5-涉及云服务)
- [6. 前置条件](#6-前置条件)
- [7. 快速开始](#7-快速开始)
- [8. 分步部署](#8-分步部署)
- [9. 使用方法 / 验证](#9-使用方法--验证)
- [10. 清理资源](#10-清理资源)
- [11. 详细说明](#11-详细说明)
- [12. 依赖](#12-依赖)
- [13. FAQ / 故障排除](#13-faq--故障排除)
- [14. 贡献指南](#14-贡献指南)
- [15. 许可证](#15-许可证)
- [16. 联系方式 / 维护者](#16-联系方式--维护者)

---

## 3. 架构图

> 四类请求分别进入四个独立函数；入口层只依赖同一个领域端口，由唯一适配器访问托管表。

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

**轻量验证档**（`-var enable_public_api=false`）：网关专享实例、分组、四个 API 与发布动作均不创建；VPC、表实例、日志流与四个函数保持不变，可直接分别调用四个函数。

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

① 客户端经公网入口发起 HTTPS 请求（轻量档改为直接调用函数）；② 按方法同步调用对应函数；③ 四个入口只依赖领域端口；④ 适配器把端口操作落到托管表。

组件职责、六边形分层、两套凭据与配置对应关系详见 [`docs/architecture.md`](docs/architecture.md)。

**关键组件**：

- **API 网关（APIG）专享版**：对外提供四个路由，开启跨域，同步调用对应函数。
- **函数工作流（FunctionGraph）**：四个独立的 Node.js 18 函数，256 MB / 30 s，共享一份部署包。
- **云数据库 GeminiDB**：存放 `Products` 表，字符串主键 `id`，经内网负载均衡地址的 80 端口访问。
- **云日志服务（LTS）/ 应用运维管理（AOM）**：采集标准输出的 JSON 日志行与 `type=metric` 指标行。
- **统一身份认证（IAM）**：云服务委托，使函数可挂接私有网络。

---

## 4. 方案亮点

- **真实的六边形边界**：业务 handler 模块只依赖 `ProductStore` 接口，绑定适配器完全由四个组合根负责。
- **四函数一份包**：TypeScript 只编译一次，由 `handler` 字段为每个函数选择入口。
- **部署包不含长期密钥**：表数据面使用实例账号，函数内不持有日志凭据或网络客户端。
- **数据路径不出内网**：托管表无公网端点，仅 VPC 内网可达。
- **两套验证档**：保留公网网关做 HTTP 验证，或省略网关直接调用四个函数。
- **本地端到端检查**：44 项断言覆盖四个 handler、事件解码、端口隔离、入口绑定、响应、可观测性与存储适配器，无需连接云端。

---

## 5. 涉及云服务

| 服务 | 用途 | 说明 |
|---|---|---|
| API 网关（APIG） | 四个公网 REST 路由 | BASIC 专享版；API 需显式发布到 `RELEASE` 环境 |
| 函数工作流（FunctionGraph） | 四个商品函数 | Node.js 18.18、256 MB、30 s |
| 云数据库 GeminiDB | 托管键值表 | DynamoDB 兼容接口、Cluster 形态、最少三节点 |
| 云日志服务（LTS） | 结构化应用日志 | 一个日志组 + 一个日志流，保留 7 天 |
| 应用运维管理（AOM） | 自定义指标 | 通过日志指标提取消费 `type=metric` 行 |
| 统一身份认证（IAM） | 运行时委托 | `op_svc_cff` 云服务委托，带 VPC 角色 |
| 虚拟私有云（VPC） | 私有网络 | 函数与网关实例共用 VPC、子网与安全组 |

> 全部服务由本仓库 Terraform 创建。释放方式见[第 10 章「清理资源」](#10-清理资源)。

---

## 6. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| **账号** | 已完成实名认证的华为云账号 | 个人或企业账号均可 |
| **权限** | IAM **Tenant Administrator** 或同等权限 | 需创建 VPC、GeminiDB、LTS、FunctionGraph、API 网关与委托 |
| **区域** | 推荐 `cn-north-4` | 规格码与可用区随区域不同 |
| **Terraform** | `>= 1.5.0` | 基础设施编排工具 |
| **huaweicloud Provider** | `>= 1.97.0` | 华为云 Terraform Provider |
| **Node.js / npm** | `>= 18` | 编译 TypeScript 函数并安装运行时依赖 |
| **Python** | `>= 3.8` | 打包脚本用它组装 zip |
| **访问密钥** | 在华为云「我的凭证」页面获取 Access Key 与 Secret Access Key，并通过 shell 环境提供 | 不要写入任何代码或配置文件 |

---

## 7. 快速开始

### 一键部署（推荐）

```bash
# 1. 克隆仓库
git clone <repo-https-url> distributed-x-infrastructure-serverless-crud-api
cd distributed-x-infrastructure-serverless-crud-api

# 2. 通过 shell 环境提供访问密钥（见第 6 章）
export HW_ACCESS_KEY="<your-access-key>"
export HW_SECRET_KEY="<your-secret-key>"

# 3. 构建函数部署包并部署
bash scripts/package-function.sh
cd infra
cp terraform.tfvars.example terraform.tfvars
# 编辑 terraform.tfvars：填写 project_id 与 geminidb_password
terraform init
terraform plan
terraform apply -auto-approve
```

> **部署耗时**：约 15–25 分钟（托管表实例创建最久）。
> **完整步骤与预期输出**：见[第 8 章](#8-分步部署)及 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

---

## 8. 分步部署

### 步骤 1：构建共享函数部署包

```bash
bash scripts/package-function.sh
```

**预期输出**：`archive=.../build/function.zip files=3273 bytes=2825691`，随后输出 `Done: .../build/function.zip`。

### 步骤 2：初始化工作目录

```bash
cd infra
terraform init
```

**预期输出**：`Terraform has been successfully initialized!`

### 步骤 3：预览资源变更

```bash
terraform validate
terraform plan
```

**预期输出**：`Success! The configuration is valid.`，随后 `Plan: N to add, 0 to change, 0 to destroy.`

### 步骤 4：执行部署

```bash
terraform apply -auto-approve
```

**预期输出**：`Apply complete! Resources: N added, 0 changed, 0 destroyed.`

### 步骤 5：记录关键输出

```bash
terraform output
```

**预期输出**：列出 `api_endpoint`、`function_names`、`function_urns`、`product_table_name`、`geminidb_endpoint`、`lts_group_id`、`lts_stream_id` 与 `api_routes`。

---

## 9. 使用方法 / 验证

> **验证提醒**：部署完成后请按本章步骤自行验证，确认业务功能可用，方可视为交付完成。下列本地端到端检查已在开发期实际执行；云端命令需在部署完成后运行。

### 验证 1：本地端到端检查（开发期已执行）

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
```

**预期输出**：
```
=== Summary: 44 passed, 0 failed ===
```

检查覆盖四个 handler 工厂、从路径 / 查询参数 / 路径尾段提取 `id`、base64 与对象请求体、400 / 404 / 201 / 200 / 500 响应路径、`handlers.js` 的端口隔离、四个入口的适配器绑定、CORS 头、链路标识传递、日志级别过滤与指标行。

### 验证 2：调用四个公网路由

```bash
BASE="$(terraform output -raw api_endpoint)"

curl -i -X PUT "$BASE/p-001" \
  -H 'Content-Type: application/json' \
  -d '{"id":"p-001","name":"Notebook","price":42}'

curl -i "$BASE/p-001"
curl -i "$BASE"
curl -i -X DELETE "$BASE/p-001"
```

**预期输出**：依次返回 `HTTP/1.1 201` `{"message":"Product created"}`、`200` 商品对象、`200` `{"products":[...]}`、`200` `{"message":"Product deleted"}`；删除后再次单查返回 `404`。

### 验证 3：查看结构化日志与指标

打开 `terraform output -raw lts_stream_id` 指定的日志流。每次调用产生带 `trace_id`、`service`、`handler`、`status_code`、`duration_ms` 的 `type=log` 行，以及带指标名与命名空间的 `type=metric` 行。

### 验证 4：无公网入口的轻量档

```bash
terraform apply -auto-approve -var enable_public_api=false
```

随后用测试事件分别调用 `terraform output -raw function_names` 列出的四个函数，例如 `{"path":"/products/p-001","pathParameters":{"id":"p-001"},"httpMethod":"PUT","body":"{\"id\":\"p-001\",\"name\":\"Notebook\",\"price\":42}"}`。

**预期结果**：handler 响应与日志行一致；不创建网关专享实例。

---

## 10. 清理资源

```bash
cd infra
terraform destroy -auto-approve
```

**预期输出**：`Destroy complete! Resources: N destroyed.`

> **避免资源残留**：
> - `terraform destroy` 只释放 Terraform 状态中跟踪的资源；
> - 在控制台额外创建的资源（例如追加的 API 发布）需手动释放；
> - 账号内由其他任务共用的 VPC 资源不受影响。

---

## 11. 详细说明

### 工作流程

网关匹配已发布路由并同步调用对应函数。入口层中间件解析 `id` 与请求体、生成链路标识，再调用只依赖 `ProductStore` 的业务 handler。`GeminiDbStore` 适配器把端口操作翻译为兼容协议的 Get / Scan / Put / Delete 命令访问内网端点，首次访问按需建表。中间件输出完成指标与结构化日志，并把未捕获异常收敛为 500 响应。

### 六边形分层

| 层 | 源码 | 职责 |
|---|---|---|
| 组合根 | `src/functions/src/getProducts.ts`、`getProduct.ts`、`putProduct.ts`、`deleteProduct.ts` | 绑定端口到 `GeminiDbStore`，注入可观测门面 |
| 业务处理层 | `src/functions/src/handlers.ts` | 四个 handler 工厂，不导入具体存储实现 |
| 领域层 | `src/functions/src/model/Product.ts`、`src/functions/src/store/ProductStore.ts` | `Product` 模型与四方法端口接口 |
| 适配器层 | `src/functions/src/store/GeminiDbStore.ts` | 表客户端、按需建表、读写命令 |
| 横切层 | `src/functions/src/event.ts`、`response.ts`、`middleware.ts`、`observability.ts` | 事件归一、代理响应、链路与计时、日志、错误边界 |

### 配置项

| 变量 | 默认值 | 说明 |
|---|---|---|
| `region` | `cn-north-4` | 部署区域 |
| `project_id` | *（必填）* | 区域项目 ID |
| `geminidb_password` | *（必填）* | 数据面账号 `rwuser` 使用的实例管理员密码 |
| `geminidb_node_num` | `3` | 节点数；兼容接口最少三节点 |
| `geminidb_protocol` | `http` | 表客户端访问内端点使用的协议 |
| `product_table_name` | `Products` | 四个函数共用的表名 |
| `function_runtime` | `Node.js18.18` | FunctionGraph 运行时 |
| `lts_ttl_in_days` | `7` | 日志组与日志流保留天数 |
| `cors_allowed_origins` | `["*"]` | 允许来源，生产使用应收紧 |
| `enable_public_api` | `true` | 是否创建网关专享实例与公网入口 |

完整清单与逐步说明见 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

### 接口 / API

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| `GET` | `/release/products` | - | `200` `{"products":[...]}` |
| `GET` | `/release/products/{id}` | - | `200` 商品对象；不存在返回 `404` |
| `PUT` | `/release/products/{id}` | `{"id":"p-001","name":"Notebook","price":42}` | `201` `{"message":"Product created"}` |
| `DELETE` | `/release/products/{id}` | - | `200` `{"message":"Product deleted"}` |
| 任意 | 任意 | `id` / 请求体非法或两者不一致 | `400`，响应体带说明字段 |

所有响应均包含 `Content-Type: application/json` 与可配置的跨域响应头。

---

## 12. 依赖

| 名称 | 版本 | 用途 |
|---|---|---|
| Terraform | `>= 1.5.0` | 基础设施编排 |
| huaweicloud Provider | `>= 1.97.0` | 华为云资源 |
| Node.js | `>= 18` | 函数运行时与打包 |
| TypeScript | `^5.7.0` | 编译四个入口到 `build/package` |
| `@aws-sdk/client-dynamodb` | `^3.744.0` | GeminiDB DynamoDB 兼容接口的协议客户端 |
| `@aws-sdk/lib-dynamodb` | `^3.744.0` | Get / Scan / Put / Delete 文档客户端 |
| `@types/node` | `^22.10.0` | 构建期 Node 类型声明 |

---

## 13. FAQ / 故障排除

### Q1：部署提示「权限不足」怎么办？

**A**：确认账号具备 IAM **Tenant Administrator**，或至少具备 VPC、GeminiDB、LTS、FunctionGraph、API 网关的管理员权限以及创建委托的权限。

### Q2：网关对全部路由返回 404，为什么？

**A**：API 尚未发布。Terraform 配置会把每个 API 发布到 `RELEASE` 环境，重新 apply 并确认发布资源存在；同时检查路径是否带 `/release` 前缀。

### Q3：`terraform apply` 报 `FSS.1501 The delegate not exist`，为什么？

**A**：IAM 委托生效存在延迟。等待约一分钟后重新 apply；配置中已声明依赖关系。

### Q4：写入报 `AccessDeniedException` 或超时，需要检查什么？

**A**：数据面只接受 `rwuser` 与实例管理员密码。Cluster 形态经负载均衡 80 端口提供兼容协议，节点直连使用 8000；请检查 `geminidb_protocol` 与安全组规则。

### 排障清单

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `FSS.1009 Invalid function UserData` | 环境变量为空字符串 | 配置已在编码前过滤空值 |
| 函数返回 500 | 适配器或 handler 异常 | 查看函数日志中的 `request failed` 行 |
| `400 Product ID in path does not match...` | 请求体 `id` 与路径不一致 | 保持两个标识一致 |
| 浏览器跨域报错 | 网关跨域未开启 | 检查 `cors = true` 与 `cors_allowed_origins` |
| 提示部署包缺失 | 跳过打包步骤 | 执行 `bash scripts/package-function.sh` 后再 `terraform plan` |

---

## 14. 贡献指南

欢迎提交 Issue 与 PR，建议流程：

1. **Issue**：描述问题或建议，附复现命令、预期与实际输出、截图。
2. **PR**：从 `main` 建特性分支；提交前运行 `terraform validate`、`terraform fmt -check` 与 `node scripts/local-e2e/run_e2e.js`。
3. **代码评审**：由 **[@<github-username>](https://github.com/<github-username>)** 评审后合并。

详见 `CONTRIBUTING.md`。

---

## 15. 许可证

本实践采用 **MIT No Attribution** 许可证。详见仓库根目录的 [`LICENSE`](LICENSE) 文件。

```
MIT No Attribution

Copyright (c) Huawei Cloud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software... (no attribution required)
```

---

## 16. 联系方式 / 维护者

| 项 | 内容 |
|---|---|
| **创建者** | [@<github-username>](https://github.com/<github-username>) |
| **维护者** | [@<github-username>](https://github.com/<github-username>) |
| **交流渠道** | GitHub Issues / PR（见[第 14 章](#14-贡献指南)） |
