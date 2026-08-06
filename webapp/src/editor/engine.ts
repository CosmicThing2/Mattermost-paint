import {
    ArrowShape,
    BoxShape,
    EmojiShape,
    MovableShape,
    Point,
    Rect,
    Shape,
    StrokeShape,
    TextShape,
    isMovable,
} from './types';

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const TEXT_FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';

/** Screen-space sizes for selection chrome, divided by the zoom before drawing
 *  so the handles stay the same physical size at any zoom level. */
const HANDLE_RADIUS = 11;
const OUTLINE_WIDTH = 1.5;

let idCounter = 0;

function nextId(): string {
    idCounter += 1;
    return `s${idCounter}`;
}

function clone(shapes: Shape[]): Shape[] {
    return JSON.parse(JSON.stringify(shapes)) as Shape[];
}

function normalise(from: Point, to: Point): Rect {
    return {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
    };
}

/**
 * PaintEngine owns the image, the list of shapes drawn on top of it, and the
 * canvas they are rendered to. It knows nothing about buttons or Mattermost:
 * the same instance backs the desktop modal and the standalone mobile page.
 *
 * All shape geometry is stored in *image* pixels, never screen pixels, so the
 * document survives zooming, device pixel ratio changes and window resizes, and
 * exports at the source image's full resolution.
 */
export class PaintEngine {
    readonly canvas: HTMLCanvasElement;

    private readonly ctx: CanvasRenderingContext2D;
    private image: HTMLImageElement | null = null;

    private shapes: Shape[] = [];
    private undoStack: Shape[][] = [];
    private redoStack: Shape[][] = [];

    private selectedId: string | null = null;

    /** Image pixels per CSS pixel. */
    private zoom = 1;

