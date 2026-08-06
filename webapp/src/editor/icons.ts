/** Inline SVG bodies for the toolbar. Stroke and size come from CSS. */
const PATHS: Record<string, string> = {
    select: '<path d="M5 3l14 8-6 1.5L10.5 19z"/>',
    pen: '<path d="M4 20l4-1 9.5-9.5a2 2 0 0 0-3-3L5 16z"/><path d="M14 6l4 4"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M11 5h8v8"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6.5"/>',
    text: '<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>',
    emoji: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/>',
    undo: '<path d="M9 8L5 12l4 4"/><path d="M5 12h9a5 5 0 0 1 0 10h-2"/>',
    redo: '<path d="M15 8l4 4-4 4"/><path d="M19 12h-9a5 5 0 0 0 0 10h2"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    download: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
};

export function icon(name: keyof typeof PATHS | string): string {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
}
