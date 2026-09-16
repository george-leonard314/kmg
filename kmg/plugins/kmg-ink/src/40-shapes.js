// Shape recognition for the shape pen and for a pen held still at the end of a stroke:
// line, triangle, rectangle, star, ellipse (the shapes Saber's shape pen knows).

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const pathLength = (points) => {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        length += dist(points[i - 1], points[i]);
    }
    return length;
};

const simplifyOpen = (points, epsilon) => {
    if (points.length < 3) {
        return points.slice();
    }
    let farthest = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
        const d = distanceToSegment(points[i][0], points[i][1], first, last);
        if (d > farthest) {
            farthest = d;
            index = i;
        }
    }
    if (farthest <= epsilon) {
        return [first, last];
    }
    const left = simplifyOpen(points.slice(0, index + 1), epsilon);
    return left.slice(0, -1).concat(simplifyOpen(points.slice(index), epsilon));
};

// Corners of a closed path: split at the point farthest from the start, simplify both halves.
const simplifyClosed = (points, epsilon) => {
    let index = 0;
    let farthest = 0;
    points.forEach((point, i) => {
        const d = dist(points[0], point);
        if (d > farthest) {
            farthest = d;
            index = i;
        }
    });
    const a = simplifyOpen(points.slice(0, index + 1), epsilon);
    const b = simplifyOpen(points.slice(index).concat([points[0]]), epsilon);
    return a.slice(0, -1).concat(b.slice(0, -1));
};

const polygonArea = (points) => {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
    }
    return Math.abs(area / 2);
};

const cornerAngle = (a, b, c) => {
    const v1 = [a[0] - b[0], a[1] - b[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
    return Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
};

const snapLine = (a, b) => {
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const step = Math.PI / 4;
    const snapped = Math.round(angle / step) * step;
    if (Math.abs(angle - snapped) > 5 * Math.PI / 180) {
        return [a, b];
    }
    const length = dist(a, b);
    return [a, [a[0] + Math.cos(snapped) * length, a[1] + Math.sin(snapped) * length]];
};

const fitEllipse = (points) => {
    const n = points.length;
    const cx = points.reduce((sum, p) => sum + p[0], 0) / n;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    points.forEach(([x, y]) => {
        sxx += (x - cx) ** 2;
        syy += (y - cy) ** 2;
        sxy += (x - cx) * (y - cy);
    });
    let rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Nearly axis-aligned ellipses snap straight.
    const step = Math.PI / 2;
    if (Math.abs(rot - Math.round(rot / step) * step) < 8 * Math.PI / 180) {
        rot = Math.round(rot / step) * step;
    }
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    points.forEach(([x, y]) => {
        const u = (x - cx) * cos + (y - cy) * sin;
        const v = -(x - cx) * sin + (y - cy) * cos;
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
    });
    const du = (minU + maxU) / 2;
    const dv = (minV + maxV) / 2;
    return {
        k: "ellipse",
        cx: cx + du * cos - dv * sin,
        cy: cy + du * sin + dv * cos,
        rx: (maxU - minU) / 2,
        ry: (maxV - minV) / 2,
        rot,
    };
};

const regularStar = (points, corners) => {
    const cx = corners.reduce((sum, p) => sum + p[0], 0) / corners.length;
    const cy = corners.reduce((sum, p) => sum + p[1], 0) / corners.length;
    const radii = corners.map(p => dist(p, [cx, cy]));
    const outer = Math.max(...radii);
    const tip = corners[radii.indexOf(outer)];
    const start = Math.atan2(tip[1] - cy, tip[0] - cx);
    const inner = outer * 0.382;
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 ? inner : outer;
        const a = start + i * Math.PI / 5;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return {k: "poly", pts};
};

// Returns a shape ({k: line|poly|ellipse, ...}) or null. lenient: the pen was held on purpose.
const recognizeShape = (stroke, lenient = false) => {
    const points = stroke.map(([x, y]) => [x, y]);
    if (points.length < 3) {
        return null;
    }
    const length = pathLength(points);
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (Math.max(w, h) < 12) {
        return null;
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (dist(first, last) / length >= (lenient ? 0.85 : 0.93)) {
        return {k: "line", pts: snapLine(first, last)};
    }
    if (dist(first, last) > 0.3 * Math.max(w, h)) {
        return null; // not closed
    }
    const corners = simplifyClosed(points, 0.035 * length);
    const circularity = 4 * Math.PI * polygonArea(points) / (length * length);
    const n = corners.length;
    if (n === 3) {
        return {k: "poly", pts: corners};
    }
    if (n === 4) {
        const right = corners.every((corner, i) =>
            Math.abs(cornerAngle(corners[(i + 3) % 4], corner, corners[(i + 1) % 4]) - 90) < 22);
        if (right) {
            const edge = Math.atan2(corners[1][1] - corners[0][1], corners[1][0] - corners[0][0]);
            const off = Math.abs(edge - Math.round(edge / (Math.PI / 2)) * (Math.PI / 2));
            if (off < 12 * Math.PI / 180) {
                const x0 = Math.min(...corners.map(p => p[0]));
                const x1 = Math.max(...corners.map(p => p[0]));
                const y0 = Math.min(...corners.map(p => p[1]));
                const y1 = Math.max(...corners.map(p => p[1]));
                return {k: "poly", pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]};
            }
            return {k: "poly", pts: corners};
        }
    }
    if (n >= 9 && n <= 11 && circularity < 0.6) {
        return regularStar(points, corners);
    }
    if (n >= 4 && circularity > 0.68) {
        return fitEllipse(points);
    }
    return null;
};

// Points along a shape, so bounds, erasing and the lasso treat it like any stroke.
const shapePoints = (sh) => {
    const out = [];
    if (sh.k === "ellipse") {
        for (let i = 0; i <= 64; i++) {
            const a = i / 64 * Math.PI * 2;
            const u = Math.cos(a) * sh.rx;
            const v = Math.sin(a) * sh.ry;
            const cos = Math.cos(sh.rot || 0);
            const sin = Math.sin(sh.rot || 0);
            out.push([sh.cx + u * cos - v * sin, sh.cy + u * sin + v * cos, 0.5]);
        }
        return out;
    }
    const pts = sh.k === "poly" ? sh.pts.concat([sh.pts[0]]) : sh.pts;
    for (let i = 1; i < pts.length; i++) {
        const steps = Math.max(1, Math.ceil(dist(pts[i - 1], pts[i]) / 6));
        for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
            const t = s / steps;
            out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, 0.5]);
        }
    }
    return out;
};

// Applies an affine map (x, y) => [x', y'] to a shape; ellipses are only translated and scaled.
const mapShape = (sh, map, scale = 1) => {
    if (!sh) {
        return sh;
    }
    if (sh.k === "ellipse") {
        const [cx, cy] = map(sh.cx, sh.cy);
        return {...sh, cx, cy, rx: sh.rx * scale, ry: sh.ry * scale};
    }
    return {...sh, pts: sh.pts.map(([x, y]) => map(x, y))};
};
