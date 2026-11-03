variable "subscription_id" {
  description = "Local operator's deployment subscription, pinned by the private deployment variables."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.subscription_id))
    error_message = "Provide the pinned subscription UUID."
  }
}

variable "tenant_id" {
  description = "Local operator's tenant, pinned by the private deployment variables."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.tenant_id))
    error_message = "Provide the pinned tenant UUID."
  }
}

variable "resource_group_name" {
  description = "Existing, dedicated workshop resource group, created by the operator."
  type        = string

  validation {
    condition     = length(trimspace(var.resource_group_name)) > 0
    error_message = "Provide the name of the operator-created resource group."
  }
}

variable "resource_prefix" {
  description = "Unique prefix for this repository copy's Azure resources."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,17}$", var.resource_prefix))
    error_message = "Use 3-18 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "location" {
  description = "Azure region; choose one supporting Container Apps Consumption."
  type        = string
  default     = "koreacentral"
}

variable "enable_apps" {
  description = "Controls all containers; false for initial infrastructure bootstrap before images exist."
  type        = bool
  default     = false
}

variable "enable_business_app" {
  description = "Opt in to the public health-only app shell; false deploys only six prepared mocks."
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "Immutable source commit SHA shared by external-resources, mock-sso, api-1, api-2, db-1, db-2 and optional business-app images."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.image_tag))
    error_message = "Use the full, lowercase, 40-character Git commit SHA."
  }
}

variable "deployment_principal_object_id" {
  description = "Object ID of the operator-created OIDC deployment service principal (not its client ID)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.deployment_principal_object_id))
    error_message = "Provide the Entra service principal object ID."
  }
}

variable "app_client_id" {
  description = "Unique client identity for this copy, shared by runtime, independent APIs and mock SSO."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{8,120}$", var.app_client_id))
    error_message = "Use a unique client ID with 8-120 letters, digits, underscores or hyphens."
  }
}

variable "app_client_secret" {
  description = "App-to-runtime Basic authentication secret; never supplied to SSO."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.app_client_secret) >= 32
    error_message = "Use at least 32 characters of cryptographically generated secret."
  }
}

variable "resource_token_key" {
  description = "Demo HMAC key shared by runtime (signing) and the independent APIs (token validation only)."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.resource_token_key) >= 32
    error_message = "Use at least 32 characters of cryptographically generated secret."
  }
}

variable "sso_session_key" {
  description = "Mock SSO demo session signing key; the health-only app shell does not use it."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.sso_session_key) >= 32
    error_message = "Use at least 32 characters of cryptographically generated secret."
  }
}

variable "postgres_password" {
  description = "Shared initialization administrator password for both independent PostgreSQL containers; not available to runtime."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.postgres_password) >= 32
    error_message = "Use at least 32 characters of cryptographically generated secret."
  }
}

variable "pg_reader_password" {
  description = "Shared hex password for each database's demo_reader role, safe to embed in DB_1_URL and DB_2_URL."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9a-f]{32,128}$", var.pg_reader_password))
    error_message = "Use 32-128 lowercase hexadecimal characters."
  }
}
