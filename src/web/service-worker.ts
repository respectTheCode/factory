const cacheName = "software-factory-shell-v6";
const appShell = [
  "/",
  "/main.js?v=dashboard-v3",
  "/main.css?v=dashboard-v3",
  "/icon.svg",
];
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

  if (request.method !== "GET" || url.pathname === "/trpc") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  );
});
