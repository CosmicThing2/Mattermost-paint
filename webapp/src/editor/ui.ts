import {PaintEngine} from './engine';
import {DEFAULT_EMOJI, EMOJI_GROUPS} from './emoji';
import {icon} from './icons';
import {ensureStyles} from './styles';
import {MovableShape, Point, Shape, ToolId} from './types';

/** Everything the editor needs to know about the image it is editing. */
export interface EditorSource {
    title: string;
    subtitle: string;
    imageUrl: string;
    mimeType: string;
    maxBytes: number;
    canPost: boolean;
}

export interface EditorOptions {
    /** Resolves the image to edit. Runs after mount so the editor can own its
     *  own loading and error states. */
    load: () => Promise<EditorSource>;

    /** Publishes the finished image. Rejecting shows the reason to the user and
     *  leaves the editor open so nothing is lost. */
    send: (dataUrl: string, message: string) => Promise<void>;

    /** Called when the user backs out, and after a successful send. */
    close: () => void;

    /** Hides the close button where there is nowhere to go back to. */
    allowClose?: boolean;
}

export interface EditorHandle {
    destroy: () => void;
}

const SWATCHES = [
    '#ff3b30', '#ff9500', '#ffd60a', '#34c759',
    '#0a84ff', '#bf5af2', '#ffffff', '#1c1c1e',
];

const TOOL_LABELS: Array<{id: ToolId; label: string}> = [
    {id: 'pen', label: 'Draw'},
    {id: 'arrow', label: 'Arrow'},
    {id: 'rect', label: 'Box'},
    {id: 'ellipse', label: 'Circle'},
    {id: 'text', label: 'Text'},
    {id: 'emoji', label: 'Sticker'},
    {id: 'select', label: 'Move'},
];

/** Slider position (0-100) to a multiplier on the image's natural default size. */
function sliderToScale(value: number): number {
    return 0.25 + ((value / 100) * 2.75);
}

type DragState =
    | {mode: 'draw'; shape: Shape; moved: boolean}
    | {mode: 'move'; shape: MovableShape; grab: Point; origin: Point}
    | {mode: 'resize'; shape: MovableShape; startSize: number; startDistance: number};

/**
 * Builds the editor into `container` and wires up every interaction.
 *
 * This is deliberately plain DOM rather than React: it runs both inside the
 * Mattermost webapp (where React is a shared global whose version we do not
 * control) and on a standalone page with no framework at all.
 */
