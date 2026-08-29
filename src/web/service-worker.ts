const cacheName = "software-factory-shell-v13";
const appShell = [
  "/",
  "/main.js",
  "/main.css",
  "/icon.svg",
  "/manifest.webmanifest",
];
const appShellPaths = new Set([
  "/main.js",
  "/main.css",
  "/icon.svg",
  "/manifest.webmanifest",
]);
const worker = self as unknown as {
  addEventListener: (
    type: string,
    listener: (event: {
      request: Request;
      respondWith: (response: Promise<Response | undefined>) => void;
      waitUntil: (work: Promise<unknown>) => void;
    }) => void,
  ) => void;
  clients: { claim: () => Promise<void> };
  skipWaiting: () => Promise<void>;
};

worker.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(appShell))
      .then(() => worker.skipWaiting()),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("software-factory-shell-") && key !== cacheName,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.pathname === "/trpc" ||
    (request.mode !== "navigate" && !appShellPaths.has(url.pathname))
  ) {
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(new Request(request, { cache: "no-cache" }));
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }

    return new Response("Software Factory is offline.", {
      headers: { "Content-Type": "text/plain" },
      status: 503,
    });
  }
}
