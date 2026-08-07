/**
 * Drives the standalone editor in a real browser.
 *
 * This is the only test that exercises the whole client path at once: canvas
 * rendering, pointer gestures for every tool, undo/redo, full-resolution export
 * and the publish request. It needs Playwright, which is deliberately not a
 * dependency of this package:
 *
 *     npm install --no-save playwright && npx playwright install chromium
 *     npm run build && node e2e/run.js
 *
 * Set PAINT_CHROME to use a Chromium binary you already have.
 */
const {chromium} = require('playwright');

const {createServer} = require('./server');
const {HEIGHT, SOURCE_BLUE, WIDTH} = require('./fixture');

const failures = [];

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`  PASS  ${name}`);
    } else {
        console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
        failures.push(name);
    }
}

async function main() {
    const server = createServer(0);
    await server.listen();

    const browser = await chromium.launch(
        process.env.PAINT_CHROME ? {executablePath: process.env.PAINT_CHROME} : {},
    );
    const page = await browser.newPage({viewport: {width: 900, height: 800}});

    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            pageErrors.push(`${message.text()} @ ${message.location().url}`);
        }
    });

    await page.goto(server.editorUrl());
    await page.waitForSelector('.mmpaint-canvas', {state: 'visible', timeout: 15000});
    await page.waitForFunction(() => {
        const canvas = document.querySelector('.mmpaint-canvas');
        return canvas && canvas.width > 0 && getComputedStyle(canvas).visibility === 'visible';
    }, null, {timeout: 15000});

    check('editor loads and shows the canvas', true);
    check('bearer token is stripped from the address bar',
        !page.url().includes('test-token'), page.url());
    check('title comes from the context response',
        (await page.textContent('.mmpaint-title-text')) === 'holiday.png');
    check('subtitle names the channel and the author',
        (await page.textContent('.mmpaint-subtitle')) === 'Family · shared by @wife');

    const first = await page.locator('.mmpaint-canvas').boundingBox();
    check('canvas preserves the image aspect ratio',
        Math.abs((first.width / first.height) - (WIDTH / HEIGHT)) < 0.02,
        `${first.width}x${first.height}`);

    // Re-measured every time: opening a panel or showing a status line can move
    // the canvas, and a gesture aimed at a stale rectangle silently misses.
    const at = async (fx, fy) => {
        const box = await page.locator('.mmpaint-canvas').boundingBox();
        return {x: box.x + (box.width * fx), y: box.y + (box.height * fy)};
    };

    const stroke = async (fromX, fromY, toX, toY) => {
        const from = await at(fromX, fromY);
        const to = await at(toX, toY);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, {steps: 8});
        await page.mouse.up();
    };

    // Pen is the default tool.
    await stroke(0.15, 0.3, 0.6, 0.55);
    check('undo becomes available after drawing',
        !(await page.locator('.mmpaint-undo').isDisabled()));

    await page.click('.mmpaint-tool[data-tool="arrow"]');
    await stroke(0.2, 0.8, 0.55, 0.6);

    await page.click('.mmpaint-tool[data-tool="rect"]');
    await stroke(0.05, 0.05, 0.3, 0.2);

    await page.click('.mmpaint-tool[data-tool="emoji"]');
    check('sticker panel opens with the sticker tool',
        (await page.getAttribute('.mmpaint-panel', 'data-open')) === 'true');

    // The panel must float over the photo rather than resize it, or everything
    // shifts under the user's finger the moment it opens.
    const beforePanel = await page.locator('.mmpaint-canvas').boundingBox();
    check('opening a panel does not move the photo',
        Math.abs(beforePanel.height - first.height) < 1,
        `${first.height} -> ${beforePanel.height}`);

    await page.click('.mmpaint-emoji[data-glyph="🔥"]');
    const place = await at(0.8, 0.3);
    await page.mouse.click(place.x, place.y);
    check('placing a sticker switches to the move tool',
        (await page.getAttribute('.mmpaint-root', 'data-tool')) === 'select');
    check('delete badge appears for the placed sticker',
        (await page.getAttribute('.mmpaint-badge', 'data-visible')) === 'true');

    // Drag it, which also proves hit testing lines up with what is drawn.
    const dropAt = await at(0.72, 0.45);
    await page.mouse.move(place.x, place.y);
    await page.mouse.down();
    await page.mouse.move(dropAt.x, dropAt.y, {steps: 6});
    await page.mouse.up();

    await page.click('.mmpaint-tool[data-tool="text"]');
    const textAt = await at(0.45, 0.15);
    await page.mouse.click(textAt.x, textAt.y);
    check('text panel opens after placing a text box',
        await page.locator('.mmpaint-textinput').isVisible());
    await page.fill('.mmpaint-textinput', 'love you');
    await page.click('.mmpaint-text-done');

    await page.click('.mmpaint-tool[data-tool="pen"]');
    await stroke(0.1, 0.92, 0.35, 0.88);
    await page.click('.mmpaint-undo');
    check('redo becomes available after undo',
        !(await page.locator('.mmpaint-redo').isDisabled()));
    await page.click('.mmpaint-redo');
    await page.click('.mmpaint-undo');

    const publishing = server.published();
    await page.fill('.mmpaint-caption', 'here you go');
    await page.click('.mmpaint-send');

    const published = await publishing;
    check('publish carries the bearer token', published.token === 'test-token');
    check('publish sends the CSRF-guard header',
        published.requestedWith === 'XMLHttpRequest');
    check('publish carries the caption', published.message === 'here you go');
    check('publish targets the right file', published.fileId === 'file123');
    check('a PNG source is re-encoded as PNG', published.mime === 'image/png');

    // Decode the result in the browser, which already has a PNG decoder, and
    // confirm the annotations survived the export at full resolution.
    const stats = await page.evaluate(async ({base64, sourceBlue}) => {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('undecodable'));
            element.src = `data:image/png;base64,${base64}`;
        });

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);

        const {data} = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        let annotated = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 2] !== sourceBlue) {
                annotated++;
            }
        }

        return {width: canvas.width, height: canvas.height, annotated};
    }, {base64: published.bytes.toString('base64'), sourceBlue: SOURCE_BLUE});

    check('export keeps the source resolution',
        stats.width === WIDTH && stats.height === HEIGHT,
        `${stats.width}x${stats.height}`);
    check('annotations are baked into the exported image',
        stats.annotated > 500, `${stats.annotated} changed pixels`);

    await page.waitForSelector('text=Back to the conversation', {timeout: 10000});
    check('confirmation screen appears after sending', true);
    check('confirmation links back to the new post',
        (await page.getAttribute('a.mmpaint-button', 'href')) === '/_redirect/pl/newpost456');

    // The point of putting the token in the fragment: it must never reach the
    // server in a URL, because that is what lands in an access log.
    const logged = server.requestedUrls();
    check('token never appears in any URL the server saw',
        !logged.some((entry) => entry.includes('test-token')),
        logged.filter((entry) => entry.includes('test-token')).join(' | '));
    check('the image was fetched without credentials in the URL',
        logged.some((entry) => entry.includes('/api/v1/image')) &&
        !logged.some((entry) => entry.includes('/api/v1/image') && entry.includes('paint_token')));

    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

    await browser.close();
    await server.close();

    if (failures.length) {
        console.log(`\n${failures.length} failure(s)`);
        process.exit(1);
    }
    console.log('\nall browser checks passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