export function mountEditor(container: HTMLElement, options: EditorOptions): EditorHandle {
    ensureStyles();

    const root = document.createElement('div');
    root.className = 'mmpaint-root';
    root.innerHTML = template(options.allowClose !== false);
    container.appendChild(root);

    const query = <T extends HTMLElement>(selector: string): T => {
        const found = root.querySelector<T>(selector);
        if (!found) {
            throw new Error(`Paint: missing element ${selector}`);
        }
        return found;
    };

    const stage = query('.mmpaint-stage');
    const canvas = query<HTMLCanvasElement>('.mmpaint-canvas');
    const loading = query('.mmpaint-loading');
    const errorBox = query('.mmpaint-error');
    const titleEl = query('.mmpaint-title-text');
    const subtitleEl = query('.mmpaint-subtitle');
    const badge = query<HTMLButtonElement>('.mmpaint-badge');
    const panel = query('.mmpaint-panel');
    const emojiPanel = query('.mmpaint-emoji-panel');
    const textPanel = query('.mmpaint-text-panel');
    const textInput = query<HTMLInputElement>('.mmpaint-textinput');
    const toolbar = query('.mmpaint-toolbar');
    const swatchRow = query('.mmpaint-swatches');
    const customColor = query<HTMLInputElement>('.mmpaint-custom-color');
    const sizeInput = query<HTMLInputElement>('.mmpaint-size input');
    const caption = query<HTMLInputElement>('.mmpaint-caption');
    const sendButton = query<HTMLButtonElement>('.mmpaint-send');
    const undoButton = query<HTMLButtonElement>('.mmpaint-undo');
    const redoButton = query<HTMLButtonElement>('.mmpaint-redo');
    const clearButton = query<HTMLButtonElement>('.mmpaint-clear');
    const closeButton = root.querySelector<HTMLButtonElement>('.mmpaint-close');
    const status = query('.mmpaint-status');

    const engine = new PaintEngine(canvas);

    let source: EditorSource | null = null;
    let tool: ToolId = 'pen';
    let color = SWATCHES[0];
    let strokeSlider = 40;
    let glyphSlider = 40;
    let glyph = DEFAULT_EMOJI;
    let drag: DragState | null = null;
    let editingTextId: string | null = null;
    let sending = false;
    let destroyed = false;

    // -- chrome ---------------------------------------------------------------

    function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
        status.textContent = message;
        status.setAttribute('data-kind', kind);
    }

    function isGlyphTool(): boolean {
        return tool === 'text' || tool === 'emoji';
    }

    function strokeWidth(): number {
        return Math.max(1, engine.defaultStrokeWidth() * sliderToScale(strokeSlider));
    }

    function glyphSize(): number {
        return Math.max(10, engine.defaultGlyphSize() * sliderToScale(glyphSlider));
    }

    function updateChrome(): void {
        root.dataset.tool = tool;

        toolbar.querySelectorAll<HTMLButtonElement>('.mmpaint-tool').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
        });
        swatchRow.querySelectorAll<HTMLButtonElement>('.mmpaint-swatch').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.color === color));
        });

        sizeInput.value = String(isGlyphTool() ? glyphSlider : strokeSlider);
        sizeInput.setAttribute(
            'aria-label',
            isGlyphTool() ? 'Sticker and text size' : 'Brush size',
        );

        undoButton.disabled = !engine.canUndo;
        redoButton.disabled = !engine.canRedo;
        clearButton.disabled = engine.isEmpty;
        sendButton.disabled = sending || !source || !source.canPost;

        updateBadge();
    }

    /** Parks the delete button on the corner of the current selection. */
    function updateBadge(): void {
        const selected = engine.getSelected();
        if (!selected || drag) {
            badge.setAttribute('data-visible', 'false');
            return;
        }

        const bounds = engine.boundsOf(selected);
        const corner = engine.toClientPoint({x: bounds.x, y: bounds.y});
        const stageRect = stage.getBoundingClientRect();

        // Keep the badge inside the stage even when the selection sits at the
        // very edge of the image.
        const x = Math.min(Math.max(corner.x - 15, stageRect.left + 2), stageRect.right - 32);
        const y = Math.min(Math.max(corner.y - 15, stageRect.top + 2), stageRect.bottom - 32);

        badge.style.left = `${x}px`;
        badge.style.top = `${y}px`;
        badge.setAttribute('data-visible', 'true');
    }

    function setTool(next: ToolId): void {
        // Read the selection before any of the branches below clear it, so that
        // pressing Text with a text box selected reopens that box.
        const previous = engine.getSelected();
        tool = next;

        if (next === 'emoji') {
            openPanel('emoji');
        } else if (next === 'text' && previous && previous.kind === 'text') {
            beginTextEdit(previous.id, false);
        } else if (next !== 'select') {
            closePanel();
            engine.select(null);
        }

        updateChrome();
    }

    function openPanel(which: 'emoji' | 'text'): void {
        if (which !== 'text') {
            commitTextEdit();
        }

        emojiPanel.style.display = which === 'emoji' ? '' : 'none';
        textPanel.style.display = which === 'text' ? '' : 'none';
        panel.setAttribute('data-open', 'true');
        root.dataset.panel = 'open';
        afterLayoutShift();
    }

    function closePanel(): void {
        panel.setAttribute('data-open', 'false');
        root.dataset.panel = 'closed';
        afterLayoutShift();
        commitTextEdit();
    }

    /** Opening a panel re-anchors the photo in the stage, so anything positioned
     *  against the canvas has to be measured again once the browser has laid
     *  the new arrangement out. */
    function afterLayoutShift(): void {
        window.requestAnimationFrame(updateBadge);
    }

    // -- text editing ---------------------------------------------------------

    function beginTextEdit(shapeId: string, isNew: boolean): void {
        const selected = engine.getSelected();
        if (!selected || selected.kind !== 'text' || selected.id !== shapeId) {
            return;
        }

        if (!isNew) {
            // Editing existing text is its own undo step.
            engine.beginChange();
        }

        editingTextId = shapeId;
        textInput.value = selected.text;
        openPanel('text');

        // Focus must happen in the same task as the user gesture or mobile
        // browsers refuse to raise the keyboard.
        textInput.focus();
        textInput.setSelectionRange(textInput.value.length, textInput.value.length);
    }

    /** Finishes a text edit, dropping the shape if nothing was typed. */
    function commitTextEdit(): void {
        if (!editingTextId) {
            return;
        }

        const id = editingTextId;
        editingTextId = null;

        const shape = engine.getSelected();
        if (shape && shape.kind === 'text' && shape.id === id && shape.text.trim() === '') {
            engine.discard(id);
        }

        updateChrome();
    }

    textInput.addEventListener('input', () => {
        const shape = engine.getSelected();
        if (shape && shape.kind === 'text' && shape.id === editingTextId) {
            shape.text = textInput.value;
            engine.render();
            updateBadge();
        }
    });

    textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            textInput.blur();
            closePanel();
        }
    });

    query('.mmpaint-text-done').addEventListener('click', () => {
        textInput.blur();
        closePanel();
        updateChrome();
    });

    // -- pointer interaction --------------------------------------------------

    canvas.addEventListener('pointerdown', (event) => {
        if (!source || event.button !== 0) {
            return;
        }

        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);

        const point = engine.toImagePoint(event.clientX, event.clientY);
        const selected = engine.getSelected();

        if (selected && engine.hitResizeHandle(point)) {
            const bounds = engine.boundsOf(selected);
            const centre = {x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2)};
            engine.beginChange();
            drag = {
                mode: 'resize',
                shape: selected,
                startSize: selected.size,
                startDistance: Math.max(Math.hypot(point.x - centre.x, point.y - centre.y), 1),
            };
            updateBadge();
            return;
        }

        if (tool === 'select') {
            const hit = engine.hitTest(point);
            if (!hit) {
                engine.select(null);
                return;
            }

            const wasSelected = selected?.id === hit.id;
            engine.select(hit.id);

            // Tapping an already-selected text box reopens it for editing, the
            // way a caption behaves in a photo app.
            if (wasSelected && hit.kind === 'text') {
                beginTextEdit(hit.id, false);
                return;
            }

            engine.beginChange();
            drag = {mode: 'move', shape: hit, grab: point, origin: {...hit.at}};
            updateBadge();
            return;
        }

        if (tool === 'text') {
            engine.beginChange();
            const shape = engine.addText(point, color, glyphSize());
            engine.render();
            setTool('select');
            beginTextEdit(shape.id, true);
            return;
        }

        if (tool === 'emoji') {
            engine.beginChange();
            engine.addEmoji(point, glyph, glyphSize());
            engine.render();
            setTool('select');
            updateChrome();
            return;
        }

        engine.beginChange();
        const width = strokeWidth();
        let shape: Shape;
        if (tool === 'pen') {
            shape = engine.addStroke(point, color, width);
        } else if (tool === 'arrow') {
            shape = engine.addArrow(point, color, width);
        } else {
            shape = engine.addBox(tool as 'rect' | 'ellipse', point, color, width);
        }

        drag = {mode: 'draw', shape, moved: false};
        engine.render();
        updateChrome();
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!drag) {
            return;
        }

        event.preventDefault();
        const point = engine.toImagePoint(event.clientX, event.clientY);

        if (drag.mode === 'draw') {
            drag.moved = true;
            const {shape} = drag;
            if (shape.kind === 'stroke') {
                shape.points.push(point);
            } else if (shape.kind === 'arrow' || shape.kind === 'rect' || shape.kind === 'ellipse') {
                shape.to = point;
            }
        } else if (drag.mode === 'move') {
            drag.shape.at = {
                x: drag.origin.x + (point.x - drag.grab.x),
                y: drag.origin.y + (point.y - drag.grab.y),
            };
        } else {
            const bounds = engine.boundsOf(drag.shape);
            const centre = {x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2)};
            const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
            drag.shape.size = Math.max(10, drag.startSize * (distance / drag.startDistance));
        }

        engine.render();
    });

    function endDrag(): void {
        if (!drag) {
            return;
        }

        if (drag.mode === 'draw' && !drag.moved && drag.shape.kind !== 'stroke') {
            // A drag that never moved leaves a zero-size arrow or box behind:
            // invisible, but it would still swallow the next undo.
            engine.discard(drag.shape.id);
        } else if (drag.mode === 'move' &&
            drag.shape.at.x === drag.origin.x &&
            drag.shape.at.y === drag.origin.y) {
            // Tapping a sticker to select it is not an edit.
            engine.dropLastChange();
        } else if (drag.mode === 'resize' && drag.shape.size === drag.startSize) {
            engine.dropLastChange();
        }

        drag = null;
        engine.render();
        updateChrome();
    }

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    badge.addEventListener('click', () => {
        const selected = engine.getSelected();
        if (!selected) {
            return;
        }

        engine.beginChange();
        engine.remove(selected.id);
        closePanel();
        engine.render();
        updateChrome();
    });

    // -- toolbar wiring -------------------------------------------------------

    toolbar.querySelectorAll<HTMLButtonElement>('.mmpaint-tool').forEach((button) => {
        button.addEventListener('click', () => setTool(button.dataset.tool as ToolId));
    });

    swatchRow.querySelectorAll<HTMLButtonElement>('.mmpaint-swatch').forEach((button) => {
        button.style.background = button.dataset.color || '';
        button.addEventListener('click', () => {
            color = button.dataset.color || color;
            applyColorToSelection();
            updateChrome();
        });
    });

    customColor.addEventListener('input', () => {
        color = customColor.value;
        applyColorToSelection();
        updateChrome();
    });

    /** Recolouring with something selected retints that shape, which is what
     *  people expect after placing text and then picking a colour. */
    function applyColorToSelection(): void {
        const selected = engine.getSelected();
        if (selected && selected.kind === 'text') {
            engine.beginChange();
            selected.color = color;
            engine.render();
        }
    }

    sizeInput.addEventListener('input', () => {
        const value = Number(sizeInput.value);
        if (isGlyphTool()) {
            glyphSlider = value;
        } else {
            strokeSlider = value;
        }

        const selected = engine.getSelected();
        if (selected && isGlyphTool()) {
            selected.size = glyphSize();
            engine.render();
            updateBadge();
        }
    });

    emojiPanel.querySelectorAll<HTMLButtonElement>('.mmpaint-emoji').forEach((button) => {
        button.addEventListener('click', () => {
            glyph = button.dataset.glyph || glyph;
            emojiPanel.querySelectorAll<HTMLButtonElement>('.mmpaint-emoji').forEach((other) => {
                other.setAttribute('aria-pressed', String(other === button));
            });
            setStatus('Tap the photo to place your sticker.');
        });
    });

    undoButton.addEventListener('click', () => {
        closePanel();
        engine.undo();
        updateChrome();
    });

    redoButton.addEventListener('click', () => {
        closePanel();
        engine.redo();
        updateChrome();
    });

    clearButton.addEventListener('click', () => {
        closePanel();
        engine.clearAll();
        updateChrome();
    });

    closeButton?.addEventListener('click', () => options.close());

    sendButton.addEventListener('click', () => {
        void publish();
    });

    async function publish(): Promise<void> {
        if (!source || sending) {
            return;
        }

        commitTextEdit();
        closePanel();
        engine.select(null);

        sending = true;
        updateChrome();
        setStatus('Sending…');

        try {
            const dataUrl = await engine.exportImage(source.mimeType, source.maxBytes);
            await options.send(dataUrl, caption.value);
            if (!destroyed) {
                setStatus('Sent.');
                options.close();
            }
        } catch (error) {
            setStatus(messageFor(error), 'error');
        } finally {
            sending = false;
            if (!destroyed) {
                updateChrome();
            }
        }
    }

    // -- keyboard -------------------------------------------------------------

    function onKeyDown(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

        if (event.key === 'Escape' && !typing) {
            event.preventDefault();
            options.close();
            return;
        }

        if (typing) {
            return;
        }

        const accel = event.metaKey || event.ctrlKey;
        if (accel && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) {
                engine.redo();
            } else {
                engine.undo();
            }
            updateChrome();
            return;
        }

        if ((event.key === 'Delete' || event.key === 'Backspace')) {
            const selected = engine.getSelected();
            if (selected) {
                event.preventDefault();
                engine.beginChange();
                engine.remove(selected.id);
                engine.render();
                updateChrome();
            }
        }
    }

    document.addEventListener('keydown', onKeyDown);

    // -- sizing ---------------------------------------------------------------

    function relayout(): void {
        const rect = stage.getBoundingClientRect();
        engine.layout(Math.max(rect.width - 16, 40), Math.max(rect.height - 16, 40));
        updateBadge();
    }

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout);
    observer?.observe(stage);
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);

    // -- load -----------------------------------------------------------------

    engine.onChange = updateChrome;

    options.load().then((loaded) => {
        if (destroyed) {
            return;
        }

        source = loaded;
        titleEl.textContent = loaded.title;
        subtitleEl.textContent = loaded.subtitle;

        return loadImage(loaded.imageUrl).then((image) => {
            if (destroyed) {
                return;
            }

            engine.setImage(image);
            loading.style.display = 'none';
            canvas.style.visibility = 'visible';
            relayout();

            if (!loaded.canPost) {
                setStatus('You can annotate this image, but you do not have permission to post in that channel.', 'error');
            }

            updateChrome();
        });
    }).catch((error) => {
        if (destroyed) {
            return;
        }

        loading.style.display = 'none';
        errorBox.style.display = 'flex';
        errorBox.textContent = messageFor(error);
    });

    updateChrome();

    return {
        destroy(): void {
            destroyed = true;
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', relayout);
            window.removeEventListener('orientationchange', relayout);
            observer?.disconnect();
            root.remove();
        },
    };
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();

        // No crossOrigin attribute on purpose: the image comes from the plugin's
        // own endpoint on the Mattermost origin, so it loads with the session
        // cookie and leaves the canvas untainted. Asking for CORS here would
        // make the request fail, because the endpoint sends no CORS headers.
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('That image could not be loaded.'));
        image.src = url;
    });
}

