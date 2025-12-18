variable "ydb_connection_string" {
  type = string
  default = ""
}

variable "registry_id" {
  type = string
  default = ""
}

variable "ssh_path" {
  type = string
  default = ""
}

variable "session_secret" {
  type = string
  default = ""
}

variable "cloud_id" {
  type = string
} 

variable "token" {
  type = string
} 

variable "folder_id" {
  type = string
}


 // провайдер
terraform {
  required_providers {
    yandex = {
      source = "yandex-cloud/yandex"
    }
  }
  required_version = ">= 0.13"
}

provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
  zone      = "ru-central1-a"
  token = var.token
}


// сети 
resource "yandex_vpc_network" "network" {
  name = "gyybd-network"
}

resource "yandex_vpc_subnet" "subnet-1" {
  name           = "gyybd-subnet-a"
  zone           = "ru-central1-a"
  network_id     = yandex_vpc_network.network.id
  v4_cidr_blocks = ["10.3.0.0/16"]
}

resource "yandex_vpc_subnet" "subnet-2" {
  name           = "gyybd-subnet-b"
  zone           = "ru-central1-b"
  network_id     = yandex_vpc_network.network.id
  v4_cidr_blocks = ["10.4.0.0/16"]
}

resource "yandex_vpc_subnet" "subnet-3" {
  name           = "gyybd-subnet-d"
  zone           = "ru-central1-d"
  network_id     = yandex_vpc_network.network.id
  v4_cidr_blocks = ["10.5.0.0/16"]
}

// группа вм


data "yandex_compute_image" "container-optimized-image" {
  family = "container-optimized-image"
}


resource "yandex_compute_instance_group" "project-group" {
  count = var.ydb_connection_string != "" ? 1 : 0

  depends_on = [
    yandex_resourcemanager_folder_iam_member.editor-role,
    yandex_vpc_subnet.subnet-1,
    yandex_vpc_subnet.subnet-2,
    yandex_vpc_subnet.subnet-3
  ]


  name               = "gyybd-project-vm-group"
  folder_id          = var.folder_id
  
  service_account_id = yandex_iam_service_account.sa-group.id

  instance_template {
    platform_id        = "standard-v3"
    
    service_account_id = yandex_iam_service_account.sa.id

    resources {
      memory        = 2 
      cores         = 2
      core_fraction = 20
    }

    boot_disk {
      mode = "READ_WRITE"
      initialize_params {
        type     =  "network-hdd"
        size     = 15 
        image_id = data.yandex_compute_image.container-optimized-image.id
      }
    }

    network_interface {
      network_id = yandex_vpc_network.network.id
      subnet_ids = [
        "${yandex_vpc_subnet.subnet-1.id}",
        "${yandex_vpc_subnet.subnet-2.id}",
        "${yandex_vpc_subnet.subnet-3.id}"
      ]
      nat = true 
    }

    metadata = {
    docker-container-declaration = <<-EOT
      spec:
        containers:
        - image: cr.yandex/${yandex_container_registry.container-registry.id}/gyybv-project-app:latest
          name: my-app
          env:
            - name: PORT
              value: "3000"
            - name: SESSION_SECRET
              value: ${var.session_secret}
            - name: YDB_ENDPOINT
              value: grpcs://${yandex_ydb_database_serverless.ydb.ydb_api_endpoint}    
            - name: YDB_DATABASE
              value: ${yandex_ydb_database_serverless.ydb.database_path}                         
            - name: STORAGE_URL
              value: "https://storage.yandexcloud.net/${yandex_storage_bucket.bucket.bucket}/static/"              
          restartPolicy: Always
    EOT

    ssh-keys = "ubuntu:${file(var.ssh_path)}"
  }
  }

  scale_policy {
    fixed_scale {
      size = 2
    }
  }

  allocation_policy {
    zones = ["ru-central1-a", "ru-central1-b", "ru-central1-d"]
  }

  deploy_policy {
    max_unavailable = 1
    max_expansion = 1
  }

  load_balancer {
    target_group_name = "gyybd-project-target-group"
  }

  health_check {
    interval            = 2
    timeout             = 1
    unhealthy_threshold = 2
    healthy_threshold   = 2
    http_options  {
      port = 3000
      path = "/"
    }
  }
}

resource "yandex_lb_network_load_balancer" "lb" {
  count = var.ydb_connection_string != "" ? 1 : 0
  name = "gyybd-project-network-lb"

  listener {
    name = "http-listener"
    port = 80            
    target_port = 3000   
    external_address_spec {
      ip_version = "ipv4"
    }
  }

  attached_target_group {
    target_group_id = yandex_compute_instance_group.project-group[0].load_balancer[0].target_group_id
    
    healthcheck {
      name = "http"
      http_options {
        port = 3000
        path = "/"
      }
    }
  }
}

// хранилище
resource "yandex_ydb_database_serverless" "ydb" {
    name = "gyybd-project-ydb"

    serverless_database {
        storage_size_limit = 1
        throttling_rcu_limit = 10
        enable_throttling_rcu_limit = true
    }
}


resource "yandex_storage_bucket" "bucket" {
  bucket = "gyybd-project-storage"
  max_size = 1073741824
  anonymous_access_flags{
    read = true
    list = true
    config_read = false
  }

  folder_id = var.folder_id
}

resource "yandex_container_registry" "container-registry" {
  name      = "gyybd-container-registry"
}


// сервисные аккаунты

resource "yandex_iam_service_account" "sa" {
  name = "gyybd-project-vm-manager"
}

resource "yandex_resourcemanager_folder_iam_member" "docker_puller_role" {
  role   = "container-registry.images.puller"
  folder_id = var.folder_id 

  member = "serviceAccount:${yandex_iam_service_account.sa.id}" 
}

resource "yandex_resourcemanager_folder_iam_member" "ydb_editor_role" {
  role   = "ydb.editor"
  folder_id = var.folder_id

  member = "serviceAccount:${yandex_iam_service_account.sa.id}" 
}

// сервисные аккаунты
resource "yandex_iam_service_account" "sa-group" {
  name = "gyybd-project-vm-group-manager"
}


resource "yandex_resourcemanager_folder_iam_member" "editor-role" {
  role   = "editor" // переделать на более точные роли
  folder_id = var.folder_id 

  member = "serviceAccount:${yandex_iam_service_account.sa-group.id}" 
}

output registry_id {
  value = yandex_container_registry.container-registry.id
}

output connection_string {
  value = yandex_ydb_database_serverless.ydb.ydb_full_endpoint
}

output db {
  value = yandex_ydb_database_serverless.ydb.database_path
}

output endpoint {
  value = yandex_ydb_database_serverless.ydb.ydb_api_endpoint
}
