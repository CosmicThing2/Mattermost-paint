// Generates the test photo without pulling in an image library: a small RGB
// PNG whose blue channel is a constant, so any pixel with a different blue
// value in the exported result must have been painted by the editor.
const zlib = require('zlib');

const WIDTH = 600;
const HEIGHT = 400;
const SOURCE_BLUE = 128;

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = -1;
    for (let i = 0; i < buffer.length; i++) {
        c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);

    return Buffer.concat([length, body, crc]);
}

function sourcePng() {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0);
    header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // truecolour
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    const raw = Buffer.alloc(HEIGHT * ((WIDTH * 3) + 1));
    let offset = 0;
    for (let y = 0; y < HEIGHT; y++) {
        raw[offset++] = 0; // filter: none
        for (let x = 0; x < WIDTH; x++) {
            raw[offset++] = x % 256;
            raw[offset++] = y % 256;
            raw[offset++] = SOURCE_BLUE;
        }
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

module.exports = {WIDTH, HEIGHT, SOURCE_BLUE, sourcePng};
