import { describe, expect, it } from "vitest";
import { parseMcpConfig } from "./mcp-config-import";

describe("parseMcpConfig", () => {
  it("imports the common mcpServers stdio format", () => {
    const result = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: `\${input:github_token}` },
          },
        },
        inputs: [
          {
            id: "github_token",
            description: "GitHub token",
            password: true,
          },
        ],
      }),
    );

    expect(result).toMatchObject({ candidates: [{ label: "github" }] });
    if (!("candidates" in result)) return;
    const values = result.candidates[0]?.values;
    expect(values?.serverType).toBe("local");
    expect(values?.localConfig?.arguments).toBe(
      "-y\n@modelcontextprotocol/server-github",
    );
    expect(values?.localConfig?.environment).toEqual([
      expect.objectContaining({
        key: "GITHUB_TOKEN",
        type: "secret",
        promptOnInstallation: true,
        required: true,
      }),
    ]);
  });

  it("imports official servers JSON with remote headers", () => {
    const result = parseMcpConfig(
      JSON.stringify({
        servers: {
          linear: {
            type: "http",
            url: "https://mcp.example.com",
            headers: { Authorization: `Bearer \${input:linear_token}` },
          },
        },
        inputs: {
          linear_token: { title: "Linear token", password: true },
        },
      }),
    );

    expect(result).toMatchObject({ candidates: [{ label: "linear" }] });
    if (!("candidates" in result)) return;
    const values = result.candidates[0]?.values;
    expect(values?.serverType).toBe("remote");
    expect(values?.serverUrl).toBe("https://mcp.example.com");
    expect(values?.additionalHeaders).toEqual([
      expect.objectContaining({
        headerName: "Authorization",
        includeBearerPrefix: true,
        promptOnInstallation: true,
        required: true,
      }),
    ]);
  });

  it("supports a single direct server configuration", () => {
    const result = parseMcpConfig(
      JSON.stringify({
        name: "Local server",
        command: "node",
        args: ["server.js"],
        env: { PORT: 3000, DEBUG: true },
      }),
    );

    expect(result).toMatchObject({ candidates: [{ label: "Local server" }] });
    if (!("candidates" in result)) return;
    expect(result.candidates[0]?.values.localConfig?.environment).toEqual([
      expect.objectContaining({ key: "PORT", type: "number", value: "3000" }),
      expect.objectContaining({ key: "DEBUG", type: "boolean", value: "true" }),
    ]);
  });

  it("returns a useful error for invalid JSON", () => {
    expect(parseMcpConfig("{not-json")).toEqual({
      error: "The content is not valid JSON.",
    });
  });

  it("imports an official registry remote server wrapper", () => {
    const result = parseMcpConfig(
      JSON.stringify({
        server: {
          name: "io.example/docs",
          description: "Documentation server",
          remotes: [
            {
              type: "streamable-http",
              url: "https://example.com/mcp",
            },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      candidates: [
        {
          label: "io.example/docs",
          values: {
            serverType: "remote",
            serverUrl: "https://example.com/mcp",
          },
        },
      ],
    });
  });

  it("turns an official npm package into a local command", () => {
    const result = parseMcpConfig(
      JSON.stringify({
        server: {
          name: "io.example/github",
          packages: [
            {
              registryType: "npm",
              identifier: "@example/github-mcp",
              version: "1.2.3",
              transport: { type: "stdio" },
              environmentVariables: [
                {
                  name: "API_TOKEN",
                  description: "API token",
                  isRequired: true,
                  isSecret: true,
                },
              ],
            },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      candidates: [{ label: "io.example/github" }],
    });
    if (!("candidates" in result)) return;
    const values = result.candidates[0]?.values;
    expect(values?.localConfig?.command).toBe("npx");
    expect(values?.localConfig?.arguments).toBe(
      "-y\n@example/github-mcp@1.2.3",
    );
    expect(values?.localConfig?.environment).toEqual([
      expect.objectContaining({
        key: "API_TOKEN",
        promptOnInstallation: true,
        required: true,
        type: "secret",
      }),
    ]);
  });
});
