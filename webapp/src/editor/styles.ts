/**
 * The editor ships its own stylesheet as a string rather than a .css file.
 *
 * It has to render identically in two very different hosts — a modal inside the
 * Mattermost webapp, and a bare HTML page in a phone browser — so it cannot rely
 * on the host's stylesheet, and it must not leak styles back into Mattermost.
 * Every selector is prefixed and every rule is scoped under `.mmpaint-root`.
 */
export const EDITOR_CSS = `
.mmpaint-root {
    --mmpaint-bg: #16181d;
    --mmpaint-chrome: #1f2229;
    --mmpaint-line: rgba(255, 255, 255, 0.12);
    --mmpaint-text: #e7e9ee;
    --mmpaint-muted: #9aa1b0;
    --mmpaint-accent: #4a9bff;

    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--mmpaint-bg);
    color: var(--mmpaint-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    font-size: 14px;
    line-height: 1.4;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
}

.mmpaint-root *,
.mmpaint-root *::before,
.mmpaint-root *::after {
    box-sizing: border-box;
}

.mmpaint-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 10px 12px;
    padding-top: max(10px, env(safe-area-inset-top));
    background: var(--mmpaint-chrome);
    border-bottom: 1px solid var(--mmpaint-line);
}

.mmpaint-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}

.mmpaint-subtitle {
    display: block;
    font-weight: 400;
    font-size: 12px;
    color: var(--mmpaint-muted);
    overflow: hidden;
    text-overflow: ellipsis;
}

.mmpaint-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 8px;
    background:
        repeating-conic-gradient(#1b1e24 0% 25%, #202329 0% 50%) 50% / 22px 22px;
}

.mmpaint-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    touch-action: none;
    cursor: crosshair;
    border-radius: 4px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}

.mmpaint-root[data-tool="select"] .mmpaint-canvas {
    cursor: default;
}

.mmpaint-loading,
.mmpaint-error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
    color: var(--mmpaint-muted);
}

.mmpaint-error {
    color: #ff8a8a;
}

.mmpaint-spinner {
    width: 26px;
    height: 26px;
    border: 3px solid rgba(255, 255, 255, 0.18);
    border-top-color: var(--mmpaint-accent);
    border-radius: 50%;
    animation: mmpaint-spin 0.7s linear infinite;
}

@keyframes mmpaint-spin {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    .mmpaint-spinner { animation-duration: 2s; }
}

/* Floating delete badge for the selected sticker or text box. */
.mmpaint-badge {
    position: fixed;
    z-index: 5;
    width: 30px;
    height: 30px;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #d24b4e;
    color: #fff;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
}

.mmpaint-badge[data-visible="true"] {
    display: flex;
}

.mmpaint-controls {
    position: relative;
    flex: 0 0 auto;
    background: var(--mmpaint-chrome);
    border-top: 1px solid var(--mmpaint-line);
    padding-bottom: env(safe-area-inset-bottom);
}

/* The sticker and text panels float above the toolbar rather than sitting in
   the flex column. If they took up layout space the photo would resize and
   shift under the user's finger every time a panel opened. */
.mmpaint-panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    z-index: 3;
    display: none;
    background: var(--mmpaint-chrome);
    border-top: 1px solid var(--mmpaint-line);
    box-shadow: 0 -8px 20px rgba(0, 0, 0, 0.35);
    padding: 10px 12px;
    max-height: 34vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

/* An open panel overlaps the bottom of the stage. Anchoring the photo to the
   top of the stage keeps it visible without resizing the canvas, which would
   make the image jump under the user's finger. */
.mmpaint-root[data-panel="open"] .mmpaint-stage {
    align-items: flex-start;
}

.mmpaint-panel[data-open="true"] {
    display: block;
}

.mmpaint-emoji-group-name {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--mmpaint-muted);
    margin: 6px 2px 4px;
}

.mmpaint-emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 2px;
}

.mmpaint-emoji {
    padding: 6px 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 24px;
    line-height: 1.2;
    cursor: pointer;
}

.mmpaint-emoji:hover,
.mmpaint-emoji[aria-pressed="true"] {
    background: rgba(255, 255, 255, 0.12);
}

.mmpaint-textrow {
    display: flex;
    gap: 8px;
    align-items: center;
}

.mmpaint-textinput {
    flex: 1 1 auto;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--mmpaint-line);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.28);
    color: var(--mmpaint-text);
    font: inherit;
    font-size: 16px; /* iOS zooms the page for anything smaller. */
    -webkit-user-select: text;
    user-select: text;
}

.mmpaint-textinput:focus {
    outline: 2px solid var(--mmpaint-accent);
    outline-offset: -1px;
}

.mmpaint-toolbar {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}

.mmpaint-toolbar::-webkit-scrollbar {
    display: none;
}

.mmpaint-tool {
    flex: 1 0 auto;
    min-width: 46px;
    height: 42px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--mmpaint-muted);
    cursor: pointer;
}

.mmpaint-tool:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--mmpaint-text);
}

.mmpaint-tool[aria-pressed="true"] {
    background: rgba(74, 155, 255, 0.22);
    color: #cfe3ff;
}

.mmpaint-tool:disabled {
    opacity: 0.35;
    cursor: default;
}

.mmpaint-tool svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.mmpaint-tool-label {
    font-size: 10px;
    letter-spacing: 0.01em;
}

.mmpaint-options {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px 10px;
    flex-wrap: wrap;
}

.mmpaint-swatches {
    display: flex;
    gap: 6px;
    align-items: center;
}

.mmpaint-swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5) inset;
    cursor: pointer;
}

.mmpaint-swatch[aria-pressed="true"] {
    border-color: #fff;
    transform: scale(1.12);
}

.mmpaint-custom-color {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--mmpaint-line);
    border-radius: 50%;
    background: none;
    cursor: pointer;
}

.mmpaint-size {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 130px;
    min-width: 110px;
}

.mmpaint-size input {
    width: 100%;
    accent-color: var(--mmpaint-accent);
}

.mmpaint-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 10px;
}

.mmpaint-caption {
    flex: 1 1 auto;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--mmpaint-line);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.28);
    color: var(--mmpaint-text);
    font: inherit;
    font-size: 16px;
    -webkit-user-select: text;
    user-select: text;
}

.mmpaint-button {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    padding: 0 16px;
    border: 0;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--mmpaint-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}

.mmpaint-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
}

.mmpaint-button:disabled {
    opacity: 0.45;
    cursor: default;
}

.mmpaint-button--primary {
    background: var(--mmpaint-accent);
    color: #fff;
}

.mmpaint-button--primary:hover:not(:disabled) {
    background: #3c8ced;
}

.mmpaint-icon-button {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--mmpaint-muted);
    cursor: pointer;
}

.mmpaint-icon-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: var(--mmpaint-text);
}

.mmpaint-icon-button:disabled {
    opacity: 0.3;
    cursor: default;
}

.mmpaint-icon-button svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.mmpaint-status {
    padding: 0 12px 10px;
    font-size: 12.5px;
    color: var(--mmpaint-muted);
    min-height: 0;
}

.mmpaint-status[data-kind="error"] {
    color: #ff8a8a;
}

.mmpaint-status:empty {
    display: none;
}

.mmpaint-root :focus-visible {
    outline: 2px solid var(--mmpaint-accent);
    outline-offset: 2px;
}

/* Standalone page: the editor is the whole document. */
.mmpaint-standalone,
.mmpaint-standalone body {
    margin: 0;
    height: 100%;
    overscroll-behavior: none;
    background: #16181d;
}

.mmpaint-standalone #paint-root {
    position: fixed;
    inset: 0;
}

/* Desktop modal shell rendered inside the Mattermost webapp. */
.mmpaint-overlay {
    position: fixed;
    inset: 0;
    /* Above Mattermost's own file preview modal, which the pencil is layered on. */
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3vh 3vw;
    background: rgba(0, 0, 0, 0.72);
}

.mmpaint-modal {
    width: 100%;
    height: 100%;
    max-width: 1200px;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
}

@media (max-width: 640px) {
    .mmpaint-overlay { padding: 0; }
    .mmpaint-modal { max-width: none; border-radius: 0; }
    .mmpaint-tool-label { display: none; }
    .mmpaint-tool { height: 44px; }
}

/* Pencil button layered over Mattermost's image preview. */
.mmpaint-preview {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.mmpaint-preview img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.mmpaint-preview-actions {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    gap: 8px;
}

.mmpaint-fab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 22px;
    background: rgba(20, 22, 27, 0.86);
    color: #fff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
}

.mmpaint-fab:hover {
    background: #4a9bff;
}

.mmpaint-fab svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
}
`;

let injected = false;

/** Injects the stylesheet once per document. */
export function ensureStyles(): void {
    if (injected || typeof document === 'undefined') {
        return;
    }

    const style = document.createElement('style');
    style.setAttribute('data-mmpaint', 'true');
    style.textContent = EDITOR_CSS;
    document.head.appendChild(style);
    injected = true;
}
