// A stand-in for the Go plugin server, exposing the same routes and JSON shapes
// so the built standalone bundle can be driven in a real browser without a
// running Mattermost.
const http = require('http');
const fs = require('fs');
const path = require('path');

const {sourcePng} = require('./fixture');

const BASE = '/plugins/com.cosmicthing.paint';
const DIST = path.join(__dirname, '..', 'dist');
const SOURCE = sourcePng();

const bootstrap = JSON.stringify({
    pluginBase: BASE,
    standalone: true,
});

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paint</title></head>
<body><div id="paint-root" data-bootstrap='${bootstrap.replace(/'/g, '&#39;')}'></div>
<script src="${BASE}/static/standalone.js" defer></script>
</body></html>`;

/** Resolves once the browser has sent an edited image, with what it sent. */
function createServer(port) {
    let onPublish = null;

    const requestedUrls = [];

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        requestedUrls.push(req.url);

        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }

        const route = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : '';

        if (route === '/editor') {
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            res.end(page);
            return;
        }

        if (route === '/static/standalone.js') {
            const bundle = path.join(DIST, 'standalone.js');
            if (!fs.existsSync(bundle)) {
                res.writeHead(500);
                res.end('run `npm run build` first');
                return;
            }
            res.writeHead(200, {'Content-Type': 'application/javascript'});
            res.end(fs.readFileSync(bundle));
            return;
        }

        if (route === '/api/v1/context') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                file_id: 'file123',
                file_name: 'holiday.png',
                width: 600,
                height: 400,
                mime_type: 'image/png',
                post_id: 'post123',
                root_id: 'post123',
                channel_id: 'chan123',
                channel_name: 'Family',
                author_name: 'wife',
                can_post: true,
                max_bytes: 8 * 1024 * 1024,
            }));
            return;
        }

        if (route === '/api/v1/image') {
            res.writeHead(200, {'Content-Type': 'image/png'});
            res.end(SOURCE);
            return;
        }

        if (route === '/api/v1/publish') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                const payload = JSON.parse(body);
                const marker = ';base64,';
                const index = payload.image.indexOf(marker);

                onPublish?.({
                    fileId: payload.file_id,
                    message: payload.message,
                    mime: payload.image.slice(5, payload.image.indexOf(';')),
                    bytes: Buffer.from(payload.image.slice(index + marker.length), 'base64'),
                    token: req.headers['x-paint-token'] || '',
                    requestedWith: req.headers['x-requested-with'] || '',
                });

                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({post_id: 'newpost456'}));
            });
            return;
        }

        res.writeHead(404);
        res.end('not found');
    });

    return {
        // Port 0 asks the OS for a free port, so a stray server from an earlier
        // run can never block this one.
        listen: () => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
        close: () => new Promise((resolve) => server.close(resolve)),
        published: () => new Promise((resolve) => {
            onPublish = resolve;
        }),
        // Everything a reverse proxy would have logged.
        requestedUrls: () => requestedUrls.slice(),
        editorUrl: () => `http://localhost:${server.address().port}${BASE}/editor#paint_token=test-token&file_id=file123`,
    };
}

module.exports = {createServer};
