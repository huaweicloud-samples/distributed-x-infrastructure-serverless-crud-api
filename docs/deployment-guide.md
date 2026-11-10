# 部署指导

> 本文给出 `distributed-x-infrastructure-serverless-crud-api` 的完整部署与验证步骤。架构与分层说明见 [`architecture.md`](architecture.md)。

## 1. 部署前准备

| 项 | 要求 |
|---|---|
| 账号 | 已完成实名认证的华为云账号 |
| 权限 | IAM Tenant Administrator 或同等权限（VPC / GeminiDB / LTS / FunctionGraph / APIG / 委托） |
| 区域 | 推荐 `cn-north-4`；`geminidb_az` 默认为该区域三个可用区 |
| 工具 | Terraform `>= 1.5.0`、Node.js `>= 18`、Python `>= 3.8` |
| 参数 | `project_id`、`geminidb_password` |

在华为云「我的凭证」页面获取 Access Key 与 Secret Access Key，通过 shell 环境提供：

```bash
export HW_ACCESS_KEY="<your-access-key>"
export HW_SECRET_KEY="<your-secret-key>"
```

> 访问密钥与实例密码不写入任何代码或配置文件；`terraform.tfvars` 已被版本控制忽略。

## 2. 构建函数部署包

```bash
bash scripts/package-function.sh
```

脚本依次完成：安装依赖 → `tsc -p tsconfig.json` 编译到 `build/package` → 裁剪开发依赖 → 复制运行时依赖并压缩为 `build/function.zip`。

**预期输出**：`archive=.../build/function.zip files=3273 bytes=2825691`，最后一行 `Done: .../build/function.zip`。

四个 FunctionGraph 函数共享这份 zip，由 `handler` 字段区分 `getProducts.handler` / `getProduct.handler` / `putProduct.handler` / `deleteProduct.handler`。未先打包就 plan 时，配置内置了明确的运行期报错提示。

## 3. 填写部署参数

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `project_id` | 是 | - | 区域项目 ID |
| `geminidb_password` | 是 | - | 实例管理员密码，数据面账号固定为 `rwuser` |
| `region` | 否 | `cn-north-4` | 部署区域 |
| `app_name` | 否 | `serverless-crud-api` | 资源名前缀 |
| `geminidb_az` | 否 | 三个可用区 | 集群可用区列表 |
| `geminidb_node_num` | 否 | `3` | 兼容接口最少三节点 |
| `geminidb_flavor` | 否 | `geminidb.cassandra.large.4` | 2 vCPU / 8 GB |
| `geminidb_storage_size` | 否 | `100` | 每节点 GB，须为 10 的倍数且不小于 100 |
| `geminidb_protocol` | 否 | `http` | 表客户端访问内端点的协议 |
| `product_table_name` | 否 | `Products` | 四个函数共用的表名 |
| `function_memory_size` / `function_timeout` | 否 | `256` / `30` | 函数内存（MB）与超时（秒） |
| `function_runtime` | 否 | `Node.js18.18` | 运行时 |
| `lts_ttl_in_days` | 否 | `7` | 日志保留天数 |
| `service_name` / `log_level` / `metric_namespace` | 否 | 见 `variables.tf` | 结构化日志与指标字段 |
| `cors_allowed_origins` | 否 | `["*"]` | 生产使用应收紧为具体站点 |
| `apig_ingress_bandwidth_size` | 否 | `5` | 网关公网入口带宽规格 |
| `apig_ingress_bandwidth_charging_mode` | 否 | `traffic` | 公网入口带宽模式 |
| `enable_public_api` | 否 | `true` | 是否创建网关专享实例与公网入口 |

## 4. 初始化与校验

```bash
terraform init
terraform fmt -check
terraform validate
terraform plan
```

**预期输出**：`Terraform has been successfully initialized!`、`Success! The configuration is valid.`，以及 `Plan: N to add, 0 to change, 0 to destroy.`

## 5. 执行部署

```bash
terraform apply -auto-approve
```

**预期输出**：`Apply complete! Resources: N added, 0 changed, 0 destroyed.`

创建顺序上，IAM 委托先于函数；配置显式声明 `depends_on`，用于规避委托生效延迟导致的 `FSS.1501`。托管表实例创建耗时最长，整轮约 15–25 分钟。

## 6. 记录输出

```bash
terraform output
```

| 输出 | 用途 |
|---|---|
| `api_endpoint` | 公网 `.../release/products` 基址；轻量档返回说明文字 |
| `function_names` / `function_urns` | 四个函数名与 URN，用于直接调用 |
| `product_table_name` | 四个函数共用的表名 |
| `geminidb_endpoint` | 内网负载均衡地址（敏感输出） |
| `lts_group_id` / `lts_stream_id` | 日志检索位置 |
| `api_routes` | 四个方法与路径 |

## 7. 功能验证

### 7.1 本地端到端检查（无需云端）

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
```

**预期输出**：`=== Summary: 44 passed, 0 failed ===`

### 7.2 四个公网路由

```bash
BASE="$(terraform output -raw api_endpoint)"
curl -i -X PUT "$BASE/p-001" -H 'Content-Type: application/json' \
  -d '{"id":"p-001","name":"Notebook","price":42}'
curl -i "$BASE/p-001"
curl -i "$BASE"
curl -i -X DELETE "$BASE/p-001"
```

期望依次为 201 / 200 / 200 / 200，删除后单查返回 404。

### 7.3 日志与指标

在 LTS 中打开 `lts_stream_id` 对应日志流，核对 `type=log` 行的 `trace_id`、`status_code`、`duration_ms` 与 `type=metric` 行的指标名、命名空间。

链路追踪为可选增强：默认配置只把 `x-trace-id` 请求头（或网关请求 ID）作为 `trace_id` 写入结构化日志，不启用自动探针。如需跨服务调用拓扑，可在部署后按应用性能管理（APM）服务的接入指引为四个函数启用探针，并在 LTS 中按 `trace_id` 关联日志；该步骤不影响 CRUD 主流程，本实践不宣称默认启用。

## 8. 轻量验证档

```bash
terraform apply -auto-approve -var enable_public_api=false
```

该档不创建网关专享实例、分组、四个 API 与发布动作；VPC、表实例、日志流与四个函数保留，链路通过直接调用函数验证。注意此档没有公网入口，验证证据不含 HTTPS 调用。

## 9. 清理资源

```bash
terraform destroy -auto-approve
```

**预期输出**：`Destroy complete! Resources: N destroyed.`

销毁后检查是否有控制台手工创建的额外资源，避免残留。若曾单独创建过 API 发布、订阅或委托，需手动释放。

## 10. 常见失败与处置

| 现象 | 原因 | 处置 |
|---|---|---|
| `FSS.1501 The delegate not exist` | IAM 委托传播延迟 | 等待约一分钟后重新 apply |
| `FSS.1009 Invalid function UserData` | 环境变量含空字符串 | `env_without_empty` 已过滤；勿手工注入空值 |
| `AccessDeniedException` | 数据面凭据错误 | 数据面只接受 `rwuser` + 实例管理员密码 |
| 数据面连接超时 | 端口或协议不符 | Cluster 经负载均衡 80 端口；节点直连 8000；检查 `geminidb_protocol` |
| 网关 404 | API 未发布或路径缺前缀 | 检查发布资源，使用 `/release/...` |
| `Missing deployment package` | 未执行打包 | 先运行 `scripts/package-function.sh` |
| `Duplicate local value definition` | 同名 local 被重复定义 | 端点推导只保留在 `functions.tf` |
