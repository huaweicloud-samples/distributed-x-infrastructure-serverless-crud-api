locals {
  function_zip = "${path.module}/../build/function.zip"

  # A missing package produces a clear runtime error instead of an opaque
  # "Invalid function argument" from filebase64 during plan.
  function_code = (
    fileexists(local.function_zip)
    ? filebase64(local.function_zip)
    : base64encode("throw new Error('Missing deployment package: build/function.zip. Run scripts/package-function.sh first.')")
  )

  # The load balancer address is per instance and cannot be derived from the region.
  # Cluster mode serves the compatible protocol on high-availability port 80.
  geminidb_endpoint = "${huaweicloud_geminidb_instance.products.lb_ip_address}:${local.geminidb_lb_port}"

  # Four independent functions share one deployment package; the handler field
  # selects which entry point each FunctionGraph function serves.
  handlers = {
    get_products   = "getProducts.handler"
    get_product    = "getProduct.handler"
    put_product    = "putProduct.handler"
    delete_product = "deleteProduct.handler"
  }

  # FunctionGraph rejects environment variables whose value is an empty string
  # (FSS.1009 Invalid function UserData), so filter them out before encoding.
  env_without_empty = {
    for k, v in {
      REGION              = var.region
      HW_PROJECT_ID       = var.project_id
      GEMINIDB_ENDPOINT   = local.geminidb_endpoint
      GEMINIDB_PROTOCOL   = var.geminidb_protocol
      GEMINIDB_ACCESS_KEY = "rwuser"
      GEMINIDB_SECRET_KEY = var.geminidb_password
      PRODUCT_TABLE       = var.product_table_name
      SERVICE_NAME        = var.service_name
      LOG_LEVEL           = var.log_level
      METRIC_NAMESPACE    = var.metric_namespace
      LTS_GROUP_ID        = huaweicloud_lts_group.app.id
      LTS_STREAM_ID       = huaweicloud_lts_stream.app.id
      CORS_ALLOW_ORIGIN   = join(",", var.cors_allowed_origins)
    } : k => v if v != null && v != ""
  }
}

# Cloud service agency: the functions attach to the private network so they can
# reach the table endpoint. The data plane uses the instance account rwuser, so
# no key-value store role is granted to this agency.
resource "huaweicloud_identity_agency" "functiongraph" {
  name                   = "${local.name_prefix}-fgs-agency"
  description            = "Agency for the product API functions to attach to a VPC"
  delegated_service_name = "op_svc_cff"

  project_role {
    project = var.region
    roles = [
      "VPC Administrator",
    ]
  }
}

resource "huaweicloud_fgs_function" "crud" {
  for_each = local.handlers

  name        = "${local.name_prefix}-${replace(each.key, "_", "-")}"
  app         = "default"
  agency      = huaweicloud_identity_agency.functiongraph.name
  handler     = each.value
  runtime     = var.function_runtime
  memory_size = var.function_memory_size
  timeout     = var.function_timeout

  code_type     = "zip"
  code_filename = "function.zip"
  func_code     = local.function_code

  vpc_id     = huaweicloud_vpc.main.id
  network_id = huaweicloud_vpc_subnet.main.id

  user_data = jsonencode(local.env_without_empty)

  # IAM agency propagation is asynchronous; creating the functions too early
  # fails with FSS.1501 The delegate not exist.
  depends_on = [huaweicloud_identity_agency.functiongraph]
}
