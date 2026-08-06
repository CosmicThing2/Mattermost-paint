/**
 * Sticker palette.
 *
 * These are plain Unicode emoji rather than Mattermost's custom emoji set: the
 * editor rasterises whatever it draws, and the browser can only paint glyphs it
 * has a font for. Keeping to standard emoji means a sticker looks the same on
 * the phone that drew it and the desktop that receives it.
 */
export const EMOJI_GROUPS: Array<{name: string; glyphs: string[]}> = [
    {
        name: 'Smileys',
        glyphs: [
            '😀', '😂', '🥰', '😍', '😎', '🤩', '😇', '🙃',
            '😉', '😜', '🤪', '😴', '🤔', '🤯', '😱', '🥳',
            '😢', '😭', '😡', '🤮', '🥺', '😬', '🙄', '💀',
        ],
    },
    {
        name: 'People',
        glyphs: [
            '👍', '👎', '👏', '🙌', '🤝', '💪', '👀', '🫶',
            '👋', '🤞', '✌️', '🤟', '🙏', '💅', '👶', '🧑',
        ],
    },
    {
        name: 'Hearts',
        glyphs: [
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
            '💔', '💕', '💖', '💘', '💯', '✨', '⭐', '🌟',
        ],
    },
    {
        name: 'Fun',
        glyphs: [
            '🎉', '🎊', '🎂', '🎁', '🍕', '🍔', '🍟', '🍩',
            '☕', '🍺', '🍷', '🌮', '🍦', '🍿', '🥑', '🍓',
        ],
    },
    {
        name: 'Things',
        glyphs: [
            '🔥', '💩', '👑', '🎯', '🚀', '💡', '📌', '🔔',
            '⚡', '💥', '❓', '❗', '✅', '❌', '🚫', '⚠️',
            '🌈', '☀️', '🌙', '☁️', '🌊', '🐶', '🐱', '🦄',
        ],
    },
];

export const DEFAULT_EMOJI = '😀';
