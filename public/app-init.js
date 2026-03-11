"use strict";

(function initPhoneAppShell() {
  window.TP_SERVER_URL = "https://terrible-people.onrender.com";
  window.tpCreateSocket = function tpCreateSocket() {
    return io(window.TP_SERVER_URL, {
      transports: ["websocket", "polling"]
    });
  };

  if ("serviceWorker" in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
    window.addEventListener("load", function registerServiceWorker() {
      navigator.serviceWorker.register("/service-worker.js").catch(function () {
        // The app still works without offline caching, so fail quietly.
      });
    });
  }
})();