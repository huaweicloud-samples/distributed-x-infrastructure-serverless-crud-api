locals {
  ingress_address = try(one(huaweicloud_apig_instance.main[*].ingress_address), "")
}

output "api_endpoint" {
  description = "Public base URL for the product API"
  value = (
    var.enable_public_api
    ? (local.ingress_address != ""
      ? "https://${local.ingress_address}/release/products"
    : "public entry is not ready; check the gateway ingress configuration")
    : "public entry is disabled (lightweight verification profile; invoke the functions directly)"
  )
}

output "function_names" {
  description = "Names of the four independent FunctionGraph functions"
  value       = { for k, f in huaweicloud_fgs_function.crud : k => f.name }
}

output "function_urns" {
  description = "URNs of the four FunctionGraph functions, for direct invocation"
  value       = { for k, f in huaweicloud_fgs_function.crud : k => f.urn }
}

output "product_table_name" {
  description = "Table used by all four handlers"
  value       = var.product_table_name
}

output "geminidb_endpoint" {
  description = "Private load balancer address of the table instance"
  value       = local.geminidb_endpoint
  sensitive   = true
}

output "lts_group_id" {
  description = "Log group that collects structured application logs"
  value       = huaweicloud_lts_group.app.id
}

output "lts_stream_id" {
  description = "Log stream used by the four functions"
  value       = huaweicloud_lts_stream.app.id
}

output "api_routes" {
  description = "Method and path of each published API"
  value = {
    for k, r in local.api_routes : k => "${r.method} ${r.path}"
  }
}
