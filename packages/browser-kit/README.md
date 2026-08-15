# browser-kit

Small TypeScript SDK and Nexus agent-tool adapter for remote Chromium sessions. Current published version: [`0.1.0`](https://www.npmjs.com/package/browser-kit).

The npm package is the client contract. Chromium and the session engine run in the separately deployed Docker service from the [GitHub repository](https://github.com/nexuss0781/browser-kit).

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

The package is a client SDK. Chromium and the browser control engine run in the separately deployed `@browser-kit/server` Docker service. The current P0 live view uses screenshot polling with HTTP input forwarding. See the [API reference](https://github.com/nexuss0781/browser-kit/blob/main/docs/api.md), [deployment guide](https://github.com/nexuss0781/browser-kit/blob/main/docs/deployment.md), and [roadmap](https://github.com/nexuss0781/browser-kit/blob/main/docs/roadmap.md).
