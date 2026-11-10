resource "huaweicloud_geminidb_instance" "products" {
  name              = "${local.name_prefix}-db"
  mode              = "Cluster"
  password          = var.geminidb_password
  availability_zone = join(",", var.geminidb_az)
  vpc_id            = huaweicloud_vpc.main.id
  subnet_id         = huaweicloud_vpc_subnet.main.id
  security_group_id = huaweicloud_networking_secgroup.main.id
  charging_mode     = "postPaid"

  datastore {
    type           = "dynamodb"
    storage_engine = "rocksDB"
    version        = ""
  }

  flavor {
    num       = var.geminidb_node_num
    size      = var.geminidb_storage_size
    spec_code = var.geminidb_flavor
    storage   = "ULTRAHIGH"
  }
}
