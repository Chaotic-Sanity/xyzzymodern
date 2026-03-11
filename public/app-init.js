"use strict";

(function initPhoneAppShell() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function registerServiceWorker() {
      navigator.serviceWorker.register("/service-worker.js").catch(function () {
        // The app still works without offline caching, so fail quietly.
      });
    });
  }
})();
