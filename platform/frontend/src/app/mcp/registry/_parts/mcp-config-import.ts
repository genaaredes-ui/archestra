import type { McpCatalogFormValues } from "./mcp-catalog-form.types";

type JsonRecord = Record<string, unknown>;

type ImportedEnvironmentVariable = NonNullable<
  NonNullable<McpCatalogFormValues["localConfig"]>["environment"]
>[number];

type ImportedHeader = NonNullable<
  McpCatalogFormValues["additionalHeaders"]
>[number];

export interface McpConfigImportCandidate {
  id: string;
  label: string;
  values: McpCatalogFormValues;
}

export type McpConfigImportResult =
  | { candidates: McpConfigImportCandidate[] }
  | { error: string };

interface InputDefinition {
  description?: string;
  sensitive?: boolean;
}

const PLACEHOLDER_PATTERN = /\$\{input:([^}]+)\}/;
const SENSITIVE_NAME_PATTERN = /(key|token|secret|password|credential|auth)/i;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function jsonValue(value: unknown): string | undefined {
  const primitive = stringValue(value);
  if (primitive !== undefined) return primitive;
  if (value === null || value === undefined) return undefined;
  return JSON.stringify(value);
}

function isPlaceholder(value: string | undefined): string | undefined {
  return value?.match(PLACEHOLDER_PATTERN)?.[1];
}

function inputDefinitions(value: unknown): Map<string, InputDefinition> {
  const definitions = new Map<string, InputDefinition>();

  if (Array.isArray(value)) {
    for (const input of value) {
      if (!isRecord(input)) continue;
      const id = stringValue(input.id);
      if (!id) continue;
      definitions.set(id, {
        description: stringValue(input.description) || stringValue(input.title),
        sensitive: input.password === true || input.sensitive === true,
      });
    }
  } else if (isRecord(value)) {
    for (const [id, input] of Object.entries(value)) {
      if (!isRecord(input)) continue;
      definitions.set(id, {
        description: stringValue(input.description) || stringValue(input.title),
        sensitive: input.password === true || input.sensitive === true,
      });
    }
  }

  return definitions;
}

function environmentType(
  value: unknown,
  key: string,
): ImportedEnvironmentVariable["type"] {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (SENSITIVE_NAME_PATTERN.test(key)) return "secret";
  return "plain_text";
}

type EnvironmentEntry = [string, unknown, JsonRecord?];

function environmentEntries(value: unknown): EnvironmentEntry[] {
  if (isRecord(value)) {
    return Object.entries(value).map(([key, entry]) => [key, entry]);
  }

  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): EnvironmentEntry[] => {
    if (typeof entry === "string") {
      const separator = entry.indexOf("=");
      if (separator <= 0) return [];
      return [[entry.slice(0, separator), entry.slice(separator + 1)]];
    }
    if (!isRecord(entry)) return [];
    const key = stringValue(entry.key) || stringValue(entry.name);
    if (!key) return [];
    return [[key, "value" in entry ? entry.value : entry.default, entry]];
  });
}

function toEnvironment(
  value: unknown,
  inputs: Map<string, InputDefinition>,
): ImportedEnvironmentVariable[] {
  return environmentEntries(value).map(([key, rawValue, metadata]) => {
    const valueText = jsonValue(rawValue);
    const inputId = isPlaceholder(valueText);
    const input = inputId ? inputs.get(inputId) : undefined;
    const shouldPrompt =
      Boolean(inputId) ||
      metadata?.isRequired === true ||
      metadata?.required === true;
    const sensitive =
      input?.sensitive === true ||
      metadata?.isSecret === true ||
      metadata?.sensitive === true ||
      SENSITIVE_NAME_PATTERN.test(key);
    const format = stringValue(metadata?.format)?.toLowerCase();
    const type = sensitive
      ? "secret"
      : format === "number" || format === "boolean"
        ? format
        : environmentType(rawValue, key);

    return {
      key,
      type,
      value: shouldPrompt ? undefined : valueText,
      promptOnInstallation: shouldPrompt,
      required: shouldPrompt,
      description: input?.description || stringValue(metadata?.description),
    };
  });
}

