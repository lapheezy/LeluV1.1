// Models the Caddy front: gzip on, proxies everything to the real bun server.
import http from "node:http"; import zlib from "node:zlib";
const UP = +(process.env.UP ?? 4173), PORT = +(process.env.PORT ?? 4180);
http.createServer((req, res) => {
  const p = http.request({ host: "127.0.0.1", port: UP, path: req.url, method: req.method, headers: { ...req.headers } }, (r) => {
    const type = String(r.headers["content-type"] ?? ""); const gz = !r.headers["content-encoding"] && /javascript|css|html|json|svg|text/.test(type) && /gzip/.test(String(req.headers["accept-encoding"] ?? "")) && !/event-stream/.test(type);
    const h = { ...r.headers }; if (gz) { delete h["content-length"]; h["content-encoding"] = "gzip"; }
    res.writeHead(r.statusCode, h); (gz ? r.pipe(zlib.createGzip({ level: 6 })) : r).pipe(res);
  });
  p.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(p);
}).listen(PORT, "127.0.0.1", () => console.log("gzproxy", PORT));
