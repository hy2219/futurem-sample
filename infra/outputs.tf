output "acr_name" {
  description = "Registry resource name, safe for az acr login."
  value       = azurerm_container_registry.workshop.name
}

output "acr_login_server" {
  description = "Registry host used for immutable image tags."
  value       = azurerm_container_registry.workshop.login_server
}

output "app_url" {
  description = "Public HTTPS URL only when both container deployment and the health-only app shell are enabled."
  value       = var.enable_apps && var.enable_business_app ? "https://${azurerm_container_app.service["app"].ingress[0].fqdn}" : null
}

output "environment_name" {
  description = "Public frontend environment name for diagnostics."
  value       = azurerm_container_app_environment.workshop.name
}

output "backend_environment_names" {
  description = "Private MCP and resource environments."
  value       = { for tier, environment in azurerm_container_app_environment.backend : tier => environment.name }
}
