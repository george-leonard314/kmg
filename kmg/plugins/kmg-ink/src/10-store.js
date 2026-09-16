// Notebook files: data/assets/kmg-ink/<id>.json.
//
// v2: {v, paper, pages: [{id, w, h, bg, strokes, items}]}
//   stroke: {id, t: pen|ball|pencil|hl|shape, c, w, p: [[x, y, pressure]], sh?, sent?}
//   item:   {type: note|reply, text, y?, h?, mode?}   (notes carry the transcribed handwriting)
//   paper.reply: {font, line} fixes the reply text size (migrated notebooks); otherwise it follows the ruling.
// v1 (kmg11-12) was one growing sheet: {height, strokes, items, asked}.

const DEFAULT_PAPER = {pattern: "lined", line: 40, thick: 2, top: 2, color: "cream"};

const emptyPage = (w = PAGE_W, h = PAGE_H) => ({id: shortId(), w, h, bg: null, strokes: [], items: []});

const newNotebook = (paper = DEFAULT_PAPER) => ({v: 2, paper: {...DEFAULT_PAPER, ...paper}, pages: [emptyPage()]});

const pageIsEmpty = (page) => !page.bg && page.strokes.length === 0 && page.items.length === 0;

const pageContent = (file, text = "") => JSON.stringify({v: 1, file}) + (text ? "\n" + text : "");

const pageMarkdown = (file, text = "") => `;;;${INFO}\n${pageContent(file, text)}\n;;;`;

// Block content: the first line is JSON metadata, the rest is the conversation as plain text (so search finds it).
const parseContent = (content) => {
    const newline = content.indexOf("\n");
    const head = newline < 0 ? content : content.slice(0, newline);
    try {
        const meta = JSON.parse(head);
        return {meta, text: newline < 0 ? "" : content.slice(newline + 1)};
    } catch {
        return {meta: null, text: content};
    }
};

const conversationText = (data) => data.pages.flatMap(page => page.items).map(item =>
    item.type === "reply" ? `AI: ${item.text}` : `Me: ${item.text}`).join("\n")
    .split("\n").filter(line => line.trim() !== ";;;").join("\n");

// v1 page breaks: as low as possible within PAGE_H, but never through a stroke or a reply.
const pageBreaks = (spans, height) => {
    const breaks = [0];
    const bottom = Math.max(height, ...spans.map(span => span[1]));
    while (bottom - breaks[breaks.length - 1] > PAGE_H) {
        const top = breaks[breaks.length - 1];
        let cut = top + PAGE_H;
        for (let tries = 0; tries < 70; tries++) {
            const blocking = spans.filter(([a, b]) => a < cut && b > cut);
            if (blocking.length === 0) {
                break;
            }
            cut = Math.min(...blocking.map(([a]) => a)) - 10;
            if (cut <= top + PAGE_H / 2) {
                cut = top + PAGE_H; // nothing clean: cut anyway
                break;
            }
        }
        breaks.push(cut);
    }
    return breaks;
};

const migrateV1 = (old) => {
    const strokes = (old.strokes || []).filter(stroke => Array.isArray(stroke.p) && stroke.p.length);
    const replies = (old.items || []).filter(item => item.type === "reply");
    const spans = [
        ...strokes.map(stroke => [Math.min(...stroke.p.map(point => point[1])), Math.max(...stroke.p.map(point => point[1]))]),
        ...replies.map(item => [item.y || 0, (item.y || 0) + (item.h || 0)]),
    ];
    const breaks = pageBreaks(spans, old.height || PAGE_H);
    const pages = breaks.map(() => emptyPage());
    const pageAt = (y) => {
        let index = breaks.length - 1;
        while (index > 0 && breaks[index] > y) {
            index--;
        }
        return {page: pages[index], offset: breaks[index]};
    };
    (old.strokes || []).forEach((stroke, index) => {
        if (!Array.isArray(stroke.p) || stroke.p.length === 0) {
            return;
        }
        const {page, offset} = pageAt(Math.min(...stroke.p.map(point => point[1])));
        page.strokes.push({
            id: shortId(),
            t: "pen",
            c: stroke.c || "#1b1b1b",
            w: Math.round((stroke.w || 3) * 1.4 * 10) / 10,
            p: stroke.p.map(([x, y, pressure]) => [x, y - offset, pressure ?? 0.5]),
            sent: index < (old.asked || 0),
        });
    });
    // A transcript belongs with the reply that follows it.
    let notes = [];
    (old.items || []).forEach(item => {
        if (item.type !== "reply") {
            notes.push({type: "note", text: item.text});
            return;
        }
        const {page, offset} = pageAt(item.y || 0);
        page.items.push(...notes, {...item, y: (item.y || 0) - offset, h: item.h || 0});
        notes = [];
    });
    if (notes.length) {
        pages[pages.length - 1].items.push(...notes);
    }
    // v1 ruled a line every 50 units, starting 50 units down, and wrote replies at 34/44 units,
    // which its handwriting was placed around.
    return {v: 2, paper: {...DEFAULT_PAPER, line: 50, thick: 1.5, top: 1, reply: {font: 34, line: 44}}, pages};
};

