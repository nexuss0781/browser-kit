# browser-kit

Small TypeScript SDK and Nexus agent-tool adapter for remote Chromium sessions.

## Install

```bash
npm install browser-kit
```

## Basic usage

```ts
import { BrowserKit } from "browser-kit";

const kit = new BrowserKit({
  baseUrl: process.env.BROWSER_KIT_URL!,
  apiKey: process.env.BROWSER_KIT_API_KEY,
});

const session = await kit.createSession({
  viewport: { width: 1440, height: 900 },
  profile: "ephemeral",
});

await session.page.goto("https://example.com");
const snapshot = await session.page.observe();
console.log(snapshot);
await session.page.locator("a").click();
await session.close();
```

## React live view

```bash
npm install browser-kit react
```

```tsx
import { BrowserPanel } from "browser-kit/react";

<BrowserPanel src={liveViewUrl} title="Agent browser" />;
```

The package is a client SDK. Chromium and the browser control engine run in the separately deployed `@browser-kit/server` Docker service. See the full documentation at [github.com/nexuss0781/browser-kit](https://github.com/nexuss0781/browser-kit).
