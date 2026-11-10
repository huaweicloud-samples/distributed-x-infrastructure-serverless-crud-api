variable "region" {
  description = "Deployment region"
  type        = string
  default     = "cn-north-4"
}

variable "app_name" {
  description = "Resource name prefix"
  type        = string
  default     = "serverless-crud-api"
}

variable "project_id" {
  description = "Project ID for the deployment"
  type        = string
}

variable "geminidb_password" {
  description = "GeminiDB instance administrator password; the data-plane user is fixed to rwuser"
  type        = string
  sensitive   = true
}

variable "geminidb_az" {
  description = "Availability zones for the GeminiDB cluster"
  type        = list(string)
  default     = ["cn-north-4a", "cn-north-4b", "cn-north-4c"]
}

variable "geminidb_node_num" {
  description = "Number of nodes; the DynamoDB-compatible interface requires a minimum of three"
  type        = number
  default     = 3
}

variable "geminidb_flavor" {
  description = "Node flavor for the compatible interface (large.4 = 2 vCPU / 8 GB)"
  type        = string
  default     = "geminidb.cassandra.large.4"
}

variable "geminidb_storage_size" {
  description = "Storage in GB per node; must be a multiple of 10 and at least 100"
  type        = number
  default     = 100
}

variable "geminidb_protocol" {
  description = "Scheme used by the table client when reaching the private load balancer address"
  type        = string
  default     = "http"
}

variable "product_table_name" {
  description = "Table name used by the four handlers"
  type        = string
  default     = "Products"
}

variable "function_memory_size" {
  description = "Memory size in MB for each FunctionGraph function"
  type        = number
  default     = 256
}

variable "function_timeout" {
  description = "Timeout in seconds for each FunctionGraph function"
  type        = number
  default     = 30
}

variable "function_runtime" {
  description = "FunctionGraph Node.js runtime"
  type        = string
  default     = "Node.js18.18"
}

variable "lts_ttl_in_days" {
  description = "Retention period for structured application logs"
  type        = number
  default     = 7
}

variable "service_name" {
  description = "Service name written into every structured log line"
  type        = string
  default     = "serverless-crud-api"
}

variable "log_level" {
  description = "Minimum level emitted by the observability facade"
  type        = string
  default     = "INFO"
}

variable "metric_namespace" {
  description = "Namespace recorded in structured metric lines"
  type        = string
  default     = "HuaweiCloud/ServerlessCRUD"
}

variable "cors_allowed_origins" {
  description = "Origins allowed on the public API; tighten before production use"
  type        = list(string)
  default     = ["*"]
}

variable "apig_ingress_bandwidth_size" {
  description = "Bandwidth size for the gateway public ingress"
  type        = number
  default     = 5
}

variable "apig_ingress_bandwidth_charging_mode" {
  description = "Bandwidth charging mode of the gateway public ingress"
  type        = string
  default     = "traffic"
}

variable "enable_public_api" {
  description = "Create the dedicated gateway and its public entry; when false, invoke the four functions directly"
  type        = bool
  default     = true
}
