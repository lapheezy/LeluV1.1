/**
 * TLS front for local preview captures.
 *
 * The app calls crypto.randomUUID() and other secure-context APIs at
 * boot, so an http:// origin that is not localhost dies immediately with
 * "crypto.randomUUID is not a function" and never mounts a canvas.
 * Cloud previews arrive over https, so reproduce that here: terminate
 * TLS on a local port and forward to the Vite dev server, keeping the
 * original Host header (Vite allows the preview hostname).
 *
 *   node artifacts/https-proxy.mjs 3443 3002 pv-....style.dev
 */
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";

const [targetPort = "3443", upstreamPort = "3002", host] = process.argv.slice(2);
if (!host) throw new Error("usage: https-proxy.mjs <tlsPort> <upstreamPort> <host>");

const server = createServer(
  { key: readFileSync("/tmp/lelu-tls/key.pem"), cert: readFileSync("/tmp/lelu-tls/cert.pem") },
  (req, res) => {
    const upstream = httpRequest(
      { host: "127.0.0.1", port: Number(upstreamPort), method: req.method, path: req.url, headers: { ...req.headers, host } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream error: ${err.message}`);
    });
    req.pipe(upstream);
  },
);

server.on("upgrade", (req, socket, head) => {
  const upstream = httpRequest({
    host: "127.0.0.1",
    port: Number(upstreamPort),
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host },
  });
  upstream.on("upgrade", (up, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(up.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (upHead?.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(Number(targetPort), "127.0.0.1", () => console.log(`https://${host}:${targetPort} -> 127.0.0.1:${upstreamPort}`));
