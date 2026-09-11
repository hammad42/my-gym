export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
      // In production (e.g. deployed or preview), register the offline worker.
      // BASE_URL keeps the registration correct at a site root (Vercel) and
      // under a subpath alike.
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register(`${import.meta.env.BASE_URL}sw.js`)
          .then((registration) => {
            console.log('[PWA] ServiceWorker registered with scope:', registration.scope);
          })
          .catch((error) => {
            console.warn('[PWA] ServiceWorker registration failed:', error);
          });
      });
    } else {
      // In development mode, unregister any service worker so Vite HMR is never blocked
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
    }
  }
}
