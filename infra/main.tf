data "azurerm_resource_group" "workshop" {
  name = var.resource_group_name
}

locals {
  tags = {
    purpose    = "synthetic-sdlc-workshop"
    repository = var.resource_prefix
  }
  acr_name = "${replace(var.resource_prefix, "-", "")}acr${substr(sha256(data.azurerm_resource_group.workshop.id), 0, 6)}"

  databases = {
    db_1 = {
      name             = "db-1"
      image_repository = "db-1"
      exposed_port     = 5432
    }
    db_2 = {
      name             = "db-2"
      image_repository = "db-2"
      exposed_port     = 5433
    }
  }

  services = {
    app = {
      tier             = "frontend"
      image_repository = "business-app"
      min_replicas     = 0
      ready_path       = "/health"
      values = {
        PORT          = "8080"
        MCP_URL       = "https://runtime.${azurerm_container_app_environment.backend["mcp"].default_domain}/mcp"
        SSO_URL       = "http://sso"
        APP_CLIENT_ID = var.app_client_id
      }
      secret_refs = {
        APP_CLIENT_SECRET = "app-client-secret"
        SSO_SESSION_KEY   = "sso-session-key"
      }
    }
    runtime = {
      tier             = "mcp"
      image_repository = "external-resources"
      min_replicas     = 1
      ready_path       = "/ready"
      values = {
        PORT          = "8080"
        APP_CLIENT_ID = var.app_client_id
        API_1_URL     = "https://api-1.${azurerm_container_app_environment.backend["resources"].default_domain}"
        API_2_URL     = "https://api-2.${azurerm_container_app_environment.backend["resources"].default_domain}"
      }
      secret_refs = {
        APP_CLIENT_SECRET  = "app-client-secret"
        RESOURCE_TOKEN_KEY = "resource-token-key"
        DB_1_URL           = "db-1-url"
        DB_2_URL           = "db-2-url"
      }
    }
    sso = {
      tier             = "frontend"
      image_repository = "mock-sso"
      min_replicas     = 1
      ready_path       = "/health"
      values = {
        PORT          = "8080"
        APP_CLIENT_ID = var.app_client_id
      }
      secret_refs = {
        SSO_SESSION_KEY = "sso-session-key"
      }
    }
    api_1 = {
      tier             = "resources"
      image_repository = "api-1"
      min_replicas     = 1
      ready_path       = "/health"
      values = {
        PORT          = "8080"
        APP_CLIENT_ID = var.app_client_id
      }
      secret_refs = {
        RESOURCE_TOKEN_KEY = "resource-token-key"
      }
    }
    api_2 = {
      tier             = "resources"
      image_repository = "api-2"
      min_replicas     = 1
      ready_path       = "/health"
      values = {
        PORT          = "8080"
        APP_CLIENT_ID = var.app_client_id
      }
      secret_refs = {
        RESOURCE_TOKEN_KEY = "resource-token-key"
      }
    }
  }

  secret_values = {
    app-client-secret  = var.app_client_secret
    resource-token-key = var.resource_token_key
    sso-session-key    = var.sso_session_key
    db-1-url           = "postgresql://demo_reader:${var.pg_reader_password}@${local.databases.db_1.name}.${azurerm_container_app_environment.backend["resources"].default_domain}:${local.databases.db_1.exposed_port}/workshop"
    db-2-url           = "postgresql://demo_reader:${var.pg_reader_password}@${local.databases.db_2.name}.${azurerm_container_app_environment.backend["resources"].default_domain}:${local.databases.db_2.exposed_port}/workshop"
  }
}

