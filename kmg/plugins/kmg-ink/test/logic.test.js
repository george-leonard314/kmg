// Tests for the parts of index.js that need no DOM: v1 migration, pages, history, shapes.
// Run: node kmg/plugins/kmg-ink/test/logic.test.js [v1-notebook.json ...]

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const siyuan = {Plugin: class {}, getFrontend: () => "desktop"};
const sandbox = {require: () => siyuan, module: {exports: {}}, console, EventTarget, CustomEvent: globalThis.CustomEvent || class extends Event {
    constructor(type, options) {
        super(type);
        this.detail = options?.detail;
    }
}};
vm.createContext(sandbox);
// Top-level const/class bindings are not globals; expose the ones under test.
vm.runInContext(`${code}\nthis.api = {migrateV1, normalize, emptyPage, newNotebook, pageIsEmpty, conversationText, Doc, History,
opAddStroke, opRemoveStrokes, opPages, pageBreaks, recognizeShape, shapePoints, pointInPolygon, snapToLine, parseContent, pageContent};`, sandbox);
const api = sandbox.api;
// Values made inside the sandbox have its own Array prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

let failed = 0;
const test = (name, fn) => {
    try {
        fn();
        console.log(`ok   ${name}`);
    } catch (error) {
        failed++;
        console.log(`FAIL ${name}\n     ${error.message}`);
    }
};

const v1 = {
    height: 3200,
    asked: 2,
    strokes: [
        {c: "#1b1b1b", w: 3, p: [[100, 100, 0.5], [120, 110, 0.5]]},
        {c: "#1f4fbf", w: 3, p: [[100, 1500, 0.5], [130, 1510, 0.6]]},
        {c: "#c62828", w: 3, p: [[200, 2900, 0.5]]},
    ],
    items: [
        {type: "note", text: "SALUT"},
        {type: "reply", text: "Hello!", y: 160, h: 120, mode: "reply"},
        {type: "note", text: "SUNT ROMAN"},
        {type: "reply", text: "Bravo", y: 1600, h: 80, mode: "reply"},
    ],
};

test("v1 notebooks become pages of 1000 x 1400", () => {
    const data = api.normalize(JSON.parse(JSON.stringify(v1)));
    assert.equal(data.v, 2);
    assert.equal(data.pages.length, 3);
    assert.deepEqual(plain(data.pages.map(page => page.strokes.length)), [1, 1, 1]);
    assert.equal(data.pages[1].strokes[0].p[0][1], 100);
    assert.deepEqual(plain(data.pages.map(page => page.strokes.map(stroke => stroke.sent))), [[true], [true], [false]]);
    assert.equal(data.pages[0].items.length, 2);
    assert.equal(data.pages[1].items[1].y, 200);
    assert.equal(data.pages[1].items[1].h, 80, "replies keep their measured height");
    assert.deepEqual(plain(data.paper.reply), {font: 34, line: 44});
    assert.equal(data.paper.line, 50);
});

test("v1 page breaks never cut through writing or a reply", () => {
    assert.deepEqual(plain(api.pageBreaks([[100, 200]], 1000)), [0]);
    assert.deepEqual(plain(api.pageBreaks([[1357, 1466], [1450, 1500]], 3000)), [0, 1347, 2747]);
    // A span taller than half a page cannot be avoided.
    assert.deepEqual(plain(api.pageBreaks([[500, 1900]], 2000)), [0, 1400]);
});

test("the conversation text survives migration in order", () => {
    const data = api.normalize(JSON.parse(JSON.stringify(v1)));
    assert.equal(api.conversationText(data), "Me: SALUT\nAI: Hello!\nMe: SUNT ROMAN\nAI: Bravo");
});

test("unknown data is refused, not replaced", () => {
    assert.equal(api.normalize(null), null);
    assert.equal(api.normalize({foo: 1}), null);
    assert.equal(api.normalize({v: 2}), null);
});

test("block content keeps its metadata line", () => {
    const content = api.pageContent("assets/kmg-ink/a.json", "Me: hi");
    const {meta, text} = api.parseContent(content);
    assert.equal(meta.file, "assets/kmg-ink/a.json");
    assert.equal(text, "Me: hi");
});

test("one empty page is kept at the end", () => {
    const doc = new api.Doc("x.json", api.newNotebook());
    assert.equal(doc.ensureTrailingPage(), false);
    doc.data.pages[0].strokes.push({id: "a", t: "pen", c: "#000", w: 5, p: [[1, 1, 0.5]]});
    assert.equal(doc.ensureTrailingPage(), true);
    assert.equal(doc.data.pages.length, 2);
    doc.data.pages.push(api.emptyPage(), api.emptyPage());
    doc.ensureTrailingPage();
    assert.equal(doc.data.pages.length, 2);
    clearTimeout(doc.saveTimer);
});

