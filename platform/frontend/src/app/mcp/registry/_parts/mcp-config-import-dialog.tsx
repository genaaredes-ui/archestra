"use client";

import { AlertCircle, FileJson } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { McpCatalogFormValues } from "./mcp-catalog-form.types";
import {
  parseMcpConfig,
  type McpConfigImportCandidate,
} from "./mcp-config-import";

interface McpConfigImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (values: McpCatalogFormValues) => void;
}

const EXAMPLE_CONFIG = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": { "API_KEY": "${"${input:api_key}"}" }
    }
  },
  "inputs": [
    { "id": "api_key", "description": "API key", "password": true }
  ]
}`;

export function McpConfigImportDialog({
  open,
  onOpenChange,
  onImport,
}: McpConfigImportDialogProps) {
  const [text, setText] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const parsed = useMemo(() => parseMcpConfig(text), [text]);
  const candidates = "candidates" in parsed ? parsed.candidates : [];
  const selected = candidates.find((candidate) => candidate.id === selectedId);

  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedId("");
      return;
    }
    if (!candidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(candidates[0]?.id ?? "");
    }
  }, [candidates, selectedId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    onImport(selected.values);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Import MCP configuration
          </DialogTitle>
          <DialogDescription>
            Paste a JSON configuration from a client or catalog. Supports
            mcpServers, servers, official registry packages/remotes, local
            command/args/env, and remote URL/headers formats.
          </DialogDescription>
        </DialogHeader>

        <DialogForm onSubmit={handleSubmit}>
          <Textarea
            aria-label="MCP JSON configuration"
            className="min-h-64 font-mono text-sm"
            placeholder={EXAMPLE_CONFIG}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />

          {"error" in parsed && text.trim() && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{parsed.error}</AlertDescription>
            </Alert>
          )}

          {candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.length > 1 && (
                <>
                  <label className="text-sm font-medium" htmlFor="mcp-import-server">
                    Server to import
                  </label>
                  <Select value={selectedId} onValueChange={setSelectedId}>
                    <SelectTrigger id="mcp-import-server">
                      <SelectValue placeholder="Select a server" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((candidate: McpConfigImportCandidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                {candidates.length === 1
                  ? `Ready to import ${candidates[0]?.label}.`
                  : `${candidates.length} servers found. Choose one to continue.`}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!selected}>
              Import configuration
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