    /** Callback fired whenever the document or selection changes, so the UI can
     *  refresh button states. */
    onChange: (() => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('This browser cannot open the photo editor.');
        }
        this.ctx = ctx;
    }

    setImage(image: HTMLImageElement): void {
        this.image = image;
    }

    get imageWidth(): number {
        return this.image ? this.image.naturalWidth || this.image.width : 0;
    }

    get imageHeight(): number {
        return this.image ? this.image.naturalHeight || this.image.height : 0;
    }

    get isEmpty(): boolean {
        return this.shapes.length === 0;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    getSelected(): MovableShape | null {
        const shape = this.shapes.find((candidate) => candidate.id === this.selectedId);
        return shape && isMovable(shape) ? shape : null;
    }

    select(id: string | null): void {
        if (this.selectedId !== id) {
            this.selectedId = id;
            this.render();
            this.emitChange();
        }
    }

    // -- history --------------------------------------------------------------

    /** Snapshots the document before a mutation. Every user-visible edit calls
     *  this exactly once so that one gesture is one undo step. */
    beginChange(): void {
        this.undoStack.push(clone(this.shapes));
        if (this.undoStack.length > 100) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo(): void {
        const previous = this.undoStack.pop();
        if (!previous) {
            return;
        }

        this.redoStack.push(clone(this.shapes));
        this.shapes = previous;
        this.dropStaleSelection();
        this.render();
        this.emitChange();
    }

    redo(): void {
        const next = this.redoStack.pop();
        if (!next) {
            return;
        }

        this.undoStack.push(clone(this.shapes));
        this.shapes = next;
        this.dropStaleSelection();
        this.render();
        this.emitChange();
    }

    clearAll(): void {
        if (this.shapes.length === 0) {
            return;
        }

        this.beginChange();
        this.shapes = [];
        this.selectedId = null;
        this.render();
        this.emitChange();
    }

    private dropStaleSelection(): void {
        if (this.selectedId && !this.shapes.some((shape) => shape.id === this.selectedId)) {
            this.selectedId = null;
        }
    }

    // -- shape creation -------------------------------------------------------

    addStroke(start: Point, color: string, width: number): StrokeShape {
        const shape: StrokeShape = {id: nextId(), kind: 'stroke', points: [start], color, width};
        this.shapes.push(shape);
        return shape;
    }

    addArrow(start: Point, color: string, width: number): ArrowShape {
        const shape: ArrowShape = {id: nextId(), kind: 'arrow', from: start, to: start, color, width};
        this.shapes.push(shape);
        return shape;
    }

    addBox(kind: 'rect' | 'ellipse', start: Point, color: string, width: number): BoxShape {
        const shape: BoxShape = {id: nextId(), kind, from: start, to: start, color, width};
        this.shapes.push(shape);
        return shape;
    }

    addText(at: Point, color: string, size: number): TextShape {
        const shape: TextShape = {id: nextId(), kind: 'text', at, text: '', color, size};
        this.shapes.push(shape);
        this.selectedId = shape.id;
        return shape;
    }

    addEmoji(at: Point, glyph: string, size: number): EmojiShape {
        const shape: EmojiShape = {id: nextId(), kind: 'emoji', at, glyph, size};
        this.shapes.push(shape);
        this.selectedId = shape.id;
        return shape;
    }

    remove(id: string): void {
        const index = this.shapes.findIndex((shape) => shape.id === id);
        if (index < 0) {
            return;
        }

        this.shapes.splice(index, 1);
        if (this.selectedId === id) {
            this.selectedId = null;
        }
    }

    /** Cancels the snapshot taken by the most recent beginChange(), for gestures
     *  that turn out to have changed nothing. */
    dropLastChange(): void {
        this.undoStack.pop();
    }

    /** Discards a shape without leaving an undo step behind — used when a drag
     *  turns out to be a stray tap, or a text box is left empty. */
    discard(id: string): void {
        this.remove(id);
        this.dropLastChange();
        this.render();
        this.emitChange();
    }

    // -- layout and coordinates ----------------------------------------------

    /** Sizes the canvas to fit `availableWidth` x `availableHeight` CSS pixels
     *  while preserving aspect ratio, and re-renders at device resolution. */
    layout(availableWidth: number, availableHeight: number): void {
        if (!this.image || this.imageWidth === 0 || this.imageHeight === 0) {
            return;
        }

        const fit = Math.min(availableWidth / this.imageWidth, availableHeight / this.imageHeight);
        this.zoom = Math.max(fit, 0.01);

        const cssWidth = this.imageWidth * this.zoom;
        const cssHeight = this.imageHeight * this.zoom;
        const ratio = window.devicePixelRatio || 1;

        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        this.canvas.width = Math.max(1, Math.round(cssWidth * ratio));
        this.canvas.height = Math.max(1, Math.round(cssHeight * ratio));

        this.render();
    }

    /** Converts a pointer event's viewport coordinates into image pixels. */
    toImagePoint(clientX: number, clientY: number): Point {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) / this.zoom,
            y: (clientY - rect.top) / this.zoom,
        };
    }

    /** Converts image pixels back to viewport coordinates, for positioning DOM
     *  overlays such as the delete badge. */
    toClientPoint(point: Point): Point {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: rect.left + (point.x * this.zoom),
            y: rect.top + (point.y * this.zoom),
        };
    }

    /** A sensible default size for text and stickers on this particular image,
     *  so a 4000px photo does not get 16px text. Scaled off the short edge at
     *  roughly the size a phone camera app uses for a caption. */
    defaultGlyphSize(): number {
        return Math.max(20, Math.round(Math.min(this.imageWidth, this.imageHeight) * 0.08));
    }

    defaultStrokeWidth(): number {
        return Math.max(2, Math.round(Math.min(this.imageWidth, this.imageHeight) * 0.006));
    }

    // -- hit testing ----------------------------------------------------------

    boundsOf(shape: MovableShape): Rect {
        if (shape.kind === 'emoji') {
            return {
                x: shape.at.x - (shape.size / 2),
                y: shape.at.y - (shape.size / 2),
                width: shape.size,
                height: shape.size,
            };
        }

        const lines = shape.text.length ? shape.text.split('\n') : [' '];
        const lineHeight = shape.size * 1.25;

        this.ctx.save();
        this.ctx.font = `600 ${shape.size}px ${TEXT_FONT}`;
        const width = Math.max(...lines.map((line) => this.ctx.measureText(line || ' ').width));
        this.ctx.restore();

        const height = lineHeight * lines.length;
        return {
            x: shape.at.x - (width / 2),
            y: shape.at.y - (height / 2),
            width,
            height,
        };
    }

    /** Topmost movable shape under the point, or null. */
    hitTest(point: Point): MovableShape | null {
        for (let index = this.shapes.length - 1; index >= 0; index--) {
            const shape = this.shapes[index];
            if (!isMovable(shape)) {
                continue;
            }

            const bounds = this.boundsOf(shape);
            const pad = 6 / this.zoom;
            if (
                point.x >= bounds.x - pad &&
                point.x <= bounds.x + bounds.width + pad &&
                point.y >= bounds.y - pad &&
                point.y <= bounds.y + bounds.height + pad
            ) {
                return shape;
            }
        }

        return null;
    }

    /** True when the point lands on the resize handle of the current selection. */
    hitResizeHandle(point: Point): boolean {
        const selected = this.getSelected();
        if (!selected) {
            return false;
        }

        const bounds = this.boundsOf(selected);
        const handle = {x: bounds.x + bounds.width, y: bounds.y + bounds.height};
        const radius = (HANDLE_RADIUS + 6) / this.zoom;

        return Math.hypot(point.x - handle.x, point.y - handle.y) <= radius;
    }

    // -- rendering ------------------------------------------------------------

    render(): void {
        if (!this.image) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        const {ctx} = this;

        ctx.setTransform(this.zoom * ratio, 0, 0, this.zoom * ratio, 0, 0);
        ctx.clearRect(0, 0, this.imageWidth, this.imageHeight);
        ctx.drawImage(this.image, 0, 0, this.imageWidth, this.imageHeight);

        this.paintShapes(ctx);
        this.paintSelection(ctx, this.zoom);
    }

    /** Renders at full image resolution for export, with no selection chrome. */
    private renderForExport(): HTMLCanvasElement {
        const output = document.createElement('canvas');
        output.width = this.imageWidth;
        output.height = this.imageHeight;

        const ctx = output.getContext('2d');
        if (!ctx || !this.image) {
            throw new Error('Could not render the edited image.');
        }

        ctx.drawImage(this.image, 0, 0, this.imageWidth, this.imageHeight);
        this.paintShapes(ctx);

        return output;
    }

    private paintShapes(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const shape of this.shapes) {
            switch (shape.kind) {
            case 'stroke':
                this.paintStroke(ctx, shape);
                break;
            case 'arrow':
                this.paintArrow(ctx, shape);
                break;
            case 'rect':
            case 'ellipse':
                this.paintBox(ctx, shape);
                break;
            case 'text':
                this.paintText(ctx, shape);
                break;
            case 'emoji':
                this.paintEmoji(ctx, shape);
                break;
            }
        }

        ctx.restore();
    }

    private paintStroke(ctx: CanvasRenderingContext2D, shape: StrokeShape): void {
        if (shape.points.length === 0) {
            return;
        }

        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.beginPath();

        if (shape.points.length === 1) {
            // A single tap should still leave a dot behind.
            const [only] = shape.points;
            ctx.fillStyle = shape.color;
            ctx.arc(only.x, only.y, shape.width / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        // Midpoint-quadratic smoothing turns the raw pointer samples into a
        // continuous curve, which matters most on low-sample-rate touchscreens.
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let index = 1; index < shape.points.length - 1; index++) {
            const current = shape.points[index];
            const next = shape.points[index + 1];
            ctx.quadraticCurveTo(
                current.x,
                current.y,
                (current.x + next.x) / 2,
                (current.y + next.y) / 2,
            );
        }

        const last = shape.points[shape.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
    }

    private paintArrow(ctx: CanvasRenderingContext2D, shape: ArrowShape): void {
        const angle = Math.atan2(shape.to.y - shape.from.y, shape.to.x - shape.from.x);
        const length = Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y);
        if (length < 1) {
            return;
        }

        const head = Math.min(shape.width * 4, length);

        ctx.strokeStyle = shape.color;
        ctx.fillStyle = shape.color;
        ctx.lineWidth = shape.width;

        ctx.beginPath();
        ctx.moveTo(shape.from.x, shape.from.y);
        ctx.lineTo(
            shape.to.x - (Math.cos(angle) * head * 0.7),
            shape.to.y - (Math.sin(angle) * head * 0.7),
        );
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(shape.to.x, shape.to.y);
        ctx.lineTo(
            shape.to.x - (Math.cos(angle - 0.4) * head),
            shape.to.y - (Math.sin(angle - 0.4) * head),
        );
        ctx.lineTo(
            shape.to.x - (Math.cos(angle + 0.4) * head),
            shape.to.y - (Math.sin(angle + 0.4) * head),
        );
        ctx.closePath();
        ctx.fill();
    }

    private paintBox(ctx: CanvasRenderingContext2D, shape: BoxShape): void {
        const rect = normalise(shape.from, shape.to);

        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.beginPath();

        if (shape.kind === 'rect') {
            ctx.rect(rect.x, rect.y, rect.width, rect.height);
        } else {
            ctx.ellipse(
                rect.x + (rect.width / 2),
                rect.y + (rect.height / 2),
                Math.max(rect.width / 2, 1),
                Math.max(rect.height / 2, 1),
                0,
                0,
                Math.PI * 2,
            );
        }

        ctx.stroke();
    }

    private paintText(ctx: CanvasRenderingContext2D, shape: TextShape): void {
        if (!shape.text) {
            return;
        }

        const lines = shape.text.split('\n');
        const lineHeight = shape.size * 1.25;
        const bounds = this.boundsOf(shape);

        ctx.save();
        ctx.font = `600 ${shape.size}px ${TEXT_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // A soft dark halo keeps light text readable over a light photo without
        // needing a background box.
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = Math.max(2, shape.size * 0.12);
        ctx.fillStyle = shape.color;

        lines.forEach((line, index) => {
            ctx.fillText(line, shape.at.x, bounds.y + (lineHeight * (index + 0.5)));
        });

        ctx.restore();
    }

    private paintEmoji(ctx: CanvasRenderingContext2D, shape: EmojiShape): void {
        ctx.save();
        ctx.font = `${shape.size}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shape.glyph, shape.at.x, shape.at.y);
        ctx.restore();
    }

    private paintSelection(ctx: CanvasRenderingContext2D, zoom: number): void {
        const selected = this.getSelected();
        if (!selected) {
            return;
        }

        const bounds = this.boundsOf(selected);
        const pad = 8 / zoom;

        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = OUTLINE_WIDTH / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.strokeRect(
            bounds.x - pad,
            bounds.y - pad,
            bounds.width + (pad * 2),
            bounds.height + (pad * 2),
        );

        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.arc(
            bounds.x + bounds.width,
            bounds.y + bounds.height,
            HANDLE_RADIUS / zoom,
            0,
            Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // -- export ---------------------------------------------------------------

    /**
     * Encodes the result, shrinking it until it fits `maxBytes`.
     *
     * Photos start as JPEG so that annotating a 12 megapixel phone picture does
     * not turn a 3 MB file into a 30 MB PNG; screenshots and anything with sharp
     * edges stay lossless unless they overrun the limit.
     */
    async exportImage(sourceMimeType: string, maxBytes: number): Promise<string> {
        const preferJpeg = (/^image\/(jpeg|jpg)$/i).test(sourceMimeType);
        const canvas = this.renderForExport();

        const attempts: Array<{type: string; quality?: number}> = preferJpeg ? [
            {type: 'image/jpeg', quality: 0.92},
            {type: 'image/jpeg', quality: 0.82},
            {type: 'image/jpeg', quality: 0.7},
        ] : [
            {type: 'image/png'},
            {type: 'image/jpeg', quality: 0.9},
            {type: 'image/jpeg', quality: 0.75},
        ];

        let best = '';
        for (const attempt of attempts) {
            const dataUrl = canvas.toDataURL(attempt.type, attempt.quality);
            best = dataUrl;
            if (dataUrlBytes(dataUrl) <= maxBytes) {
                return dataUrl;
            }
        }

        // Still too big: fall back to halving the resolution, which is the only
        // lever left that keeps the image sendable.
        const scaled = downscale(canvas, 2048);
        if (scaled !== canvas) {
            const dataUrl = scaled.toDataURL('image/jpeg', 0.85);
            if (dataUrlBytes(dataUrl) <= maxBytes) {
                return dataUrl;
            }
            best = dataUrl;
        }

        if (dataUrlBytes(best) > maxBytes) {
            throw new Error('This image is too large to send even after compressing it.');
        }

        return best;
    }

    private emitChange(): void {
        this.onChange?.();
    }
}

function dataUrlBytes(dataUrl: string): number {
    const index = dataUrl.indexOf(',');
    if (index < 0) {
        return dataUrl.length;
    }

    // Every 4 base64 characters encode 3 bytes, minus any '=' padding.
    const payload = dataUrl.length - index - 1;
    const padding = dataUrl.endsWith('==') ? 2 : (dataUrl.endsWith('=') ? 1 : 0);

    return Math.floor((payload * 3) / 4) - padding;
}

function downscale(canvas: HTMLCanvasElement, maxDimension: number): HTMLCanvasElement {
    const longest = Math.max(canvas.width, canvas.height);
    if (longest <= maxDimension) {
        return canvas;
    }

    const factor = maxDimension / longest;
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(canvas.width * factor));
    output.height = Math.max(1, Math.round(canvas.height * factor));

    const ctx = output.getContext('2d');
    if (!ctx) {
        return canvas;
    }

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, output.width, output.height);

    return output;
}
