import type { BrowserCommand, ToolCallOptions, ToolResult } from "./types.js";

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchema | { type: string; enum?: string[]; description?: string; items?: JsonSchema }>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface BrowserToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: Record<string, unknown>, options?: ToolCallOptions) => Promise<ToolResult<unknown>>;
}

const ref = {
  type: "string",
  description: "Stable element ref returned by browser_observe.",
} as const;

export function createBrowserTools(execute: (command: BrowserCommand, options?: ToolCallOptions) => Promise<ToolResult<unknown>>): BrowserToolDefinition[] {
  return [
    {
      name: "browser_observe",
      description: "Inspect the current browser page and return a compact list of interactive elements.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: (_input, options) => execute({ type: "observe" }, options),
    },
    {
      name: "browser_navigate",
      description: "Navigate the current browser page to an HTTPS or HTTP URL allowed by policy.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "Destination URL." } },
        required: ["url"],
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "navigate", url: String(input.url) }, options),
    },
    {
      name: "browser_click",
      description: "Click an observed element by stable ref, CSS selector, or coordinates.",
      inputSchema: {
        type: "object",
        properties: {
          ref,
          selector: { type: "string", description: "CSS selector." },
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "middle", "right"] },
          clickCount: { type: "number" },
        },
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "click", ...input } as BrowserCommand, options),
    },
    {
      name: "browser_fill",
      description: "Replace the value of an input, textarea, or contenteditable element.",
      inputSchema: {
        type: "object",
        properties: { ref, selector: { type: "string" }, value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "fill", ...input } as BrowserCommand, options),
    },
    {
      name: "browser_type",
      description: "Type text into the active or selected page element.",
      inputSchema: {
        type: "object",
        properties: { ref, selector: { type: "string" }, text: { type: "string" }, delayMs: { type: "number" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "type", ...input } as BrowserCommand, options),
    },
    {
      name: "browser_press",
      description: "Press a keyboard key or shortcut such as Enter, Tab, or Control+L.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "press", key: String(input.key) }, options),
    },
    {
      name: "browser_scroll",
      description: "Scroll the page or active container by a delta.",
      inputSchema: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" }, deltaX: { type: "number" }, deltaY: { type: "number" } },
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "scroll", ...input } as BrowserCommand, options),
    },
    {
      name: "browser_screenshot",
      description: "Capture the current browser viewport or full page.",
      inputSchema: {
        type: "object",
        properties: { fullPage: { type: "boolean" }, format: { type: "string", enum: ["png", "jpeg", "webp"] } },
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "screenshot", ...input } as BrowserCommand, options),
    },
    {
      name: "browser_wait",
      description: "Wait for a short duration, selector, or URL condition.",
      inputSchema: {
        type: "object",
        properties: { ms: { type: "number" }, selector: { type: "string" }, url: { type: "string" } },
        additionalProperties: false,
      },
      execute: (input, options) => execute({ type: "wait", ...input } as BrowserCommand, options),
    },
  ];
}
