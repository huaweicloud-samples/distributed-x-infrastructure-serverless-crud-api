locals {
  # Dedicated instances ship with a RELEASE environment whose ID is a fixed
  # constant. Querying it through a data source returns nothing during plan
  # when the instance is being replaced.
  release_env_id = "DEFAULT_ENVIRONMENT_RELEASE_ID"

  api_routes = {
    get_products = {
      name   = "get-products"
      method = "GET"
      path   = "/products"
      fn_key = "get_products"
    }
    get_product = {
      name   = "get-product"
      method = "GET"
      path   = "/products/{id}"
      fn_key = "get_product"
    }
    put_product = {
      name   = "put-product"
      method = "PUT"
      path   = "/products/{id}"
      fn_key = "put_product"
    }
    delete_product = {
      name   = "delete-product"
      method = "DELETE"
      path   = "/products/{id}"
      fn_key = "delete_product"
    }
  }
}

# The lightweight verification profile skips the dedicated gateway and its
# public entry. The key-value store, log stream and four functions remain, so
# each function can still be invoked directly to exercise the whole chain.
resource "huaweicloud_apig_instance" "main" {
  count = var.enable_public_api ? 1 : 0

  name              = "${local.name_prefix}-apig"
  edition           = "BASIC"
  vpc_id            = huaweicloud_vpc.main.id
  subnet_id         = huaweicloud_vpc_subnet.main.id
  security_group_id = huaweicloud_networking_secgroup.main.id

  ingress_bandwidth_size          = var.apig_ingress_bandwidth_size
  ingress_bandwidth_charging_mode = var.apig_ingress_bandwidth_charging_mode

  maintain_begin = "02:00:00"

  tags = {
    project = local.name_prefix
  }
}

resource "huaweicloud_apig_group" "main" {
  count = var.enable_public_api ? 1 : 0

  name        = "${local.name_prefix}-group"
  instance_id = huaweicloud_apig_instance.main[0].id
  description = "Product CRUD API group"
}

resource "huaweicloud_apig_api" "crud" {
  for_each = var.enable_public_api ? local.api_routes : {}

  name        = each.value.name
  instance_id = huaweicloud_apig_instance.main[0].id
  group_id    = huaweicloud_apig_group.main[0].id
  description = "${each.value.method} ${each.value.path}"

  type             = "FunctionGraph"
  request_protocol = "HTTPS"
  request_method   = each.value.method
  request_path     = each.value.path
  cors             = true

  # Teaching endpoint without authentication; enable authentication and
  # request throttling before using this pattern in production.
  security_authentication = "NONE"

  func_graph {
    # Strip the version suffix: updating function code must not trigger an
    # unsupported in-place update of the gateway backend.
    function_urn     = trimsuffix(huaweicloud_fgs_function.crud[each.value.fn_key].urn, ":latest")
    invocation_type  = "sync"
    timeout          = var.function_timeout * 1000
    network_type     = "V1"
    request_protocol = "HTTPS"
  }

  lifecycle {
    ignore_changes = [func_graph]
  }
}

# An API is not reachable until it is explicitly published to an environment.
resource "huaweicloud_apig_api_publishment" "crud" {
  for_each = var.enable_public_api ? local.api_routes : {}

  instance_id = huaweicloud_apig_instance.main[0].id
  api_id      = huaweicloud_apig_api.crud[each.key].id
  env_id      = local.release_env_id
}
