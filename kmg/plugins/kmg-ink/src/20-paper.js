// Paper: colour and ruling, per notebook. The patterns follow Saber's
// (packages/sbn/lib/canvas_background_pattern.dart and _canvas_background_painter.dart).

const PAPER_COLORS = {
    cream: {fill: "#fbf8f1", line: "rgba(80, 110, 160, .28)", margin: "rgba(200, 60, 60, .38)", dark: false},
    white: {fill: "#fcfcfc", line: "rgba(80, 110, 160, .26)", margin: "rgba(200, 60, 60, .36)", dark: false},
    dark: {fill: "#1e1f22", line: "rgba(150, 170, 210, .22)", margin: "rgba(230, 110, 110, .35)", dark: true},
};

const PATTERNS = ["blank", "lined", "college", "grid", "dots", "staffs", "tablature", "cornell"];

const paperColors = (paper) => PAPER_COLORS[paper.color] || PAPER_COLORS.cream;

// Draws the ruling of one page into ctx, which is already scaled to page units.
const drawPaper = (ctx, page, paper) => {
    const colors = paperColors(paper);
    const {w, h} = page;
    const line = paper.line;
    const top = (paper.top ?? 2) * line;
    ctx.fillStyle = colors.fill;
    ctx.fillRect(0, 0, w, h);
    if (page.bg) {
        return; // an imported page brings its own look
    }
    ctx.lineWidth = paper.thick;
    ctx.strokeStyle = colors.line;
    const hline = (y, x0 = 0, x1 = w) => {
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
    };
    const vline = (x, y0 = 0, y1 = h) => {
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
    };
    switch (paper.pattern) {
        case "lined":
            for (let y = top; y < h; y += line) {
                hline(y);
            }
            break;
        case "college":
            for (let y = top; y < h; y += line) {
                hline(y);
            }
            ctx.strokeStyle = colors.margin;
            vline(line * 2);
            break;
        case "grid":
            for (let y = line; y < h; y += line) {
                hline(y);
            }
            for (let x = line; x < w; x += line) {
                vline(x);
            }
            break;
        case "dots":
            ctx.fillStyle = colors.line;
            for (let y = line; y < h; y += line) {
                for (let x = line; x < w; x += line) {
                    ctx.beginPath();
                    ctx.arc(x, y, paper.thick * 4 / 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        case "staffs":
        case "tablature": {
            const lines = paper.pattern === "staffs" ? 5 : 6;
            const staff = (lines - 1) * line;
            for (let y = top; y + staff < h - line; y += staff + line * 3) {
                for (let i = 0; i < lines; i++) {
                    hline(y + i * line, line, w - line);
                }
            }
            break;
        }
        case "cornell": {
            const cue = w * 0.35;
            const summary = h * 0.7;
            hline(line * 2);
            hline(line * 3);
            for (let y = line * 5; y < summary; y += line) {
                hline(y);
            }
            ctx.strokeStyle = colors.margin;
            vline(cue, line * 3, summary);
            hline(summary);
            ctx.strokeStyle = colors.line;
            for (let y = summary + line * 2; y < h; y += line) {
                hline(y);
            }
            break;
        }
    }
};

// Where the next ruled line is at or below y, so replies sit on the lines.
const snapToLine = (paper, y) => {
    if (paper.pattern === "blank" || paper.pattern === "dots") {
        return y;
    }
    const top = (paper.top ?? 2) * paper.line;
    return top + Math.ceil((y - top) / paper.line) * paper.line;
};
