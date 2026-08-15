import { BrowserKit, createBrowserTools } from "browser-kit";

const kit = new BrowserKit({
  baseUrl: process.env.BROWSER_KIT_URL ?? "http://localhost:10000",
  apiKey: process.env.BROWSER_KIT_API_KEY,
});

const session = await kit.createSession({
  agentId: "demo-agent",
  taskId: "demo-task",
  viewport: { width: 1280, height: 800 },
  policy: {
    allowEvaluate: false,
    allowedOrigins: ["https://example.com"],
  },
});

try {
  const tools = createBrowserTools((command, options) => session.execute(command, options));
  const observe = tools.find((tool) => tool.name === "browser_observe");
  const navigate = tools.find((tool) => tool.name === "browser_navigate");

  if (!navigate || !observe) throw new Error("Required browser tools are unavailable");
  await navigate.execute({ url: "https://example.com" });
  const snapshot = await observe.execute({});
  console.log(JSON.stringify(snapshot, null, 2));

  const liveView = await session.liveView("readonly");
  console.log("Embed this URL in the Nexus playground:", liveView.url);
} finally {
  await session.close();
}