function messageFor(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Something went wrong.';
}

function emojiPanelMarkup(): string {
    return EMOJI_GROUPS.map((group) => {
        const buttons = group.glyphs.map((item) => (
            `<button type="button" class="mmpaint-emoji" data-glyph="${item}" aria-pressed="${item === DEFAULT_EMOJI}" title="${item}">${item}</button>`
        )).join('');

        return `<div class="mmpaint-emoji-group-name">${group.name}</div><div class="mmpaint-emoji-grid">${buttons}</div>`;
    }).join('');
}

function template(allowClose: boolean): string {
    const tools = TOOL_LABELS.map(({id, label}) => (
        `<button type="button" class="mmpaint-tool" data-tool="${id}" aria-pressed="false" title="${label}">` +
        `${icon(id)}<span class="mmpaint-tool-label">${label}</span></button>`
    )).join('');

    const swatches = SWATCHES.map((value) => (
        `<button type="button" class="mmpaint-swatch" data-color="${value}" aria-pressed="false" aria-label="Colour ${value}"></button>`
    )).join('');

    return `
<div class="mmpaint-header">
    <div class="mmpaint-title">
        <span class="mmpaint-title-text">Loading…</span>
        <span class="mmpaint-subtitle"></span>
    </div>
    <button type="button" class="mmpaint-icon-button mmpaint-undo" title="Undo" aria-label="Undo">${icon('undo')}</button>
    <button type="button" class="mmpaint-icon-button mmpaint-redo" title="Redo" aria-label="Redo">${icon('redo')}</button>
    <button type="button" class="mmpaint-icon-button mmpaint-clear" title="Remove all edits" aria-label="Remove all edits">${icon('trash')}</button>
    ${allowClose ? `<button type="button" class="mmpaint-icon-button mmpaint-close" title="Close" aria-label="Close">${icon('close')}</button>` : ''}
</div>
<div class="mmpaint-stage">
    <canvas class="mmpaint-canvas" style="visibility:hidden"></canvas>
    <div class="mmpaint-loading"><div class="mmpaint-spinner"></div><div>Loading photo…</div></div>
    <div class="mmpaint-error" style="display:none"></div>
</div>
<button type="button" class="mmpaint-badge" data-visible="false" title="Delete" aria-label="Delete selection">&times;</button>
<div class="mmpaint-controls">
    <div class="mmpaint-panel" data-open="false">
        <div class="mmpaint-emoji-panel">${emojiPanelMarkup()}</div>
        <div class="mmpaint-text-panel" style="display:none">
            <div class="mmpaint-textrow">
                <input type="text" class="mmpaint-textinput" placeholder="Type your text" aria-label="Text to add to the photo" autocomplete="off">
                <button type="button" class="mmpaint-button mmpaint-text-done">Done</button>
            </div>
        </div>
    </div>
    <div class="mmpaint-toolbar" role="toolbar" aria-label="Drawing tools">${tools}</div>
    <div class="mmpaint-options">
        <div class="mmpaint-swatches">
            ${swatches}
            <input type="color" class="mmpaint-custom-color" value="#ff3b30" aria-label="Custom colour">
        </div>
        <label class="mmpaint-size">
            <input type="range" min="1" max="100" value="40" aria-label="Brush size">
        </label>
    </div>
    <div class="mmpaint-footer">
        <input type="text" class="mmpaint-caption" placeholder="Add a message (optional)" aria-label="Message to send with the photo" autocomplete="off">
        <button type="button" class="mmpaint-button mmpaint-button--primary mmpaint-send">Send</button>
    </div>
    <div class="mmpaint-status" role="status" aria-live="polite"></div>
</div>`;
}
