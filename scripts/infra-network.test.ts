import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("Terraform separates frontend, MCP and resources with private cross-environment routes", () => {
  assert.ok(existsSync("infra/network.tf"), "Missing network isolation Terraform");
  const network = readFileSync("infra/network.tf", "utf8");
  const main = readFileSync("infra/main.tf", "utf8");
  assert.match(network, /frontend\s*=\s*"10\.42\.1\.0\/24"/);
  assert.match(network, /mcp\s*=\s*"10\.42\.2\.0\/24"/);
  assert.match(network, /resources\s*=\s*"10\.42\.3\.0\/24"/);
  assert.match(network, /Microsoft\.App\/environments/);
  assert.match(network, /azurerm_subnet_network_security_group_association/);
  assert.match(network, /resource "azurerm_container_app_environment" "backend"/);
  assert.match(network, /internal_load_balancer_enabled\s*=\s*true/);
  assert.match(network, /infrastructure_subnet_id\s*=\s*azurerm_subnet\.tier\[each\.key\]\.id/);
  assert.match(network, /resource "azurerm_private_dns_zone" "backend"/);
  assert.match(network, /records\s*=\s*\[each\.value\.static_ip_address\]/);
  assert.match(network, /registration_enabled\s*=\s*false/);
  assert.match(main, /MCP_URL\s*=\s*"https:\/\/runtime\.\$\{azurerm_container_app_environment\.backend\["mcp"\]\.default_domain\}\/mcp"/);
  assert.match(main, /API_1_URL\s*=\s*"https:\/\/api-1\./);
  assert.match(main, /db-1-url\s*=\s*"postgresql:.*backend\["resources"\]\.default_domain/);
  assert.match(main, /container_app_environment_id\s*=\s*azurerm_container_app_environment\.backend\["resources"\]\.id/);
  assert.match(main, /local\.environment_ids\[each\.value\.tier\]/);
  assert.match(main, /external_enabled\s*=\s*each\.key != "sso"/);
  assert.match(main, /prevent_destroy\s*=\s*true/);
});

test("Azure augmented security rules never contain overlapping destination port ranges", () => {
  const network = readFileSync("infra/network.tf", "utf8");
  for (const match of network.matchAll(/destination_port_ranges\s*=\s*\[([^\]]+)\]/g)) {
    const ranges = [...match[1].matchAll(/"(\d+)(?:-(\d+))?"/g)].map(range =>
      [Number(range[1]), Number(range[2] ?? range[1])] as const);
    for (let a = 0; a < ranges.length; a++) {
      for (let b = a + 1; b < ranges.length; b++) {
        assert.ok(ranges[a][1] < ranges[b][0] || ranges[b][1] < ranges[a][0],
          `Overlapping NSG ranges ${ranges[a]} and ${ranges[b]}`);
      }
    }
  }
});

test("network policy denies frontend bypass and permits backend only from its preceding tier", () => {
  assert.ok(existsSync("infra/network.tf"), "Missing network isolation Terraform");
  const network = readFileSync("infra/network.tf", "utf8");
  assert.match(network, /deny_frontend_resources\s*=\s*\{[^}]*priority\s*=\s*100[^}]*direction\s*=\s*"Outbound"[^}]*access\s*=\s*"Deny"[^}]*destination_address_prefix\s*=\s*local\.tier_subnets\.resources/);
  assert.match(network, /allow_frontend_mcp\s*=\s*\{[^}]*source_address_prefix\s*=\s*local\.tier_subnets\.frontend[^}]*destination_port_ranges\s*=\s*\["443", "31443"\]/);
  assert.match(network, /allow_mcp_resources\s*=\s*\{[^}]*source_address_prefix\s*=\s*local\.tier_subnets\.mcp[^}]*destination_port_ranges\s*=\s*\["443", "5432", "5433", "30000-32767"\]/);
  assert.match(network, /source_address_prefix\s*=\s*"AzureLoadBalancer"/);
  assert.match(network, /deny_other_inbound[\s\S]*priority\s*=\s*300[\s\S]*access\s*=\s*"Deny"/);
  assert.match(network, /source_address_prefix\s*=\s*cidr/);
});
