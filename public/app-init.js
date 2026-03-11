"use strict";

(function initPhoneAppShell() {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  window.TP_SERVER_URL = "https://terrible-people.onrender.com";
  window.tpCreateSocket = function tpCreateSocket() {
    return io(window.TP_SERVER_URL, {
      transports: ["websocket", "polling"]
    });
  };

  if (isNative) {
    const path = String(window.location.pathname || "");
    const allowGameEntry = sessionStorage.getItem("tp_allow_game_entry") === "1";
    const isIndexPage = /(^|\/)index\.html$/i.test(path) || path === "/";
    if (isIndexPage && !allowGameEntry) {
      window.location.replace("/lobby.html");
      return;
    }
    if (allowGameEntry) {
      sessionStorage.removeItem("tp_allow_game_entry");
    }
  }

  if ("serviceWorker" in navigator && !isNative) {
    window.addEventListener("load", function registerServiceWorker() {
      navigator.serviceWorker.register("/service-worker.js").catch(function () {
        // The app still works without offline caching, so fail quietly.
      });
    });
  }
})();