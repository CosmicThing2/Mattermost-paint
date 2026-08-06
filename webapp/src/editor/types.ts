export interface Point {
    x: number;
    y: number;
}

export type ToolId = 'select' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'emoji';

interface ShapeBase {
    id: string;
}

/** A freehand pen stroke, stored as the raw pointer path in image coordinates. */
export interface StrokeShape extends ShapeBase {
    kind: 'stroke';
    points: Point[];
    color: string;
    width: number;
}

export interface ArrowShape extends ShapeBase {
    kind: 'arrow';
    from: Point;
    to: Point;
    color: string;
    width: number;
}

export interface BoxShape extends ShapeBase {
    kind: 'rect' | 'ellipse';
    from: Point;
    to: Point;
    color: string;
    width: number;
}

/** `at` is the centre of the text block, so moving and scaling work the same
 *  way they do for stickers. */
export interface TextShape extends ShapeBase {
    kind: 'text';
    at: Point;
    text: string;
    color: string;
    size: number;
}

export interface EmojiShape extends ShapeBase {
    kind: 'emoji';
    at: Point;
    glyph: string;
    size: number;
}

export type Shape = StrokeShape | ArrowShape | BoxShape | TextShape | EmojiShape;

/** Shapes the user can select, drag and resize after they have been placed. */
export type MovableShape = TextShape | EmojiShape;

export function isMovable(shape: Shape): shape is MovableShape {
    return shape.kind === 'text' || shape.kind === 'emoji';
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
