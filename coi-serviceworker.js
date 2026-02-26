/*! coi-serviceworker v0.1.6 - Guido Zuidhof, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", function (event) {
        if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
            return;
        }

        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });
} else {
    (() => {
        const scriptEl = document.currentScript;
        if (scriptEl) {
            coepCredentialless = scriptEl.getAttribute("coep") === "credentialless";
        }
        if (window.crossOriginIsolated !== false) return;

        let isMac = /macintosh|mac os x/i.test(navigator.userAgent);
        if (isMac && !navigator.serviceWorker) return;

        navigator.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                registration.addEventListener("updatefound", () => {
                    window.location.reload();
                });
                if (registration.active && !navigator.serviceWorker.controller) {
                    window.location.reload();
                }
            }
        ).catch(e => console.error("COI ServiceWorker failure:", e));
    })();
}
