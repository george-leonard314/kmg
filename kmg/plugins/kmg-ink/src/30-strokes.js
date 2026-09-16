// Stroke rendering. Strokes are filled outlines from perfect-freehand, in page units; the canvas
// context is scaled to the page. Settings per tool follow Saber (lib/data/tools/*.dart).

const TOOLS = {
    pen: {size: 5, sizes: [2, 3, 5, 8, 12], min: 1, max: 25},
    ball: {size: 5, sizes: [2, 3, 5, 8, 12], min: 1, max: 25},
    shape: {size: 5, sizes: [2, 3, 5, 8, 12], min: 1, max: 25},
    pencil: {size: 4, sizes: [2, 3, 4, 6, 9], min: 1, max: 15},
    hl: {size: 40, sizes: [20, 30, 40, 60, 80], min: 10, max: 100},
};

const INK_TOOLS = new Set(Object.keys(TOOLS));

const freehandOptions = (stroke) => {
    const simulatePressure = !stroke.pr;
    switch (stroke.t) {
        case "ball":
            return {size: stroke.w, thinning: 0, smoothing: 0.5, streamline: 0.5};
        case "pencil":
            return {
                size: stroke.w, thinning: 0.5, smoothing: 0.5, streamline: 0.1, simulatePressure,
                start: {taper: stroke.w * 4}, end: {taper: stroke.w * 4},
            };
        case "hl":
            return {size: stroke.w, thinning: 0, smoothing: 0.5, streamline: 0.5};
        default:
            return {size: stroke.w, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure};
    }
};

const outlines = new WeakMap();

const forgetOutline = (stroke) => outlines.delete(stroke);

const shapePath = (sh) => {
    const path = new Path2D();
    if (sh.k === "ellipse") {
        path.ellipse(sh.cx, sh.cy, Math.max(0.5, sh.rx), Math.max(0.5, sh.ry), sh.rot || 0, 0, Math.PI * 2);
        return path;
    }
    sh.pts.forEach(([x, y], index) => index ? path.lineTo(x, y) : path.moveTo(x, y));
    if (sh.k === "poly") {
        path.closePath();
    }
    return path;
};

// The outline as a smooth closed path (quadratic curves through the outline's midpoints).
const strokePath = (stroke) => {
    let path = outlines.get(stroke);
    if (path) {
        return path;
    }
    path = new Path2D();
    if (stroke.sh) {
        path = shapePath(stroke.sh);
    } else {
        const points = perfectFreehand.getStroke(stroke.p, {...freehandOptions(stroke), last: true});
        if (points.length) {
            path.moveTo(points[0][0], points[0][1]);
            for (let i = 0; i < points.length; i++) {
                const [x0, y0] = points[i];
                const [x1, y1] = points[(i + 1) % points.length];
                path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            }
            path.closePath();
        }
    }
    outlines.set(stroke, path);
    return path;
};

const luminance = (hex) => {
    const value = parseInt(hex.slice(1, 7), 16);
    if (Number.isNaN(value)) {
        return 0.5;
    }
    const channel = (shift) => ((value >> shift) & 255) / 255;
    return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
};

// On dark paper, dark ink shows light (Saber inverts the page instead; this keeps colours as chosen).
const inkColor = (color, paper) => paperColors(paper).dark && luminance(color) < 0.3 ? "#e6e6e6" : color;

const grains = new Map();

const grainPattern = (ctx, paper) => {
    const fill = paperColors(paper).fill;
    let tile = grains.get(fill);
    if (!tile) {
        tile = document.createElement("canvas");
        tile.width = tile.height = 64;
        const tileCtx = tile.getContext("2d");
        const image = tileCtx.createImageData(64, 64);
        const value = parseInt(fill.slice(1), 16);
        for (let i = 0; i < image.data.length; i += 4) {
            image.data[i] = (value >> 16) & 255;
            image.data[i + 1] = (value >> 8) & 255;
            image.data[i + 2] = value & 255;
            image.data[i + 3] = Math.random() < 0.35 ? Math.floor(Math.random() * 150) : 0;
        }
        tileCtx.putImageData(image, 0, 0);
        grains.set(fill, tile);
    }
    const pattern = ctx.createPattern(tile, "repeat");
    const scale = ctx.getTransform().a || 1;
    pattern.setTransform(new DOMMatrix().scale(1 / scale));
    return pattern;
};

