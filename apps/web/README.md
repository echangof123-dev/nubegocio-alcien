# apps/web

App web instalable (PWA) de Al Cien: React 19 compilado con esbuild (`node build.mjs`), con la marca del sistema de diseño Al Cien.

Pantallas: acceso con código, registro del negocio, vender (búsqueda, categorías, código de barras, venta por peso, poner precio al vuelo), cobrar (efectivo con vuelto, transferencia, tarjeta, fiado), caja (abrir, gastos, retiros, cierre), productos, fiados y reportes del día.

La API sirve `dist/` en producción (`ALCIEN_WEB_DIR`). El service worker guarda la app para abrir sin señal, pero nunca guarda datos de la API.
