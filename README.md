# distributed-x-infrastructure-serverless-crud-api

[![Status](https://img.shields.io/badge/Status-Incubating-blue)]()
[![Huawei Cloud](https://img.shields.io/badge/Huawei%20Cloud-Samples-red)]()
[![Scenario](https://img.shields.io/badge/Scenario-distributed%20x%20infrastructure-success)](https://3ms.huawei.com/docs/docinfo/1300901382590492672?bookstackId=866760814559879168&gid=3591759&l=zh-cn&documentkind=&attachmentIdx=5)

Four independent FunctionGraph functions serve the list, read, create and delete operations of a product REST API. All four entry points depend only on a `ProductStore` port; a single adapter binds that port to a managed key-value table. Structured logs, custom metrics and trace identifiers are emitted as JSON lines for Log Tank Service (LTS) and Application Operations Management (AOM).

## Overview

This repository is created from the huaweicloud-samples automated repository request workflow.

## Getting Started

Add setup, deployment, and verification steps here.

## Contributing

Please use pull requests and follow the repository review rules.

## License

This project is licensed under the MIT-0 license.

## Maintainers

CODEOWNERS: @Ferguson2211

## Feedback

Please use GitHub Issues: https://github.com/huaweicloud-samples/distributed-x-infrastructure-serverless-crud-api/issues