test("undo and redo of strokes and pages", () => {
    const doc = new api.Doc("x.json", api.newNotebook());
    doc.scheduleSave = () => {};
    const page = doc.data.pages[0];
    const a = {id: "a", p: [[0, 0, 0.5]]};
    const b = {id: "b", p: [[5, 5, 0.5]]};
    const c = {id: "c", p: [[9, 9, 0.5]]};
    [a, b, c].forEach(stroke => doc.history.run(api.opAddStroke(page, stroke)));
    const original = page.strokes.slice();
    page.strokes = [b];
    doc.history.push(api.opRemoveStrokes(page, [{stroke: a, index: 0}, {stroke: c, index: 2}]));
    doc.history.undo();
    assert.deepEqual(plain(page.strokes.map(s => s.id)), plain(original.map(s => s.id)));
    doc.history.redo();
    assert.deepEqual(plain(page.strokes.map(s => s.id)), ["b"]);
    const before = doc.data.pages.slice();
    const extra = api.emptyPage();
    doc.history.run(api.opPages(doc.data, before, [...before, extra]));
    assert.equal(doc.data.pages.length, 2);
    doc.history.undo();
    assert.equal(doc.data.pages.length, 1);
    doc.history.undo();
    assert.deepEqual(plain(page.strokes.map(s => s.id)), ["a", "b", "c"]);
});

const sample = (fn, n = 80) => Array.from({length: n + 1}, (_, i) => [...fn(i / n), 0.5]);
const wobble = (i) => Math.sin(i * 7.3) * 2;

test("shapes: line, rectangle, triangle, ellipse, star, scribble", () => {
    const line = api.recognizeShape(sample(t => [100 + t * 400, 300 + t * 6 + wobble(t * 80)]));
    assert.equal(line?.k, "line");
    assert.equal(line.pts[1][1], line.pts[0][1], "a near-level line snaps level");

    const rectPath = (t) => {
        const d = t * 4;
        const [x, y] = d < 1 ? [100 + d * 300, 100] : d < 2 ? [400, 100 + (d - 1) * 200] :
            d < 3 ? [400 - (d - 2) * 300, 300] : [100, 300 - (d - 3) * 200];
        return [x + wobble(t * 80), y + wobble(t * 50)];
    };
    const rect = api.recognizeShape(sample(rectPath, 160));
    assert.equal(rect?.k, "poly");
    assert.equal(rect.pts.length, 4);

    const tri = api.recognizeShape(sample(t => {
        const d = t * 3;
        const corners = [[200, 100], [350, 360], [50, 360], [200, 100]];
        const i = Math.min(2, Math.floor(d));
        const f = d - i;
        return [corners[i][0] + (corners[i + 1][0] - corners[i][0]) * f, corners[i][1] + (corners[i + 1][1] - corners[i][1]) * f];
    }, 120));
    assert.equal(tri?.k, "poly");
    assert.equal(tri.pts.length, 3);

    const ellipse = api.recognizeShape(sample(t => [300 + Math.cos(t * Math.PI * 2) * 150 + wobble(t * 80),
        300 + Math.sin(t * Math.PI * 2) * 90], 120));
    assert.equal(ellipse?.k, "ellipse");
    assert.ok(Math.abs(ellipse.rx - 150) < 12 && Math.abs(ellipse.ry - 90) < 12, JSON.stringify(ellipse));

    const star = api.recognizeShape(sample(t => {
        const d = t * 10;
        const i = Math.min(9, Math.floor(d));
        const at = (k) => {
            const r = k % 2 ? 60 : 160;
            const a = -Math.PI / 2 + k * Math.PI / 5;
            return [300 + Math.cos(a) * r, 300 + Math.sin(a) * r];
        };
        const [x0, y0] = at(i);
        const [x1, y1] = at(i + 1);
        return [x0 + (x1 - x0) * (d - i), y0 + (y1 - y0) * (d - i)];
    }, 200));
    assert.equal(star?.k, "poly");
    assert.equal(star.pts.length, 10);

    const scribble = api.recognizeShape(sample(t => [100 + t * 300, 100 + Math.sin(t * 20) * 60]));
    assert.equal(scribble, null);
});

test("shape points trace the shape", () => {
    const points = api.shapePoints({k: "poly", pts: [[0, 0], [60, 0], [60, 60]]});
    assert.ok(points.length > 10);
    assert.ok(points.every(p => p.length === 3));
    assert.ok(api.pointInPolygon([10, 10], [[0, 0], [100, 0], [100, 100], [0, 100]]));
    assert.ok(!api.pointInPolygon([150, 10], [[0, 0], [100, 0], [100, 100], [0, 100]]));
});

test("replies snap to the ruled lines", () => {
    const paper = {pattern: "lined", line: 40, top: 2};
    assert.equal(api.snapToLine(paper, 81), 120);
    assert.equal(api.snapToLine(paper, 80), 80);
    assert.equal(api.snapToLine({...paper, pattern: "blank"}, 81), 81);
});

// Real v1 files given on the command line: every stroke and item must survive.
process.argv.slice(2).forEach(file => test(`migrates ${path.basename(file)}`, () => {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    const data = api.normalize(JSON.parse(JSON.stringify(old)));
    const strokes = data.pages.flatMap(page => page.strokes);
    const items = data.pages.flatMap(page => page.items);
    assert.equal(strokes.length, old.strokes.filter(stroke => stroke.p?.length).length);
    assert.equal(items.length, old.items.length);
    assert.equal(strokes.filter(stroke => stroke.sent).length, Math.min(old.asked || 0, old.strokes.length));
    data.pages.forEach((page, index) => page.items.forEach(item => {
        if (item.type === "reply") {
            assert.ok(item.y >= 0 && item.y + item.h <= page.h, `reply on page ${index + 1} at ${item.y}+${item.h} runs off the page`);
        }
    }));
    console.log(`     ${data.pages.length} pages, ${strokes.length} strokes, ${items.length} items`);
}));

if (failed) {
    console.log(`${failed} failed`);
    process.exit(1);
}