function validHeaderName(value: string): string {
  const normalized = value
    .trim()
    .replace(/_/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "X-MCP-Header";
}

function fieldName(value: string, index: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `header_${normalized || "value"}_${index + 1}`;
}

function headerEntries(value: unknown): Array<[string, unknown]> {
  if (!isRecord(value)) return [];
  return Object.entries(value);
}

function officialConnectionConfig(config: JsonRecord): JsonRecord {
  const server = isRecord(config.server) ? config.server : config;
  const inherited = {
    name: stringValue(server.name) || stringValue(config.name),
    description:
      stringValue(server.description) || stringValue(config.description),
  };

  if (Array.isArray(server.remotes)) {
    const remote = server.remotes.find(
      (entry): entry is JsonRecord => isRecord(entry) && Boolean(entry.url),
    );
    if (remote) {
      return {
        ...server,
        ...inherited,
        ...remote,
        transportType:
          stringValue(remote.transportType) || stringValue(remote.type),
        headers: remote.headers || server.headers,
      };
    }
  }

  if (Array.isArray(server.packages)) {
    const serverPackage = server.packages.find(isRecord);
    if (serverPackage) {
      const transport = isRecord(serverPackage.transport)
        ? serverPackage.transport
        : {};
      const registryType =
        stringValue(serverPackage.registryType) ||
        stringValue(serverPackage.registry_type) ||
        "";
      const identifier =
        stringValue(serverPackage.identifier) ||
        stringValue(serverPackage.name) ||
        stringValue(serverPackage.package);
      const version = stringValue(serverPackage.version);
      const packageArgs = argumentList(serverPackage.args);
      let command = stringValue(serverPackage.command);
      let args = packageArgs;

      if (!command && identifier && registryType.toLowerCase() === "npm") {
        command = "npx";
        args = [
          "-y",
          version ? `${identifier}@${version}` : identifier,
          ...args,
        ];
      } else if (
        !command &&
        identifier &&
        registryType.toLowerCase() === "pypi"
      ) {
        command = "uvx";
        args = [version ? `${identifier}==${version}` : identifier, ...args];
      }

      return {
        ...server,
        ...inherited,
        ...serverPackage,
        command,
        args,
        transportType:
          stringValue(serverPackage.transportType) ||
          stringValue(transport.type),
        env:
          serverPackage.env ||
          serverPackage.environment ||
          serverPackage.environmentVariables ||
          serverPackage.environment_variables ||
          server.environmentVariables ||
          server.environment_variables,
      };
    }
  }

  return server;
}

function toHeaders(
  value: unknown,
  inputs: Map<string, InputDefinition>,
): ImportedHeader[] {
  return headerEntries(value).map(([rawName, rawValue], index) => {
    const headerName = validHeaderName(rawName);
    const valueText = jsonValue(
      isRecord(rawValue) && "value" in rawValue ? rawValue.value : rawValue,
    );
    const inputId = isPlaceholder(valueText);
    const input = inputId ? inputs.get(inputId) : undefined;
    const shouldPrompt = Boolean(inputId);
    const bearer = valueText?.match(/^Bearer\s+/i) !== null;
    const cleanValue = bearer
      ? valueText?.replace(/^Bearer\s+/i, "")
      : valueText;

    return {
      fieldName: fieldName(headerName, index),
      headerName,
      promptOnInstallation: shouldPrompt,
      required: shouldPrompt,
      value: shouldPrompt ? undefined : cleanValue,
      description: input?.description,
      includeBearerPrefix: bearer,
      sensitive:
        input?.sensitive === true || SENSITIVE_NAME_PATTERN.test(rawName),
    };
  });
}

function defaultOAuthConfig(): NonNullable<
  McpCatalogFormValues["oauthConfig"]
> {
  const redirectOrigin =
    typeof window === "undefined" ? "" : window.location.origin;
  return {
    client_id: "",
    client_secret: "",
    audience: "",
    resource: "",
    redirect_uris: redirectOrigin ? `${redirectOrigin}/oauth-callback` : "",
    scopes: "read, write",
    additional_scopes: "offline_access",
    supports_resource_metadata: true,
    grantType: "authorization_code",
    authServerUrl: "",
    authorizationEndpoint: "",
    wellKnownUrl: "",
    resourceMetadataUrl: "",
    tokenEndpoint: "",
  };
}

function baseValues(
  name: string,
  serverType: "local" | "remote",
): McpCatalogFormValues {
  return {
    name: name.trim() || "Imported MCP server",
    description: "",
    icon: null,
    serverType,
    multitenant: false,
    serverUrl: "",
    authMethod: "none",
    includeBearerPrefix: true,
    authHeaderName: "",
    additionalHeaders: [],
    enterpriseManagedConfig: null,
    oauthConfig: defaultOAuthConfig(),
    scope: "personal",
    teams: [],
    environmentId: null,
  };
}

function argumentList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => jsonValue(item))
      .filter((item): item is string => Boolean(item));
  }
  const text = stringValue(value);
  if (!text) return [];
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function candidateFromConfig(
  requestedName: string,
  config: JsonRecord,
  inputs: Map<string, InputDefinition>,
): McpConfigImportCandidate {
  config = officialConnectionConfig(config);
  const url =
    stringValue(config.url) ||
    stringValue(config.serverUrl) ||
    stringValue(config.server_url);
  const command = stringValue(config.command);
  const dockerImage =
    stringValue(config.dockerImage) || stringValue(config.docker_image);
  const transport =
    stringValue(config.transportType) || stringValue(config.transport);
  const configType = stringValue(config.type)?.toLowerCase();
  const isRemote =
    Boolean(url) ||
    ["http", "sse", "streamable-http", "remote"].includes(configType || "");

  if (isRemote && !url) {
    throw new Error(`Configuration "${requestedName}" has no valid URL.`);
  }
  if (!isRemote && !command && !dockerImage) {
    throw new Error(
      `Configuration "${requestedName}" has no command, args, or dockerImage.`,
    );
  }

  const values = baseValues(
    stringValue(config.name) || stringValue(config.label) || requestedName,
    isRemote ? "remote" : "local",
  );
  values.description = stringValue(config.description) || "";

  if (isRemote) {
    values.serverUrl = url || "";
    values.additionalHeaders = toHeaders(
      config.headers || config.httpHeaders,
      inputs,
    );
  } else {
    values.localConfig = {
      command: command || "",
      arguments: argumentList(config.args ?? config.arguments).join("\n"),
      environment: toEnvironment(config.env ?? config.environment, inputs),
      envFrom: [],
      dockerImage: dockerImage || "",
      transportType:
        transport === "streamable-http" || configType === "streamable-http"
          ? "streamable-http"
          : "stdio",
      httpPort: stringValue(config.httpPort) || "",
      httpPath: stringValue(config.httpPath) || "/mcp",
      serviceAccount: "",
      imagePullSecrets: [],
    };
  }

  return {
    id: requestedName,
    label: values.name,
    values,
  };
}

export function parseMcpConfig(text: string): McpConfigImportResult {
  if (!text.trim()) return { candidates: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The content is not valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { error: "The configuration must be a JSON object." };
  }

  const inputs = inputDefinitions(parsed.inputs);
  const source =
    (isRecord(parsed.mcpServers) && parsed.mcpServers) ||
    (isRecord(parsed.servers) && parsed.servers);
  const entries = source
    ? Object.entries(source)
    : [
        [
          stringValue(parsed.name) || stringValue(parsed.label) || "imported",
          parsed,
        ] as [string, unknown],
      ];

  if (entries.length === 0) {
    return { error: "No servers were found in the configuration." };
  }

  try {
    return {
      candidates: entries.map(([name, config]) => {
        if (!isRecord(config)) {
          throw new Error(`Configuration "${name}" must be an object.`);
        }
        return candidateFromConfig(name, config, inputs);
      }),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unsupported configuration.",
    };
  }
}