const normalize = (data) => {
    if (!data || typeof data !== "object") {
        return null;
    }
    if (data.v !== 2) {
        return Array.isArray(data.strokes) ? migrateV1(data) : null;
    }
    if (!Array.isArray(data.pages)) {
        return null;
    }
    data.paper = {...DEFAULT_PAPER, ...(data.paper || {})};
    data.pages.forEach(page => {
        page.id = page.id || shortId();
        page.w = page.w || PAGE_W;
        page.h = page.h || PAGE_H;
        page.bg = page.bg || null;
        page.strokes = Array.isArray(page.strokes) ? page.strokes : [];
        page.items = Array.isArray(page.items) ? page.items : [];
        page.strokes.forEach(stroke => stroke.id = stroke.id || shortId());
    });
    if (data.pages.length === 0) {
        data.pages.push(emptyPage());
    }
    return data;
};

// Resolves to the notebook, or to null when the file is missing or unreadable.
// getFile answers errors with HTTP 202 and a JSON body.
const loadNotebook = async (file) => {
    const response = await fetch("/api/file/getFile", {method: "POST", body: JSON.stringify({path: `/data/${file}`})});
    if (response.status !== 200) {
        return null;
    }
    try {
        return normalize(await response.json());
    } catch (error) {
        console.warn(`${PLUGIN}: cannot read ${file}`, error);
        return null;
    }
};

const saveNotebook = async (file, data) => {
    const form = new FormData();
    form.append("path", `/data/${file}`);
    form.append("isDir", "false");
    form.append("modTime", String(Date.now())); // milliseconds, as putFile expects
    form.append("file", new Blob([JSON.stringify(data)], {type: "application/json"}), file.split("/").pop());
    const response = await fetch("/api/file/putFile", {method: "POST", body: form});
    const result = await response.json().catch(() => ({code: -1, msg: response.statusText}));
    if (result.code !== 0) {
        throw new Error(result.msg || "putFile failed");
    }
};

// One Doc per open file, shared by the note block and the full-screen tab.
class Doc extends EventTarget {
    constructor(file, data) {
        super();
        this.file = file;
        this.data = data;
        this.users = 0;
        this.saveTimer = 0;
        this.busy = false;
        this.history = new History(this);
    }

    // What changed: {pages: [page ids] | "all", paper?: true, structure?: true}
    changed(detail = {pages: "all"}, save = true) {
        this.dispatchEvent(new CustomEvent("change", {detail}));
        if (save) {
            this.scheduleSave();
        }
    }

    scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        return saveNotebook(this.file, this.data).catch(error => {
            console.error(`${PLUGIN}: saving ${this.file} failed`, error);
            this.dispatchEvent(new CustomEvent("savefailed", {detail: error}));
        });
    }

    // Saber keeps one empty page at the end: writing on it adds the next.
    ensureTrailingPage() {
        const pages = this.data.pages;
        let changed = false;
        if (!pageIsEmpty(pages[pages.length - 1])) {
            pages.push(emptyPage());
            changed = true;
        }
        while (pages.length > 1 && pageIsEmpty(pages[pages.length - 1]) && pageIsEmpty(pages[pages.length - 2])) {
            pages.pop();
            changed = true;
        }
        return changed;
    }
}

const docs = new Map();

// A plugin reload runs this file again with a new docs map; the old copy's last saves finish first.
const FLUSH = "__kmgInkFlush";

const acquireDoc = async (file) => {
    await window[FLUSH];
    let entry = docs.get(file);
    if (!entry) {
        entry = {promise: loadNotebook(file).then(data => data && new Doc(file, data)), releaseTimer: 0};
        docs.set(file, entry);
    }
    clearTimeout(entry.releaseTimer);
    const doc = await entry.promise;
    if (!doc) {
        docs.delete(file);
        return null;
    }
    doc.users++;
    return doc;
};

// A released doc stays cached briefly: a block re-renders (and re-acquires) after every setContent.
const releaseDoc = (doc) => {
    doc.users--;
    if (doc.users > 0) {
        return null;
    }
    const saved = doc.saveTimer ? doc.save() : null;
    const entry = docs.get(doc.file);
    if (entry) {
        entry.releaseTimer = setTimeout(() => {
            if (doc.users <= 0) {
                docs.delete(doc.file);
            }
        }, 3000);
    }
    return saved;
};