resource "azurerm_container_registry" "workshop" {
  name                = local.acr_name
  resource_group_name = data.azurerm_resource_group.workshop.name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_user_assigned_identity" "image_pull" {
  name                = "${var.resource_prefix}-image-pull"
  resource_group_name = data.azurerm_resource_group.workshop.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "image_pull" {
  scope                            = azurerm_container_registry.workshop.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.image_pull.principal_id
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "image_push" {
  scope                            = azurerm_container_registry.workshop.id
  role_definition_name             = "AcrPush"
  principal_id                     = var.deployment_principal_object_id
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "image_read" {
  scope                = azurerm_container_registry.workshop.id
  role_definition_name = "Reader"
  principal_id         = var.deployment_principal_object_id
}

resource "azurerm_log_analytics_workspace" "workshop" {
  name                = "${var.resource_prefix}-logs"
  resource_group_name = data.azurerm_resource_group.workshop.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_app_environment" "workshop" {
  name                       = "${var.resource_prefix}-environment"
  resource_group_name        = data.azurerm_resource_group.workshop.name
  location                   = var.location
  logs_destination           = "log-analytics"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.workshop.id
  tags                       = local.tags
  infrastructure_subnet_id   = azurerm_subnet.tier["frontend"].id

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  depends_on = [azurerm_subnet_network_security_group_association.tier]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_container_app" "database" {
  for_each                     = var.enable_apps ? local.databases : {}
  name                         = each.value.name
  container_app_environment_id = azurerm_container_app_environment.backend["resources"].id
  resource_group_name          = data.azurerm_resource_group.workshop.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.image_pull.id]
  }

  registry {
    server   = azurerm_container_registry.workshop.login_server
    identity = azurerm_user_assigned_identity.image_pull.id
  }

  secret {
    name  = "postgres-password"
    value = var.postgres_password
  }

  secret {
    name  = "pg-reader-password"
    value = var.pg_reader_password
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = each.value.name
      image  = "${azurerm_container_registry.workshop.login_server}/${each.value.image_repository}:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "POSTGRES_DB"
        value = "workshop"
      }

      env {
        name  = "POSTGRES_USER"
        value = "postgres"
      }

      env {
        name        = "POSTGRES_PASSWORD"
        secret_name = "postgres-password"
      }

      env {
        name        = "PG_READER_PASSWORD"
        secret_name = "pg-reader-password"
      }

      startup_probe {
        transport               = "TCP"
        port                    = 5432
        interval_seconds        = 5
        failure_count_threshold = 60
        timeout                 = 2
      }

      liveness_probe {
        transport        = "TCP"
        port             = 5432
        interval_seconds = 15
        timeout          = 2
      }

      readiness_probe {
        transport               = "TCP"
        port                    = 5432
        interval_seconds        = 5
        success_count_threshold = 1
        timeout                 = 2
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 5432
    exposed_port     = each.value.exposed_port
    transport        = "tcp"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [
    azurerm_role_assignment.image_pull,
    azurerm_private_dns_a_record.backend,
    azurerm_private_dns_zone_virtual_network_link.backend,
  ]

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

resource "azurerm_container_app" "service" {
  for_each = var.enable_apps ? {
    for name, service in local.services : name => service
    if name != "app" || var.enable_business_app
  } : {}
  name                         = replace(each.key, "_", "-")
  container_app_environment_id = local.environment_ids[each.value.tier]
  resource_group_name          = data.azurerm_resource_group.workshop.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.image_pull.id]
  }

  registry {
    server   = azurerm_container_registry.workshop.login_server
    identity = azurerm_user_assigned_identity.image_pull.id
  }

  dynamic "secret" {
    for_each = toset(values(each.value.secret_refs))
    content {
      name  = secret.value
      value = local.secret_values[secret.value]
    }
  }

  template {
    min_replicas = each.value.min_replicas
    max_replicas = 1

    container {
      name   = replace(each.key, "_", "-")
      image  = "${azurerm_container_registry.workshop.login_server}/${each.value.image_repository}:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      dynamic "env" {
        for_each = each.value.values
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = each.value.secret_refs
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/health"
        interval_seconds        = 5
        failure_count_threshold = 60
        timeout                 = 2
      }

      liveness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = "/health"
        interval_seconds = 15
        timeout          = 2
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = each.value.ready_path
        interval_seconds        = 5
        failure_count_threshold = 6
        success_count_threshold = 1
        timeout                 = 3
      }
    }
  }

  ingress {
    external_enabled           = each.key != "sso"
    allow_insecure_connections = each.key == "sso"
    target_port                = 8080
    transport                  = "http"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [azurerm_container_app.database, azurerm_role_assignment.image_pull]

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}
