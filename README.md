# distributed-x-infrastructure-serverless-crud-api

> [中文](README.cn.md)

[![License](https://img.shields.io/badge/License-MIT%20No%20Attribution-blue.svg)](LICENSE)
[![Huawei Cloud](https://img.shields.io/badge/Huawei%20Cloud-FunctionGraph-red.svg)](https://support.huaweicloud.com/intl/en-us/)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](#)

> A hexagonal TypeScript Serverless CRUD API on Huawei Cloud

---

## 1. Overview

Four independent FunctionGraph functions serve the list, read, create and delete operations of a product REST API. All four entry points depend only on a `ProductStore` port; a single adapter binds that port to a managed key-value table. Structured logs, custom metrics and trace identifiers are emitted as JSON lines for Log Tank Service (LTS) and Application Operations Management (AOM).

Designed for backend engineers who want a compact, reproducible reference for hexagonal architecture in a serverless TypeScript codebase: where the port lives, how the composition roots stay thin, and how one deployment package can back four independently deployed functions.

### Core Capabilities

- Four published APIs: `GET /products`, `GET /products/{id}`, `PUT /products/{id}`, `DELETE /products/{id}`.
- Four separate Node.js 18 functions sharing one compiled TypeScript package, selected by the `handler` field.
- A port-and-adapter split: `handlers.ts` never imports a concrete store; four composition roots bind `GeminiDbStore`.
- A GeminiDB instance using the DynamoDB-compatible wire protocol over a private VPC endpoint, with lazy table creation.
- Structured JSON logging, per-request timing, completion metrics and a uniform 500 error boundary.
- A lightweight verification profile that omits the public gateway while keeping all four functions and the full data path intact.

---

## 2. Table of Contents

- [1. Overview](#1-overview)
- [2. Table of Contents](#2-table-of-contents)
- [3. Architecture](#3-architecture)
- [4. Highlights](#4-highlights)
- [5. Cloud Services Used](#5-cloud-services-used)
- [6. Prerequisites](#6-prerequisites)
- [7. Quick Start](#7-quick-start)
- [8. Step-by-Step Deployment](#8-step-by-step-deployment)
- [9. Usage / Verification](#9-usage--verification)
- [10. Cleanup](#10-cleanup)
- [11. Detailed Explanation](#11-detailed-explanation)
- [12. Dependencies](#12-dependencies)
- [13. FAQ / Troubleshooting](#13-faq--troubleshooting)
- [14. Contributing](#14-contributing)
- [15. License](#15-license)
- [16. Contact / Maintainers](#16-contact--maintainers)

---

## 3. Architecture

> Four requests enter four independent functions; all entry points depend on the same domain port, and one adapter reaches the managed table.

```
                            ┌────────────┐
                            │   Client   │
                            └──────┬─────┘
                                   │ ① HTTPS request
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│           APIG dedicated instance (public entry, 4 APIs)           │
│          GET /products  ·  GET|PUT|DELETE /products/{id}           │
└───────┬─────────────────┬─────────────────┬─────────────────┬──────┘
        │                 │  ② sync invoke  │                 │
        ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ getProducts  │  │  getProduct  │  │  putProduct  │  │deleteProduct │
│  list items  │  │   read one   │  │    create    │  │    delete    │
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                 │                 │                 │
        └─────────────────┴────────┬────────┴─────────────────┘
                                   │ ③ depends on the port only
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│          Domain layer: Product model + ProductStore port           │
│        Entry points stay decoupled from storage (hexagonal)        │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ ④ GeminiDbStore adapter
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│        GeminiDB (DynamoDB-compatible interface, private LB)        │
│     Products table (key id; Get/Scan reads, Put/Delete writes)     │
└────────────────────────────────────────────────────────────────────┘
```

**Lightweight verification profile** (`-var enable_public_api=false`): the dedicated gateway, its API group, the four APIs and their publication are not created. The VPC, table instance, log stream and four functions remain unchanged, so each function is invoked directly.

```
┌────────────────────────────────────────────────────────────────────┐
│       Direct invocation (CLI / test event, no public entry)        │
│      Four functions are invoked separately, without a gateway      │
└───────┬─────────────────┬─────────────────┬─────────────────┬──────┘
        │                 │ ① direct invoke │                 │
        ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ getProducts  │  │  getProduct  │  │  putProduct  │  │deleteProduct │
│  list items  │  │   read one   │  │    create    │  │    delete    │
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                 │                 │                 │
        └─────────────────┴────────┬────────┴─────────────────┘
                                   │ ② depends on the port only
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│          Domain layer: Product model + ProductStore port           │
│        Entry points stay decoupled from storage (hexagonal)        │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ ③ GeminiDbStore adapter
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│        GeminiDB (DynamoDB-compatible interface, private LB)        │
│     Products table (key id; Get/Scan reads, Put/Delete writes)     │
└────────────────────────────────────────────────────────────────────┘
```

Step ① is an HTTPS request through the public entry (or a direct invocation in the lightweight profile); ② is the synchronous invoke of the matching function; ③ is the port-only dependency of the four entry points; ④ is the adapter writing to the managed table.

Component responsibilities, the hexagonal layering, credentials and configuration are documented in [`docs/architecture.md`](docs/architecture.md).

**Key components**:

- **API Gateway (APIG) dedicated instance**: exposes four routes, enables CORS and invokes the matching function synchronously.
- **FunctionGraph**: four independent Node.js 18 functions, 256 MB / 30 s, sharing one deployment package.
- **GeminiDB**: stores the `Products` table with a string `id` key, reached over a private load balancer address on port 80.
- **Log Tank Service (LTS) / AOM**: collect the structured log lines and the `type=metric` lines emitted to standard output.
- **Identity and Access Management (IAM)**: a cloud service agency that lets the functions attach to the private network.

---

## 4. Highlights

- **Real hexagonal boundaries**: the business handler module depends on the `ProductStore` interface only; binding an adapter is exclusively the job of the four composition roots.
- **Four independent functions, one package**: TypeScript compiles once, and the `handler` field selects the entry point per function.
- **No long-lived keys in the package**: the table data plane uses the managed instance account; the function holds no logging credential or network client.
- **Private data path**: the table has no public endpoint and is reached only from inside the VPC.
- **Two verification profiles**: keep the public gateway for HTTP checks, or omit it and invoke the four functions directly.
- **Local end-to-end checks**: 44 assertions cover the four handlers, event decoding, port isolation, entry-point binding, responses, observability and the store adapter without contacting the cloud.

---

## 5. Cloud Services Used

| Service | Purpose | Notes |
|---|---|---|
| API Gateway (APIG) | Four public REST routes | Dedicated BASIC instance; APIs must be published to `RELEASE` |
| FunctionGraph | Four product functions | Node.js 18.18, 256 MB, 30 s |
| GeminiDB | Managed key-value table | DynamoDB-compatible interface, Cluster mode, three nodes minimum |
| Log Tank Service (LTS) | Structured application logs | One group + one stream, 7-day retention |
| Application Operations Management (AOM) | Custom metrics | Log metric extraction consumes the `type=metric` lines |
| Identity and Access Management (IAM) | Runtime agency | `op_svc_cff` cloud service agency with VPC role |
| Virtual Private Cloud (VPC) | Private network | VPC, subnet and security group shared by the functions and the gateway |

> All services are created with the Terraform in this repository. To release them, see [Section 10 "Cleanup"](#10-cleanup).

---

## 6. Prerequisites

| Item | Requirement | Description |
|---|---|---|
| **Account** | Huawei Cloud account with real-name verification | Personal or enterprise account |
| **Permissions** | IAM **Tenant Administrator** or equivalent | To create VPC, GeminiDB, LTS, FunctionGraph, API Gateway and an agency |
| **Region** | Recommended `cn-north-4` | Flavor codes and availability zones differ across regions |
| **Terraform** | `>= 1.5.0` | IaC deployment tool |
| **huaweicloud Provider** | `>= 1.97.0` | Huawei Cloud Terraform Provider |
| **Node.js / npm** | `>= 18` | Compiles the TypeScript functions and installs runtime dependencies |
| **Python** | `>= 3.8` | Used by the packaging script to assemble the zip |
| **Access keys** | Obtain an Access Key and Secret Access Key from the Huawei Cloud "My Credentials" page and provide them through the shell environment | Do not write credentials into any code or configuration file |

---

## 7. Quick Start

### One-click Deployment (Recommended)

```bash
# 1. Clone this repository
git clone <repo-https-url> distributed-x-infrastructure-serverless-crud-api
cd distributed-x-infrastructure-serverless-crud-api

# 2. Provide access keys through the shell environment (see Section 6)
export HW_ACCESS_KEY="<your-access-key>"
export HW_SECRET_KEY="<your-secret-key>"

# 3. Build the function package and deploy
bash scripts/package-function.sh
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: set project_id and geminidb_password
terraform init
terraform plan
terraform apply -auto-approve
```

> **Deployment time**: about 15-25 minutes (the managed table instance takes the longest).
> **Full steps with expected output**: see [Section 8](#8-step-by-step-deployment) and [`docs/deployment-guide.md`](docs/deployment-guide.md).

---

## 8. Step-by-Step Deployment

### Step 1: Build the shared function package

```bash
bash scripts/package-function.sh
```

**Expected output**: `archive=.../build/function.zip files=3273 bytes=2825691` followed by `Done: .../build/function.zip`.

### Step 2: Initialize the working directory

```bash
cd infra
terraform init
```

**Expected output**: `Terraform has been successfully initialized!`

### Step 3: Preview resource changes

```bash
terraform validate
terraform plan
```

**Expected output**: `Success! The configuration is valid.` followed by `Plan: N to add, 0 to change, 0 to destroy.`

### Step 4: Apply the deployment

```bash
terraform apply -auto-approve
```

**Expected output**: `Apply complete! Resources: N added, 0 changed, 0 destroyed.`

### Step 5: Record key outputs

```bash
terraform output
```

**Expected output**: lists `api_endpoint`, `function_names`, `function_urns`, `product_table_name`, `geminidb_endpoint`, `lts_group_id`, `lts_stream_id` and `api_routes`.

---

## 9. Usage / Verification

> **Verification notice**: after deployment, follow this section to verify that the business functionality works before considering the delivery complete. The local end-to-end checks below have been executed during development; the cloud commands require a deployed stack.

### Verification 1: Local end-to-end checks (executed during development)

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
```

**Expected output**:
```
=== Summary: 44 passed, 0 failed ===
```

The checks cover the four handler factories, `id` extraction from path/query/tail, base64 and object bodies, 400/404/201/200/500 response paths, port isolation in `handlers.js`, adapter binding in the four entry points, CORS headers, trace propagation, log level filtering and metric lines.

### Verification 2: Exercise the four public routes

```bash
BASE="$(terraform output -raw api_endpoint)"

curl -i -X PUT "$BASE/p-001" \
  -H 'Content-Type: application/json' \
  -d '{"id":"p-001","name":"Notebook","price":42}'

curl -i "$BASE/p-001"
curl -i "$BASE"
curl -i -X DELETE "$BASE/p-001"
```

**Expected output**: `HTTP/1.1 201` with `{"message":"Product created"}`, then `200` with the stored product, then `200` with `{"products":[...]}`, then `200` with `{"message":"Product deleted"}`. A subsequent read returns `404`.

### Verification 3: Check structured logs and metrics

Open the log stream named by `terraform output -raw lts_stream_id`. Each invocation produces `type=log` lines with `trace_id`, `service`, `handler`, `status_code` and `duration_ms`, plus a `type=metric` line carrying the metric name and namespace.

### Verification 4: Lightweight profile without a public endpoint

```bash
terraform apply -auto-approve -var enable_public_api=false
```

Then invoke each of the four functions named by `terraform output -raw function_names` with a test event such as `{"path":"/products/p-001","pathParameters":{"id":"p-001"},"httpMethod":"PUT","body":"{\"id\":\"p-001\",\"name\":\"Notebook\",\"price\":42}"}`.

**Expected result**: the same handler responses and log lines; no dedicated gateway is created.

---

## 10. Cleanup

```bash
cd infra
terraform destroy -auto-approve
```

**Expected output**: `Destroy complete! Resources: N destroyed.`

> **Avoid resource residue**:
> - `terraform destroy` only releases resources tracked in the Terraform state;
> - resources created directly in the console (for example an extra API publication) must be released manually;
> - shared VPC resources used by other tasks in the account are not affected.

---

## 11. Detailed Explanation

### Workflow

The gateway matches a published route and synchronously invokes the corresponding function. The entry-point middleware resolves the `id` and the request body, generates a trace identifier, then calls a business handler that depends on `ProductStore` only. The `GeminiDbStore` adapter translates the port operations into compatible-protocol Get / Scan / Put / Delete commands against the private endpoint, creating the table on first access. The middleware emits a completion metric and a structured log line, and converts uncaught errors into a 500 response.

### Hexagonal Layers

| Layer | Source | Responsibility |
|---|---|---|
| Composition roots | `src/functions/src/getProducts.ts`, `getProduct.ts`, `putProduct.ts`, `deleteProduct.ts` | Bind the port to `GeminiDbStore` and inject the observability facade |
| Business handlers | `src/functions/src/handlers.ts` | Four handler factories; no concrete store import |
| Domain | `src/functions/src/model/Product.ts`, `src/functions/src/store/ProductStore.ts` | `Product` model and the four-method port interface |
| Adapter | `src/functions/src/store/GeminiDbStore.ts` | Table client, lazy table creation, read/write commands |
| Cross-cutting | `src/functions/src/event.ts`, `response.ts`, `middleware.ts`, `observability.ts` | Event normalisation, proxy response, tracing, timing, logs, error boundary |

### Configuration Items

| Variable | Default | Description |
|---|---|---|
| `region` | `cn-north-4` | Deployment region |
| `project_id` | *(required)* | Region project ID |
| `geminidb_password` | *(required)* | Instance administrator password for the data-plane account `rwuser` |
| `geminidb_node_num` | `3` | Node count; the compatible interface has a three-node minimum |
| `geminidb_protocol` | `http` | Scheme used by the table client on the private endpoint |
| `product_table_name` | `Products` | Table shared by the four handlers |
| `function_runtime` | `Node.js18.18` | FunctionGraph runtime |
| `lts_ttl_in_days` | `7` | Retention for the log group and stream |
| `cors_allowed_origins` | `["*"]` | Allowed origins; tighten before production use |
| `enable_public_api` | `true` | Create the dedicated gateway and public entry |

See [`docs/deployment-guide.md`](docs/deployment-guide.md) for the full list and per-step details.

### Interfaces / APIs

| Method | Path | Request | Success response |
|---|---|---|---|
| `GET` | `/release/products` | - | `200` `{"products":[...]}` |
| `GET` | `/release/products/{id}` | - | `200` product object; `404` when absent |
| `PUT` | `/release/products/{id}` | `{"id":"p-001","name":"Notebook","price":42}` | `201` `{"message":"Product created"}` |
| `DELETE` | `/release/products/{id}` | - | `200` `{"message":"Product deleted"}` |
| any | any | invalid `id` / body / mismatched ids | `400` with a message field |

All responses include `Content-Type: application/json` and configurable CORS headers.

---

## 12. Dependencies

| Name | Version | Purpose |
|---|---|---|
| Terraform | `>= 1.5.0` | IaC orchestration |
| huaweicloud Provider | `>= 1.97.0` | Huawei Cloud resources |
| Node.js | `>= 18` | Function runtime and packaging |
| TypeScript | `^5.7.0` | Compiles the four entry points to `build/package` |
| `@aws-sdk/client-dynamodb` | `^3.744.0` | Wire-protocol client for the GeminiDB DynamoDB-compatible interface |
| `@aws-sdk/lib-dynamodb` | `^3.744.0` | Document client for Get / Scan / Put / Delete |
| `@types/node` | `^22.10.0` | Node type declarations at build time |

---

## 13. FAQ / Troubleshooting

### Q1: What if deployment reports "insufficient permissions"?

**A**: Confirm the account has IAM **Tenant Administrator**, or at least administrator permissions for VPC, GeminiDB, LTS, FunctionGraph and API Gateway plus permission to create an agency.

### Q2: The gateway returns 404 for every route. Why?

**A**: The APIs have not been published. The Terraform configuration publishes each API to the `RELEASE` environment; re-apply and confirm the publication resources exist. Also check that the path includes the `/release` prefix.

### Q3: `terraform apply` fails with `FSS.1501 The delegate not exist`. Why?

**A**: IAM agency propagation is asynchronous. Wait about a minute and re-apply; the configuration already declares the dependency.

### Q4: Writes fail with `AccessDeniedException` or time out. What should I check?

**A**: The data plane accepts only `rwuser` plus the instance administrator password. Cluster mode serves the compatible protocol on load balancer port 80; node-direct connections use 8000. Check `geminidb_protocol` and the security group rules.

### Troubleshooting Checklist

| Symptom | Possible Cause | Troubleshooting |
|---|---|---|
| `FSS.1009 Invalid function UserData` | Empty environment variable | The configuration filters empty values before encoding |
| Function returns 500 | Adapter or handler error | Read the `request failed` entry in the function log |
| `400 Product ID in path does not match...` | Body `id` differs from path | Keep both identifiers identical |
| Browser CORS error | Gateway CORS disabled | Verify `cors = true` and `cors_allowed_origins` |
| Missing deployment package error | Packaging step skipped | Run `bash scripts/package-function.sh` before `terraform plan` |

---

## 14. Contributing

Issues and PRs are welcome. Please follow this process:

1. **Issue**: describe the problem or suggestion with reproduction commands, expected and actual output, and screenshots.
2. **PR**: create a feature branch from `main`; run `terraform validate`, `terraform fmt -check` and `node scripts/local-e2e/run_e2e.js` before submitting.
3. **Code Review**: merged after review by **[@<github-username>](https://github.com/<github-username>)**.

See `CONTRIBUTING.md` for details.

---

## 15. License

This reference architecture is released under the **MIT No Attribution** license. See the [`LICENSE`](LICENSE) file at the repository root for details.

```
MIT No Attribution

Copyright (c) Huawei Cloud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software... (no attribution required)
```

---

## 16. Contact / Maintainers

| Item | Content |
|---|---|
| **Creator** | [@<github-username>](https://github.com/<github-username>) |
| **Maintainer** | [@<github-username>](https://github.com/<github-username>) |
| **Contact** | GitHub Issues / PR (see [Section 14](#14-contributing)) |
