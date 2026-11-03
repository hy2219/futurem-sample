locals {
  tier_subnets = {
    frontend  = "10.42.1.0/24"
    mcp       = "10.42.2.0/24"
    resources = "10.42.3.0/24"
  }

  backend_tiers = toset(["mcp", "resources"])
  environment_ids = {
    frontend  = azurerm_container_app_environment.workshop.id
    mcp       = azurerm_container_app_environment.backend["mcp"].id
    resources = azurerm_container_app_environment.backend["resources"].id
  }

  tier_rules = {
    frontend = {
      deny_frontend_resources = {
        priority                   = 100
        direction                  = "Outbound"
        access                     = "Deny"
        protocol                   = "*"
        source_address_prefix      = "*"
        destination_address_prefix = local.tier_subnets.resources
        destination_port_ranges    = ["0-65535"]
      }
    }
    mcp = {
      allow_frontend_mcp = {
        priority                   = 100
        direction                  = "Inbound"
        access                     = "Allow"
        protocol                   = "Tcp"
        source_address_prefix      = local.tier_subnets.frontend
        destination_address_prefix = local.tier_subnets.mcp
        destination_port_ranges    = ["443", "31443"]
      }
    }
    resources = {
      allow_mcp_resources = {
        priority                   = 100
        direction                  = "Inbound"
        access                     = "Allow"
        protocol                   = "Tcp"
        source_address_prefix      = local.tier_subnets.mcp
        destination_address_prefix = local.tier_subnets.resources
        # ACA allocates TCP nodeports dynamically behind the private load balancer.
        destination_port_ranges = ["443", "5432", "5433", "30000-32767"]
      }
    }
  }

  nsg_rules = {
    for tier, cidr in local.tier_subnets : tier => merge(local.tier_rules[tier], {
      allow_same_subnet = {
        priority                   = 200
        direction                  = "Inbound"
        access                     = "Allow"
        protocol                   = "*"
        source_address_prefix      = cidr
        destination_address_prefix = cidr
        destination_port_ranges    = ["0-65535"]
      }
      allow_load_balancer = {
        priority                   = 210
        direction                  = "Inbound"
        access                     = "Allow"
        protocol                   = "Tcp"
        source_address_prefix      = "AzureLoadBalancer"
        destination_address_prefix = cidr
        destination_port_ranges    = ["30000-32767"]
      }
      deny_other_inbound = {
        priority                   = 300
        direction                  = "Inbound"
        access                     = "Deny"
        protocol                   = "*"
        source_address_prefix      = "*"
        destination_address_prefix = cidr
        destination_port_ranges    = ["0-65535"]
      }
    })
  }
}

resource "azurerm_virtual_network" "workshop" {
  name                = "${var.resource_prefix}-vnet"
  address_space       = ["10.42.0.0/16"]
  location            = var.location
  resource_group_name = data.azurerm_resource_group.workshop.name
  tags                = local.tags
}

resource "azurerm_subnet" "tier" {
  for_each             = local.tier_subnets
  name                 = each.key
  resource_group_name  = data.azurerm_resource_group.workshop.name
  virtual_network_name = azurerm_virtual_network.workshop.name
  address_prefixes     = [each.value]

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_network_security_group" "tier" {
  for_each            = local.tier_subnets
  name                = "${var.resource_prefix}-${each.key}-nsg"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.workshop.name
  tags                = local.tags

  dynamic "security_rule" {
    for_each = local.nsg_rules[each.key]
    content {
      name                       = security_rule.key
      priority                   = security_rule.value.priority
      direction                  = security_rule.value.direction
      access                     = security_rule.value.access
      protocol                   = security_rule.value.protocol
      source_port_range          = "*"
      destination_port_ranges    = security_rule.value.destination_port_ranges
      source_address_prefix      = security_rule.value.source_address_prefix
      destination_address_prefix = security_rule.value.destination_address_prefix
    }
  }
}

resource "azurerm_subnet_network_security_group_association" "tier" {
  for_each                  = local.tier_subnets
  subnet_id                 = azurerm_subnet.tier[each.key].id
  network_security_group_id = azurerm_network_security_group.tier[each.key].id
}

resource "azurerm_container_app_environment" "backend" {
  for_each                       = local.backend_tiers
  name                           = "${var.resource_prefix}-${each.key}-environment"
  resource_group_name            = data.azurerm_resource_group.workshop.name
  location                       = var.location
  logs_destination               = "log-analytics"
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.workshop.id
  infrastructure_subnet_id       = azurerm_subnet.tier[each.key].id
  internal_load_balancer_enabled = true
  tags                           = local.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  depends_on = [azurerm_subnet_network_security_group_association.tier]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_private_dns_zone" "backend" {
  for_each            = azurerm_container_app_environment.backend
  name                = each.value.default_domain
  resource_group_name = data.azurerm_resource_group.workshop.name
  tags                = local.tags
}

resource "azurerm_private_dns_a_record" "backend" {
  for_each            = azurerm_container_app_environment.backend
  name                = "*"
  zone_name           = azurerm_private_dns_zone.backend[each.key].name
  resource_group_name = data.azurerm_resource_group.workshop.name
  ttl                 = 60
  records             = [each.value.static_ip_address]
}

resource "azurerm_private_dns_zone_virtual_network_link" "backend" {
  for_each              = local.backend_tiers
  name                  = "${var.resource_prefix}-${each.key}-dns"
  resource_group_name   = data.azurerm_resource_group.workshop.name
  private_dns_zone_name = azurerm_private_dns_zone.backend[each.key].name
  virtual_network_id    = azurerm_virtual_network.workshop.id
  registration_enabled  = false
  tags                  = local.tags
}