// Draws one stroke; color overrides the stroke's colour (for AI images).
const drawStroke = (ctx, stroke, paper, color) => {
    const path = strokePath(stroke);
    const fill = color || inkColor(stroke.c, paper);
    if (stroke.sh) {
        ctx.save();
        ctx.strokeStyle = fill;
        ctx.lineWidth = stroke.w;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(path);
        ctx.restore();
        return;
    }
    ctx.fillStyle = fill;
    ctx.fill(path);
    if (stroke.t === "pencil" && !color) {
        ctx.save();
        ctx.clip(path);
        ctx.fillStyle = grainPattern(ctx, paper);
        const b = strokeBounds([stroke]);
        ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        ctx.restore();
    }
};

// Highlighter strokes go on their own layer, drawn opaque; the layer's CSS opacity and blend mode
// keep overlaps from darkening and the ink above them readable.
const drawHighlights = (ctx, page, paper) => page.strokes.forEach(stroke => {
    if (stroke.t === "hl") {
        drawStroke(ctx, stroke, paper);
    }
});

const drawInk = (ctx, page, paper, skip) => page.strokes.forEach(stroke => {
    if (stroke.t !== "hl" && !skip?.has(stroke)) {
        drawStroke(ctx, stroke, paper);
    }
});

const strokeBounds = (strokes) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokes.forEach(stroke => {
        const pad = stroke.w / 2;
        stroke.p.forEach(([x, y]) => {
            minX = Math.min(minX, x - pad);
            minY = Math.min(minY, y - pad);
            maxX = Math.max(maxX, x + pad);
            maxY = Math.max(maxY, y + pad);
        });
    });
    return minX === Infinity ? null : {minX, minY, maxX, maxY};
};

const distanceToSegment = (x, y, [x0, y0], [x1, y1]) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = dx * dx + dy * dy;
    const t = length ? clamp(((x - x0) * dx + (y - y0) * dy) / length, 0, 1) : 0;
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
};

const strokeHit = (stroke, x, y, radius) => {
    const reach = radius + stroke.w / 2;
    const p = stroke.p;
    if (p.length === 1) {
        return Math.hypot(x - p[0][0], y - p[0][1]) < reach;
    }
    for (let i = 1; i < p.length; i++) {
        if (distanceToSegment(x, y, p[i - 1], p[i]) < reach) {
            return true;
        }
    }
    return false;
};

const pointInPolygon = ([x, y], polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
};

// A canvas with the given strokes, black on white, cropped; for the AI to read.
const renderStrokesImage = (strokes, paper) => {
    const ink = strokes.filter(stroke => stroke.t !== "hl");
    const bounds = strokeBounds(ink);
    if (!bounds) {
        return null;
    }
    const pad = 20;
    const width = bounds.maxX - bounds.minX + pad * 2;
    const height = bounds.maxY - bounds.minY + pad * 2;
    const scale = Math.min(AI_IMAGE_MAX / width, AI_IMAGE_MAX / height, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (pad - bounds.minX) * scale, (pad - bounds.minY) * scale);
    ink.forEach(stroke => drawStroke(ctx, stroke, paper, "#000000"));
    return canvas;
};

// Stacks canvases vertically into one PNG data URL no larger than the AI image limit.
const stackImages = (canvases) => {
    const gap = 24;
    const width = Math.max(...canvases.map(item => item.width));
    const height = canvases.reduce((sum, item) => sum + item.height, 0) + gap * (canvases.length - 1);
    const scale = Math.min(1, AI_IMAGE_MAX / width, AI_IMAGE_MAX / height);
    const out = document.createElement("canvas");
    out.width = Math.ceil(width * scale);
    out.height = Math.ceil(height * scale);
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    let y = 0;
    canvases.forEach(item => {
        ctx.drawImage(item, 0, y * scale, item.width * scale, item.height * scale);
        y += item.height + gap;
    });
    return out.toDataURL("image/png");
};
