// Compila la app web a dist/: un solo JS con hash, el CSS, el index.html y los archivos públicos.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const raiz = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(raiz, "dist");
const vigilar = process.argv.includes("--watch");

function copiar(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
    const o = path.join(origen, e.name), d = path.join(destino, e.name);
    if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
  }
}

async function construir() {
  fs.rmSync(dist, { recursive: true, force: true });
  copiar(path.join(raiz, "public"), dist);

  const r = await esbuild.build({
    entryPoints: [path.join(raiz, "src/main.tsx")],
    bundle: true,
    minify: !vigilar,
    sourcemap: true,
    format: "esm",
    target: ["es2022", "safari15", "chrome100"],
    jsx: "automatic",
    outdir: path.join(dist, "assets"),
    entryNames: "[name]-[hash]",
    external: ["/fonts/*", "/iconos/*"],
    define: { "process.env.NODE_ENV": JSON.stringify(vigilar ? "development" : "production") },
    metafile: true,
    logLevel: "warning",
  });

  const salidas = Object.keys(r.metafile.outputs).map((f) => "/" + path.relative(dist, path.resolve(f)).split(path.sep).join("/"));
  const js = salidas.find((f) => f.endsWith(".js"));
  const css = salidas.find((f) => f.endsWith(".css"));

  const html = fs.readFileSync(path.join(raiz, "src/index.html"), "utf8")
    .replace("<!--CSS-->", css ? `<link rel="stylesheet" href="${css}">` : "")
    .replace("<!--JS-->", `<script type="module" src="${js}"></script>`);
  fs.writeFileSync(path.join(dist, "index.html"), html);

  // El service worker precarga lo que la app necesita para abrir sin señal
  const version = crypto.createHash("sha256").update(salidas.join(",")).digest("hex").slice(0, 10);
  const sw = fs.readFileSync(path.join(raiz, "src/sw.js"), "utf8")
    .replace("__VERSION__", version)
    .replace("__PRECARGA__", JSON.stringify(["/", "/manifest.webmanifest", ...salidas.filter((f) => !f.endsWith(".map"))]));
  fs.writeFileSync(path.join(dist, "sw.js"), sw);

  console.log(`web lista en dist/ (${js}, versión ${version})`);
}

await construir();
if (vigilar) {
  fs.watch(path.join(raiz, "src"), { recursive: true }, () => construir().catch((e) => console.error(e.message)));
}
