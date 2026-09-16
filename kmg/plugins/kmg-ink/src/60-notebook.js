// The notebook view: a column of pages with a toolbar. It runs inside the note block
// (mode "block") and in the full-screen tab (mode "tab"); both edit the same Doc.

const PEN_KINDS = ["pen", "ball", "shape"];

class NotebookView {
    constructor({plugin, element, file, mode, blockId, blockElement, setContent}) {
        this.plugin = plugin;
        this.i18n = plugin.i18n;
        this.host = element;
        this.file = file;
        this.mode = mode;
        this.blockId = blockId || "";
        this.blockElement = blockElement || null;
        this.setContent = setContent || null;
        this.views = new Map(); // page id -> page view
        this.zoom = 1;
        this.current = null;
        this.touches = new Map();
        this.gesture = null;
        this.selection = null;
        this.disposed = false;
        this.frame = 0;
        this.dirtyViews = new Set();
    }

    get settings() {
        return this.plugin.settings;
    }

    get tool() {
        return this.settings.tool || "pen";
    }

    // Colour and width belong to the tool, as in Saber.
    toolState(tool = this.tool) {
        const key = INK_TOOLS.has(tool) ? tool : this.settings.penKind || "pen";
        const tools = this.settings.tools;
        if (!tools[key]) {
            tools[key] = {c: key === "hl" ? "#fdff6b" : key === "pencil" ? "#424242" : "#1b1b1b", w: TOOLS[key].size};
        }
        return tools[key];
    }

    async start() {
        this.host.innerHTML = `<div class="kmg-ink__status kmg-ink__status--center">${this.i18n.loading}</div>`;
        await this.plugin.settingsReady;
        const doc = await acquireDoc(this.file);
        if (this.disposed) {
            if (doc) {
                releaseDoc(doc);
            }
            return;
        }
        if (!doc) {
            this.host.innerHTML = `<div class="kmg-ink__error">${this.i18n.brokenPage}</div>`;
            return;
        }
        this.doc = doc;
        this.plugin.views.add(this);
        if (this.blockId) {
            doc.blockId = this.blockId;
        }
        if (doc.ensureTrailingPage()) {
            doc.changed({pages: "all", structure: true});
        }
        this.build();
        this.onChange = (event) => this.applyChange(event.detail);
        this.onStatus = () => this.updateStatus();
        this.onSaveFailed = () => this.setStatus(this.i18n.saveFailed);
        doc.addEventListener("change", this.onChange);
        doc.addEventListener("status", this.onStatus);
        doc.addEventListener("savefailed", this.onSaveFailed);
        if (this.setContent) {
            this.writeConversation = () => this.setContent(pageContent(this.file, conversationText(doc.data)));
            doc.blockWriters = doc.blockWriters || new Set();
            doc.blockWriters.add(this.writeConversation);
        }
        this.syncPages();
        this.updateStatus();
        this.updateHistoryButtons();
    }

    dispose() {
        if (this.disposed) {
            return null;
        }
        this.disposed = true;
        this.plugin.views.delete(this);
        closePopover();
        cancelAnimationFrame(this.frame);
        this.observer?.disconnect();
        this.resizeObserver?.disconnect();
        if (this.doc) {
            this.doc.removeEventListener("change", this.onChange);
            this.doc.removeEventListener("status", this.onStatus);
            this.doc.removeEventListener("savefailed", this.onSaveFailed);
            this.doc.blockWriters?.delete(this.writeConversation);
            return releaseDoc(this.doc);
        }
        return null;
    }

    // ---- DOM ----

    build() {
        const i18n = this.i18n;
        const button = (attrs, icon, title, extra = "") =>
            `<button class="kmg-ink__tool ${extra}" ${attrs} title="${escapeHtml(title)}">${icon}</button>`;
        const fullscreen = this.mode === "block" && !isMobile() ?
            button(`data-action="fullscreen"`, ICONS.fullscreen, i18n.fullscreen) : "";
        this.host.innerHTML = `<div class="kmg-ink kmg-ink--${this.mode}" tabindex="0">
    <div class="kmg-ink__toolbar">
        <div class="kmg-ink__group">
            ${button(`data-tool="pen"`, ICONS[this.settings.penKind || "pen"], i18n.penTip)}
            ${button(`data-tool="pencil"`, ICONS.pencil, i18n.pencil)}
            ${button(`data-tool="hl"`, ICONS.hl, i18n.highlighter)}
            ${button(`data-tool="eraser"`, ICONS.eraser, i18n.eraser)}
            ${button(`data-tool="lasso"`, ICONS.lasso, i18n.lasso)}
        </div>
        <div class="kmg-ink__group">
            <button class="kmg-ink__swatch kmg-ink__swatch--current" data-action="colors" title="${i18n.color}"></button>
            <span class="kmg-ink__recent"></span>
            ${button(`data-action="size"`, ICONS.size, i18n.size)}
        </div>
        <div class="kmg-ink__group">
            ${button(`data-action="undo"`, ICONS.undo, i18n.undo)}
            ${button(`data-action="redo"`, ICONS.redo, i18n.redo)}
            ${button(`data-action="finger"`, ICONS.finger, i18n.fingerDrawing)}
        </div>
        <span class="kmg-ink__spacer"></span>
        <span class="kmg-ink__status"></span>
        <div class="kmg-ink__group">
            ${button(`data-action="paper"`, ICONS.paper, i18n.paper)}
            ${button(`data-action="pages"`, ICONS.pages, i18n.pages)}
            ${fullscreen}
        </div>
        <div class="kmg-ink__group">
            <button class="kmg-ink__text" data-action="quiz" title="${escapeHtml(i18n.quizTip)}">${i18n.quiz}</button>
            <button class="kmg-ink__ask" data-action="ask" title="${escapeHtml(i18n.askTip)}">${i18n.ask}</button>
        </div>
    </div>
    <div class="kmg-ink__scroller"><div class="kmg-ink__pages"></div></div>
</div>`;
        this.root = this.host.querySelector(".kmg-ink");
        this.toolbar = this.root.querySelector(".kmg-ink__toolbar");
        this.scrollEl = this.root.querySelector(".kmg-ink__scroller");
        this.pagesEl = this.root.querySelector(".kmg-ink__pages");
        this.statusEl = this.root.querySelector(".kmg-ink__status");
        this.live = document.createElement("canvas");
        this.live.className = "kmg-ink__live";

        this.toolbar.addEventListener("click", (event) => this.onToolbarClick(event));
        this.pagesEl.addEventListener("pointerdown", (event) => this.onPointerDown(event));
        this.pagesEl.addEventListener("pointermove", (event) => this.onPointerMove(event));
        this.pagesEl.addEventListener("pointerup", (event) => this.onPointerUp(event));
        this.pagesEl.addEventListener("pointercancel", (event) => this.onPointerUp(event, true));
        this.pagesEl.addEventListener("contextmenu", (event) => event.preventDefault());
        this.pagesEl.addEventListener("click", (event) => this.onPagesClick(event));
        this.root.addEventListener("keydown", (event) => this.onKeyDown(event));
        if (this.mode === "tab") {
            this.scrollEl.addEventListener("wheel", (event) => this.onWheel(event), {passive: false});
        }

        const scrollRoot = this.mode === "tab" ? this.scrollEl : null;
        this.observer = new IntersectionObserver((entries) => entries.forEach(entry => {
            const view = this.views.get(entry.target.dataset.page);
            if (!view) {
                return;
            }
            view.visible = entry.isIntersecting;
            if (view.visible) {
                this.renderView(view);
            } else {
                this.freeView(view);
            }
        }), {root: scrollRoot, rootMargin: "600px 0px"});
        this.resizeObserver = new ResizeObserver(() => this.layout());
        this.resizeObserver.observe(this.root);
        this.refreshToolbar();
    }

    layout() {
        if (this.mode === "tab") {
            const base = Math.min(this.scrollEl.clientWidth - 32, 1000);
            this.pagesEl.style.width = `${Math.max(200, base * this.zoom)}px`;
        }
        this.views.forEach(view => view.visible && this.markDirty(view));
    }

    syncPages() {
        const pages = this.doc.data.pages;
        const keep = new Set(pages.map(page => page.id));
        this.views.forEach((view, id) => {
            if (!keep.has(id)) {
                this.observer.unobserve(view.el);
                view.el.remove();
                this.views.delete(id);
            }
        });
        pages.forEach((page, index) => {
            let view = this.views.get(page.id);
            if (!view) {
                view = this.createView(page);
                this.views.set(page.id, view);
                this.observer.observe(view.el);
            }
            view.page = page;
            view.el.style.aspectRatio = `${page.w} / ${page.h}`;
            view.number.textContent = `${index + 1} / ${pages.length}`;
            if (this.pagesEl.children[index] !== view.el) {
                this.pagesEl.insertBefore(view.el, this.pagesEl.children[index] || null);
            }
        });
        if (this.selection && !keep.has(this.selection.page.id)) {
            this.clearSelection();
        }
        this.layout();
    }

    createView(page) {
        const el = document.createElement("div");
        el.className = "kmg-ink__page";
        el.dataset.page = page.id;
        el.innerHTML = `<canvas class="kmg-ink__bg"></canvas><canvas class="kmg-ink__hl"></canvas><canvas class="kmg-ink__ink"></canvas>
<div class="kmg-ink__replies"></div><div class="kmg-ink__number"></div>`;
        return {
            page,
            el,
            bg: el.querySelector(".kmg-ink__bg"),
            hl: el.querySelector(".kmg-ink__hl"),
            ink: el.querySelector(".kmg-ink__ink"),
            replies: el.querySelector(".kmg-ink__replies"),
            number: el.querySelector(".kmg-ink__number"),
            visible: false,
            size: "",
            repliesKey: "",
        };
    }

    freeView(view) {
        [view.bg, view.hl, view.ink].forEach(canvas => {
            canvas.width = 0;
            canvas.height = 0;
        });
        view.size = "";
    }

    markDirty(view) {
        this.dirtyViews.add(view);
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                const views = [...this.dirtyViews];
                this.dirtyViews.clear();
                views.forEach(item => item.visible && this.renderView(item));
                if (this.current?.kind === "ink" || this.current?.kind === "lasso") {
                    this.drawLive();
                }
            });
        }
    }

    // Canvas backing size: device pixels, capped so a zoomed page stays within 12 megapixels.
    canvasMetrics(view) {
        const cssW = view.el.clientWidth;
        const page = view.page;
        const s = cssW / page.w;
        const cssH = page.h * s;
        const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(12e6 / Math.max(1, cssW * cssH)));
        return {s, ratio, width: Math.round(cssW * ratio), height: Math.round(cssH * ratio)};
    }

    renderView(view) {
        if (this.disposed || !view.el.isConnected) {
            return;
        }
        const {s, ratio, width, height} = this.canvasMetrics(view);
        if (!width) {
            return;
        }
        const paper = this.doc.data.paper;
        const size = `${width}x${height}`;
        const resized = view.size !== size;
        [view.bg, view.hl, view.ink].forEach(canvas => {
            if (resized) {
                canvas.width = width;
                canvas.height = height;
            }
        });
        view.size = size;
        const context = (canvas) => {
            const ctx = canvas.getContext("2d");
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.setTransform(ratio * s, 0, 0, ratio * s, 0, 0);
            return ctx;
        };
        drawPaper(context(view.bg), view.page, paper);
        this.drawBackground?.(view, context(view.bg), s, ratio);
        drawHighlights(context(view.hl), view.page, paper);
        drawInk(context(view.ink), view.page, paper);
        view.el.classList.toggle("kmg-ink__page--dark", paperColors(paper).dark);
        this.renderReplies(view, s);
        this.renderSelection(view, s);
    }

    renderReplies(view, s) {
        const page = view.page;
        const paper = this.doc.data.paper;
        const line = paper.reply?.line || (paper.pattern === "blank" || paper.pattern === "dots" ? 44 : paper.line);
        // Measuring a reply sets its h; that alone does not rebuild the replies.
        const key = JSON.stringify([page.items.map(item => [item.type, item.text, item.y]), line, paper.color]);
        const box = view.replies;
        box.style.width = `${page.w}px`;
        box.style.height = `${page.h}px`;
        box.style.transform = `scale(${s})`;
        if (key === view.repliesKey) {
            return;
        }
        view.repliesKey = key;
        box.style.lineHeight = `${line}px`;
        box.style.fontSize = `${paper.reply?.font || Math.round(clamp(line * 0.78, 24, 60))}px`;
        box.style.color = paperColors(paper).dark ? REPLY_COLOR_DARK : REPLY_COLOR;
        const fresh = view.freshReply;
        view.freshReply = null;
        box.innerHTML = "";
        page.items.forEach((item, index) => {
            if (item.type !== "reply") {
                return;
            }
            const reply = document.createElement("div");
            reply.className = "kmg-ink__reply";
            reply.dataset.index = String(index);
            reply.style.top = `${item.y}px`;
            reply.style.left = `${REPLY_LEFT}px`;
            reply.style.width = `${REPLY_WIDTH}px`;
            reply.textContent = item.text;
            if (item === fresh) {
                reply.classList.add("kmg-ink__reply--new");
            }
            box.append(reply);
        });
        this.measureReplies(view);
    }

    // A reply's height is measured once, after the handwriting font has loaded. One that runs off
    // the page moves to the top of the next page.
    async measureReplies(view) {
        const page = view.page;
        if (!page.items.some(item => item.type === "reply" && !item.h)) {
            return;
        }
        await document.fonts.load(`40px "KMG Ink Hand"`).catch(() => null);
        if (this.disposed || !view.el.isConnected) {
            return;
        }
        let changed = false;
        view.replies.querySelectorAll(".kmg-ink__reply").forEach(element => {
            const item = page.items[Number(element.dataset.index)];
            if (!item || item.h || !element.offsetHeight) {
                return;
            }
            item.h = element.offsetHeight + 10;
            changed = true;
            if (item.y + item.h > page.h - 20 && item.y > this.firstLineTop()) {
                this.moveReplyToNextPage(page, item);
            }
        });
        if (changed) {
            this.doc.ensureTrailingPage();
            this.doc.changed({pages: "all", structure: true});
        }
    }

    firstLineTop() {
        const paper = this.doc.data.paper;
        return this.replyTop(snapToLine(paper, (paper.top ?? 2) * paper.line), 0);
    }

    moveReplyToNextPage(page, item) {
        const pages = this.doc.data.pages;
        const index = pages.indexOf(page);
        let next = pages[index + 1];
        if (!next || next.bg || next.strokes.some(stroke => strokeBounds([stroke]).minY < item.h + 80)) {
            next = emptyPage(page.w, page.h);
            pages.splice(index + 1, 0, next);
        }
        const at = page.items.indexOf(item);
        // The transcript before the reply moves with it.
        const start = at > 0 && page.items[at - 1].type === "note" ? at - 1 : at;
        const moved = page.items.splice(start, at - start + 1);
        const top = this.firstLineTop();
        moved.forEach(entry => {
            if (entry.type === "reply") {
                entry.y = top;
            }
        });
        next.items.push(...moved);
    }

    // The top of a reply box whose first line of text sits on the ruled line at lineY.
    replyTop(lineY, bottom) {
        const paper = this.doc.data.paper;
        if (paper.pattern === "blank" || paper.pattern === "dots") {
            return Math.round(bottom + 24);
        }
        return Math.round(lineY - paper.line * 0.88);
    }

    renderSelection(view, s) {
        view.el.querySelector(".kmg-ink__sel")?.remove();
        view.el.querySelector(".kmg-ink__selbar")?.remove();
        const selection = this.selection;
        if (!selection || selection.page !== view.page) {
            return;
        }
        const b = strokeBounds([...selection.strokes]);
        if (!b) {
            return;
        }
        selection.bounds = b;
        const box = document.createElement("div");
        box.className = "kmg-ink__sel";
        box.style.left = `${b.minX * s - 4}px`;
        box.style.top = `${b.minY * s - 4}px`;
        box.style.width = `${(b.maxX - b.minX) * s + 8}px`;
        box.style.height = `${(b.maxY - b.minY) * s + 8}px`;
        box.innerHTML = `<div class="kmg-ink__handle"></div>`;
        view.el.append(box);
        if (this.current?.kind === "move" || this.current?.kind === "scale") {
            return;
        }
        const bar = document.createElement("div");
        bar.className = "kmg-ink__selbar";
        bar.innerHTML = `<button data-sel="duplicate" title="${this.i18n.duplicate}">${ICONS.copy}</button>
<button data-sel="delete" title="${this.i18n.delete}">${ICONS.trash}</button>
${this.plugin.explainSelection ? `<button data-sel="explain" title="${this.i18n.explainTip}">${ICONS.sparkle}<span>${this.i18n.explain}</span></button>` : ""}`;
        bar.style.left = `${Math.max(0, b.minX * s - 4)}px`;
        const above = b.minY * s - 46;
        bar.style.top = `${above > 0 ? above : (b.maxY * s + 10)}px`;
        view.el.append(bar);
    }

    // ---- status and toolbar ----

    setStatus(text) {
        if (this.statusEl) {
            this.statusEl.textContent = text;
        }
    }

    updateStatus() {
        this.root?.classList.toggle("kmg-ink--busy", !!this.doc.busy);
        this.setStatus(this.doc.busy ? this.i18n.thinking : "");
    }

    updateHistoryButtons() {
        if (!this.toolbar) {
            return;
        }
        this.toolbar.querySelector('[data-action="undo"]').disabled = this.doc.history.done.length === 0;
        this.toolbar.querySelector('[data-action="redo"]').disabled = this.doc.history.undone.length === 0;
    }

    refreshToolbar() {
        const tool = this.tool;
        const penKind = this.settings.penKind || "pen";
        this.toolbar.querySelectorAll("[data-tool]").forEach(item => {
            const on = item.dataset.tool === tool || (item.dataset.tool === "pen" && PEN_KINDS.includes(tool));
            item.classList.toggle("kmg-ink__tool--on", on);
        });
        this.toolbar.querySelector('[data-tool="pen"]').innerHTML = ICONS[penKind];
        const state = this.toolState();
        const current = this.toolbar.querySelector(".kmg-ink__swatch--current");
        current.style.background = state.c;
        this.toolbar.querySelector(".kmg-ink__recent").innerHTML = this.settings.recent.slice(0, 3).map(color =>
            `<button class="kmg-ink__swatch" data-color="${color}" style="background:${color}" title="${color}"></button>`).join("");
        this.toolbar.querySelector('[data-action="finger"]').classList.toggle("kmg-ink__tool--on", this.settings.fingerDraw !== false);
        this.root.classList.toggle("kmg-ink--lasso", tool === "lasso");
        this.root.classList.toggle("kmg-ink--eraser", tool === "eraser");
    }

    setTool(tool) {
        if (PEN_KINDS.includes(tool)) {
            this.settings.penKind = tool;
        }
        if (tool !== "lasso") {
            this.clearSelection();
        }
        this.settings.tool = tool;
        this.plugin.saveSettings();
        this.refreshToolbar();
    }

    useColor(color) {
        if (this.selection) {
            const strokes = [...this.selection.strokes];
            this.doc.history.run(opRecolor(this.selection.page, strokes, color));
        } else {
            if (!INK_TOOLS.has(this.tool)) {
                this.setTool(this.settings.penKind || "pen");
            }
            this.toolState().c = color;
        }
        const recent = this.settings.recent.filter(item => item !== color);
        recent.unshift(color);
        this.settings.recent = recent.slice(0, 5);
        this.plugin.saveSettings();
        this.refreshToolbar();
    }

    onToolbarClick(event) {
        const button = event.target.closest("button");
        if (!button || button.disabled) {
            return;
        }
        const tool = button.dataset.tool;
        if (tool) {
            const active = button.classList.contains("kmg-ink__tool--on");
            if (tool === "pen") {
                if (active) {
                    this.openPenMenu(button);
                } else {
                    this.setTool(this.settings.penKind || "pen");
                }
            } else if (active && INK_TOOLS.has(tool)) {
                this.openSizeMenu(button);
            } else {
                this.setTool(tool);
            }
            return;
        }
        if (button.dataset.color) {
            this.useColor(button.dataset.color);
            return;
        }
        switch (button.dataset.action) {
            case "colors":
                this.openColorMenu(button);
                break;
            case "size":
                this.openSizeMenu(button);
                break;
            case "undo":
                this.clearSelection();
                this.doc.history.undo();
                break;
            case "redo":
                this.clearSelection();
                this.doc.history.redo();
                break;
            case "finger":
                this.settings.fingerDraw = this.settings.fingerDraw === false;
                this.plugin.saveSettings();
                this.refreshToolbar();
                break;
            case "paper":
                this.openPaperMenu(button);
                break;
            case "pages":
                this.openPagesMenu(button);
                break;
            case "fullscreen":
                this.plugin.openNotebookTab(this.file, this.blockId, this.blockElement);
                break;
            case "ask":
                this.ask("reply");
                break;
            case "quiz":
                this.ask("quiz");
                break;
        }
    }

    openPenMenu(anchor) {
        const i18n = this.i18n;
        const kinds = {pen: i18n.fountainPen, ball: i18n.ballpoint, shape: i18n.shapePen};
        const popover = openPopover(anchor, `<div class="kmg-ink-popover__row">${PEN_KINDS.map(kind =>
            `<button class="kmg-ink-popover__choice${this.tool === kind ? " kmg-ink-popover__choice--on" : ""}" data-kind="${kind}">${ICONS[kind]}<span>${kinds[kind]}</span></button>`).join("")}</div>
${this.sizeControls()}`);
        popover.addEventListener("click", (event) => {
            const kind = event.target.closest("[data-kind]")?.dataset.kind;
            if (kind) {
                this.setTool(kind);
                closePopover();
            }
        });
        this.bindSizeControls(popover);
    }

    sizeControls() {
        const tool = INK_TOOLS.has(this.tool) ? this.tool : this.settings.penKind || "pen";
        const spec = TOOLS[tool];
        const state = this.toolState(tool);
        return `<div class="kmg-ink-popover__title">${this.i18n.size}</div>
<div class="kmg-ink-popover__row">${spec.sizes.map(size =>
            `<button class="kmg-ink-popover__size${size === state.w ? " kmg-ink-popover__choice--on" : ""}" data-size="${size}"><span style="width:${Math.min(28, 4 + size * 28 / spec.max)}px;height:${Math.min(28, 4 + size * 28 / spec.max)}px"></span></button>`).join("")}</div>
<input class="kmg-ink-popover__range" type="range" min="${spec.min}" max="${spec.max}" step="1" value="${state.w}">`;
    }

    bindSizeControls(popover) {
        const tool = INK_TOOLS.has(this.tool) ? this.tool : this.settings.penKind || "pen";
        const set = (size) => {
            this.toolState(tool).w = size;
            this.plugin.saveSettings();
            popover.querySelectorAll("[data-size]").forEach(item =>
                item.classList.toggle("kmg-ink-popover__choice--on", Number(item.dataset.size) === size));
            popover.querySelector(".kmg-ink-popover__range").value = String(size);
        };
        popover.addEventListener("click", (event) => {
            const size = event.target.closest("[data-size]")?.dataset.size;
            if (size) {
                set(Number(size));
            }
        });
        popover.querySelector(".kmg-ink-popover__range").addEventListener("input", (event) => set(Number(event.target.value)));
    }

    openSizeMenu(anchor) {
        if (!INK_TOOLS.has(this.tool)) {
            this.setTool(this.settings.penKind || "pen");
        }
        const popover = openPopover(anchor, this.sizeControls());
        this.bindSizeControls(popover);
    }

    openColorMenu(anchor) {
        const i18n = this.i18n;
        const row = (title, colors) => colors.length ? `<div class="kmg-ink-popover__title">${title}</div><div class="kmg-ink-popover__row">${colors.map(color =>
            `<button class="kmg-ink__swatch" data-color="${color}" style="background:${color}" title="${color}"></button>`).join("")}</div>` : "";
        const state = this.toolState();
        const popover = openPopover(anchor, `${row(i18n.recentColors, this.settings.recent)}
${row(i18n.colors, PALETTE.main)}${row(i18n.pastel, PALETTE.pastel)}${row(i18n.greys, PALETTE.grey)}
<label class="kmg-ink-popover__custom">${i18n.customColor} <input type="color" value="${state.c}"></label>`);
        popover.addEventListener("click", (event) => {
            const color = event.target.closest("[data-color]")?.dataset.color;
            if (color) {
                this.useColor(color);
                closePopover();
            }
        });
        popover.querySelector("input[type=color]").addEventListener("change", (event) => {
            this.useColor(event.target.value);
            closePopover();
        });
    }

    openPaperMenu(anchor) {
        const i18n = this.i18n;
        const paper = this.doc.data.paper;
        const names = {
            blank: i18n.patternBlank, lined: i18n.patternLined, college: i18n.patternCollege, grid: i18n.patternGrid,
            dots: i18n.patternDots, staffs: i18n.patternStaffs, tablature: i18n.patternTablature, cornell: i18n.patternCornell,
        };
        const popover = openPopover(anchor, `<div class="kmg-ink-popover__title">${i18n.paper}</div>
<div class="kmg-ink-popover__grid">${PATTERNS.map(pattern => `<button class="kmg-ink-popover__pattern${paper.pattern === pattern ? " kmg-ink-popover__choice--on" : ""}" data-pattern="${pattern}"><canvas width="84" height="112"></canvas><span>${names[pattern]}</span></button>`).join("")}</div>
<label class="kmg-ink-popover__label">${i18n.lineHeight} <input type="range" data-paper="line" min="20" max="100" step="5" value="${paper.line}"></label>
<label class="kmg-ink-popover__label">${i18n.lineThickness} <input type="range" data-paper="thick" min="1" max="5" step="0.5" value="${paper.thick}"></label>
<div class="kmg-ink-popover__title">${i18n.paperColor}</div>
<div class="kmg-ink-popover__row">${Object.keys(PAPER_COLORS).map(key => `<button class="kmg-ink-popover__choice${paper.color === key ? " kmg-ink-popover__choice--on" : ""}" data-paper-color="${key}"><span class="kmg-ink__swatch" style="background:${PAPER_COLORS[key].fill}"></span><span>${i18n["paper_" + key]}</span></button>`).join("")}</div>
${this.plugin.pdfImport ? `<button class="kmg-ink-popover__wide" data-action="import-pdf">${ICONS.pdf}<span>${i18n.importPdf}</span></button>` : ""}`, "kmg-ink-popover--paper");
        const previews = () => popover.querySelectorAll("[data-pattern]").forEach(item => {
            const canvas = item.querySelector("canvas");
            const ctx = canvas.getContext("2d");
            ctx.setTransform(84 / PAGE_W, 0, 0, 84 / PAGE_W, 0, 0);
            drawPaper(ctx, {w: PAGE_W, h: PAGE_H, bg: null}, {...this.doc.data.paper, pattern: item.dataset.pattern});
        });
        previews();
        const change = (patch) => {
            const next = {...this.doc.data.paper, ...patch};
            this.doc.history.run(opPaper(this.doc.data, next));
            this.settings.paper = next;
            this.plugin.saveSettings();
            popover.querySelectorAll("[data-pattern]").forEach(item =>
                item.classList.toggle("kmg-ink-popover__choice--on", item.dataset.pattern === next.pattern));
            popover.querySelectorAll("[data-paper-color]").forEach(item =>
                item.classList.toggle("kmg-ink-popover__choice--on", item.dataset.paperColor === next.color));
            previews();
        };
        popover.addEventListener("click", (event) => {
            const pattern = event.target.closest("[data-pattern]")?.dataset.pattern;
            const color = event.target.closest("[data-paper-color]")?.dataset.paperColor;
            if (pattern) {
                change({pattern});
            } else if (color) {
                change({color});
            } else if (event.target.closest('[data-action="import-pdf"]')) {
                closePopover();
                this.plugin.pdfImport(this);
            }
        });
        popover.querySelectorAll("input[data-paper]").forEach(input => input.addEventListener("change", () =>
            change({[input.dataset.paper]: Number(input.value)})));
    }

    openPagesMenu(anchor) {
        const i18n = this.i18n;
        const popover = openPopover(anchor, `<div class="kmg-ink-popover__title">${i18n.pages}</div><div class="kmg-ink-popover__pages"></div>`, "kmg-ink-popover--pages");
        const list = popover.querySelector(".kmg-ink-popover__pages");
        const render = () => {
            const pages = this.doc.data.pages;
            list.innerHTML = pages.map((page, index) => `<div class="kmg-ink-popover__page" data-index="${index}">
    <canvas class="kmg-ink-popover__thumb" data-go="${index}" width="${Math.round(70 * page.w / page.h * 1.4)}" height="98" title="${i18n.goToPage}"></canvas>
    <span class="kmg-ink-popover__pageno">${index + 1}</span>
    <span class="kmg-ink__spacer"></span>
    <button data-page-op="up" title="${i18n.moveUp}" ${index === 0 ? "disabled" : ""}>${ICONS.up}</button>
    <button data-page-op="down" title="${i18n.moveDown}" ${index === pages.length - 1 ? "disabled" : ""}>${ICONS.down}</button>
    <button data-page-op="insert" title="${i18n.insertPageAfter}">${ICONS.add}</button>
    <button data-page-op="duplicate" title="${i18n.duplicatePage}">${ICONS.copy}</button>
    <button data-page-op="clear" title="${i18n.clearPage}">${ICONS.clear}</button>
    <button data-page-op="delete" title="${i18n.deletePage}" ${pages.length === 1 ? "disabled" : ""}>${ICONS.trash}</button>
</div>`).join("");
            list.querySelectorAll("canvas").forEach(canvas => {
                const page = pages[Number(canvas.dataset.go)];
                const ctx = canvas.getContext("2d");
                const s = canvas.width / page.w;
                ctx.setTransform(s, 0, 0, s, 0, 0);
                drawPaper(ctx, page, this.doc.data.paper);
                const view = this.views.get(page.id);
                if (view?.size && page.bg) {
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.drawImage(view.bg, 0, 0, canvas.width, canvas.height);
                    ctx.setTransform(s, 0, 0, s, 0, 0);
                }
                drawHighlights(ctx, page, this.doc.data.paper);
                drawInk(ctx, page, this.doc.data.paper);
            });
        };
        render();
        popover.addEventListener("click", (event) => {
            const go = event.target.closest("[data-go]")?.dataset.go;
            if (go !== undefined) {
                const page = this.doc.data.pages[Number(go)];
                this.views.get(page.id)?.el.scrollIntoView({block: "start", behavior: "smooth"});
                return;
            }
            const button = event.target.closest("[data-page-op]");
            if (!button) {
                return;
            }
            const index = Number(button.closest("[data-index]").dataset.index);
            this.pageOperation(button.dataset.pageOp, index);
            render();
        });
    }

    pageOperation(operation, index) {
        const data = this.doc.data;
        const before = data.pages.slice();
        const after = data.pages.slice();
        const page = after[index];
        switch (operation) {
            case "up":
                after.splice(index - 1, 0, after.splice(index, 1)[0]);
                break;
            case "down":
                after.splice(index + 1, 0, after.splice(index, 1)[0]);
                break;
            case "insert":
                after.splice(index + 1, 0, emptyPage(page.w, page.h));
                break;
            case "duplicate": {
                const copy = JSON.parse(JSON.stringify(page));
                copy.id = shortId();
                copy.items = [];
                copy.strokes.forEach(stroke => {
                    stroke.id = shortId();
                    stroke.sent = false;
                });
                after.splice(index + 1, 0, copy);
                break;
            }
            case "delete":
                after.splice(index, 1);
                break;
            case "clear": {
                // A cleared page is a new, empty page object in the same place, so undo brings the old one back.
                const cleared = emptyPage(page.w, page.h);
                cleared.bg = page.bg;
                after.splice(index, 1, cleared);
                break;
            }
        }
        this.clearSelection();
        this.doc.history.run(opPages(data, before, after));
        if (this.doc.ensureTrailingPage()) {
            this.doc.changed({pages: "all", structure: true});
        }
    }

    // ---- changes from the doc ----

    applyChange(detail) {
        if (!this.root) {
            return;
        }
        if (detail.structure) {
            this.syncPages();
        }
        if (detail.pages === "all") {
            this.views.forEach(view => view.visible && this.markDirty(view));
        } else {
            detail.pages.forEach(id => {
                const view = this.views.get(id);
                if (view?.visible) {
                    this.markDirty(view);
                }
            });
        }
        this.updateHistoryButtons();
    }

    // ---- input ----

    pagePoint(event, view) {
        const rect = view.el.getBoundingClientRect();
        const s = rect.width / view.page.w;
        return [
            Math.round((event.clientX - rect.left) / s * 10) / 10,
            Math.round((event.clientY - rect.top) / s * 10) / 10,
            event.pointerType === "pen" ? Math.round((event.pressure || 0.5) * 100) / 100 : 0.5,
        ];
    }

    viewAt(event) {
        const el = event.target.closest?.(".kmg-ink__page");
        return el ? this.views.get(el.dataset.page) : null;
    }

    scroller() {
        return this.mode === "tab" ? this.scrollEl : this.host.closest(".protyle-content");
    }

    onPointerDown(event) {
        if (event.target.closest(".kmg-ink__selbar")) {
            return;
        }
        const view = this.viewAt(event);
        if (!view || this.doc.busy) {
            return;
        }
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }
        if (event.pointerType === "touch") {
            this.touches.set(event.pointerId, {x: event.clientX, y: event.clientY});
            this.pagesEl.setPointerCapture(event.pointerId);
            if (this.current?.pointerType === "touch") {
                this.cancelCurrent(); // a second finger: the first was not drawing
            }
            if (this.settings.fingerDraw === false || this.touches.size > 1 || this.current) {
                event.preventDefault();
                this.startGesture();
                return;
            }
        }
        if (event.pointerType === "pen" && !this.penSeen) {
            this.penSeen = true;
            if (this.settings.fingerDraw !== false && this.settings.fingerAuto !== false) {
                this.settings.fingerDraw = false;
                this.plugin.saveSettings();
                this.refreshToolbar();
            }
        }
        if (this.current) {
            return;
        }
        event.preventDefault();
        this.pagesEl.setPointerCapture(event.pointerId);
        this.root.focus({preventScroll: true});
        closePopover();
        const point = this.pagePoint(event, view);
        const base = {id: event.pointerId, pointerType: event.pointerType, view};
        const penEraser = event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) || (event.buttons & 2));
        if (this.tool === "eraser" || penEraser) {
            this.current = {...base, kind: "erase", original: view.page.strokes.slice(), last: point};
            this.eraseAt(view, point);
            return;
        }
        if (this.tool === "lasso") {
            const selection = this.selection;
            if (selection && selection.page === view.page && selection.bounds) {
                const b = selection.bounds;
                const s = view.el.clientWidth / view.page.w;
                const handle = Math.hypot(point[0] - b.maxX, point[1] - b.maxY) < 22 / s;
                const inside = point[0] >= b.minX && point[0] <= b.maxX && point[1] >= b.minY && point[1] <= b.maxY;
                if (handle || inside) {
                    const strokes = [...selection.strokes];
                    this.current = {
                        ...base,
                        kind: handle ? "scale" : "move",
                        start: point,
                        bounds: {...b},
                        before: strokes.map(stroke => ({stroke, p: stroke.p, sh: stroke.sh})),
                    };
                    this.renderSelection(view, s);
                    return;
                }
            }
            this.clearSelection();
            this.current = {...base, kind: "lasso", points: [point]};
            this.attachLive(view);
            return;
        }
        const tool = this.tool;
        const state = this.toolState(tool);
        const stroke = {id: shortId(), t: tool, c: state.c, w: state.w, p: [point], pr: event.pointerType === "pen"};
        this.current = {...base, kind: "ink", stroke, anchor: point};
        this.attachLive(view);
        this.armHold();
    }

    onPointerMove(event) {
        if (this.touches.has(event.pointerId) && (!this.current || this.current.id !== event.pointerId)) {
            this.touches.set(event.pointerId, {x: event.clientX, y: event.clientY});
            if (this.gesture) {
                event.preventDefault();
                this.updateGesture();
            }
            return;
        }
        const current = this.current;
        if (!current || current.id !== event.pointerId) {
            return;
        }
        event.preventDefault();
        const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
        const view = current.view;
        for (const item of events.length ? events : [event]) {
            const point = this.pagePoint(item, view);
            if (current.kind === "erase") {
                // Pointer events can be far apart on a fast swipe: erase along the way.
                const steps = Math.max(1, Math.ceil(dist(current.last, point) / 5));
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    this.eraseAt(view, [current.last[0] + (point[0] - current.last[0]) * t, current.last[1] + (point[1] - current.last[1]) * t]);
                }
                current.last = point;
            } else if (current.kind === "lasso") {
                current.points.push(point);
            } else if (current.kind === "ink") {
                if (current.frozen) {
                    break;
                }
                const points = current.stroke.p;
                const last = points[points.length - 1];
                if (Math.abs(last[0] - point[0]) + Math.abs(last[1] - point[1]) < 0.8) {
                    continue;
                }
                points.push(point);
                if (dist(point, current.anchor) > 4) {
                    current.anchor = point;
                    this.armHold();
                }
            } else {
                this.transformSelection(point);
            }
        }
        if (current.kind === "ink") {
            forgetOutline(current.stroke);
        }
        if (current.kind === "ink" || current.kind === "lasso") {
            this.scheduleLive();
        }
    }

    onPointerUp(event, cancelled = false) {
        if (this.touches.has(event.pointerId)) {
            this.touches.delete(event.pointerId);
            if (this.gesture && (!this.current || this.current.id !== event.pointerId)) {
                if (this.touches.size === 0) {
                    this.gesture = null;
                    this.layout();
                } else {
                    this.startGesture();
                }
                return;
            }
        }
        const current = this.current;
        if (!current || current.id !== event.pointerId) {
            return;
        }
        clearTimeout(this.holdTimer);
        this.current = null;
        this.detachLive();
        const view = current.view;
        const page = view.page;
        if (current.kind === "ink") {
            if (cancelled && current.pointerType === "touch") {
                return;
            }
            const stroke = current.stroke;
            const shape = current.shape || (stroke.t === "shape" ? recognizeShape(stroke.p) : null);
            if (shape) {
                stroke.sh = shape;
                stroke.p = shapePoints(shape);
            }
            if (stroke.t === "shape" && !stroke.sh) {
                stroke.t = "ball"; // an unrecognised shape stays as drawn
            }
            forgetOutline(stroke);
            this.doc.history.run(opAddStroke(page, stroke));
            if (this.doc.ensureTrailingPage()) {
                this.doc.changed({pages: "all", structure: true});
            }
        } else if (current.kind === "erase") {
            const remaining = new Set(page.strokes);
            const removed = current.original.map((stroke, index) => ({stroke, index})).filter(item => !remaining.has(item.stroke));
            if (removed.length) {
                this.doc.history.push(opRemoveStrokes(page, removed));
            }
        } else if (current.kind === "lasso") {
            const polygon = current.points;
            const strokes = polygon.length > 2 ? page.strokes.filter(stroke =>
                stroke.p.filter(point => pointInPolygon(point, polygon)).length >= stroke.p.length * 0.7) : [];
            this.selection = strokes.length ? {page, strokes: new Set(strokes), polygon} : null;
            this.onLassoDone?.(view, polygon, strokes);
            this.markDirty(view);
        } else if (current.kind === "move" || current.kind === "scale") {
            const after = current.before.map(({stroke}) => ({stroke, p: stroke.p, sh: stroke.sh}));
            const moved = after.some((item, index) => item.p !== current.before[index].p);
            if (moved) {
                this.doc.history.push(opReshape(page, current.before, after));
            } else {
                this.markDirty(view);
            }
        }
    }

    cancelCurrent() {
        const current = this.current;
        if (!current) {
            return;
        }
        clearTimeout(this.holdTimer);
        this.current = null;
        this.detachLive();
        if (current.kind === "move" || current.kind === "scale") {
            current.before.forEach(({stroke, p, sh}) => {
                stroke.p = p;
                stroke.sh = sh;
                forgetOutline(stroke);
            });
        }
        if (current.kind === "erase") {
            current.view.page.strokes = current.original;
        }
        this.markDirty(current.view);
    }

    armHold() {
        clearTimeout(this.holdTimer);
        this.holdTimer = setTimeout(() => {
            const current = this.current;
            if (current?.kind !== "ink" || current.stroke.p.length < 3) {
                return;
            }
            const shape = recognizeShape(current.stroke.p, true);
            if (shape) {
                current.shape = shape;
                current.frozen = true;
                this.scheduleLive();
            }
        }, HOLD_DELAY);
    }

    eraseAt(view, [x, y]) {
        const page = view.page;
        const radius = 10;
        const before = page.strokes.length;
        page.strokes = page.strokes.filter(stroke => !strokeHit(stroke, x, y, radius));
        if (page.strokes.length !== before) {
            this.markDirty(view);
        }
    }

    transformSelection(point) {
        const current = this.current;
        const b = current.bounds;
        let map;
        let factor = 1;
        if (current.kind === "move") {
            const dx = point[0] - current.start[0];
            const dy = point[1] - current.start[1];
            map = (x, y) => [x + dx, y + dy];
        } else {
            const start = Math.hypot(current.start[0] - b.minX, current.start[1] - b.minY);
            factor = clamp(Math.hypot(point[0] - b.minX, point[1] - b.minY) / (start || 1), 0.1, 10);
            map = (x, y) => [b.minX + (x - b.minX) * factor, b.minY + (y - b.minY) * factor];
        }
        current.before.forEach(({stroke, p, sh}) => {
            stroke.p = p.map(([x, y, pressure]) => [...map(x, y), pressure]);
            if (sh) {
                stroke.sh = mapShape(sh, map, factor);
            }
            forgetOutline(stroke);
        });
        this.markDirty(current.view);
    }

    clearSelection() {
        if (!this.selection) {
            return;
        }
        const view = this.views.get(this.selection.page.id);
        this.selection = null;
        if (view) {
            this.markDirty(view);
        }
    }

    onPagesClick(event) {
        const button = event.target.closest("[data-sel]");
        if (button) {
            this.selectionAction(button.dataset.sel);
        }
    }

    selectionAction(action) {
        if (!this.selection) {
            return;
        }
        const {page, strokes} = this.selection;
        const list = [...strokes];
        switch (action) {
            case "delete": {
                const removed = page.strokes.map((stroke, index) => ({stroke, index})).filter(item => strokes.has(item.stroke));
                this.selection = null;
                this.doc.history.run(opRemoveStrokes(page, removed));
                break;
            }
            case "duplicate": {
                const copies = list.map(stroke => {
                    const copy = JSON.parse(JSON.stringify(stroke));
                    copy.id = shortId();
                    copy.sent = false;
                    copy.p = copy.p.map(([x, y, pressure]) => [x + 25, y + 25, pressure]);
                    copy.sh = mapShape(copy.sh, (x, y) => [x + 25, y + 25]);
                    return copy;
                });
                this.doc.history.run({
                    detail: {pages: [page.id]},
                    apply: () => page.strokes.push(...copies),
                    revert: () => {
                        const gone = new Set(copies);
                        page.strokes = page.strokes.filter(stroke => !gone.has(stroke));
                    },
                });
                this.selection = {page, strokes: new Set(copies)};
                break;
            }
            case "explain":
                this.plugin.explainSelection(this, this.selection);
                break;
        }
    }

    onKeyDown(event) {
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        let handled = true;
        if (mod && key === "z" && !event.shiftKey) {
            this.clearSelection();
            this.doc.history.undo();
        } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
            this.clearSelection();
            this.doc.history.redo();
        } else if (mod && key === "e") {
            this.setTool("eraser");
        } else if ((key === "delete" || key === "backspace") && this.selection) {
            this.selectionAction("delete");
        } else if (key === "escape" && this.selection) {
            this.clearSelection();
        } else if (mod && (key === "=" || key === "+") && this.mode === "tab") {
            this.setZoom(this.zoom + 0.1);
        } else if (mod && key === "-" && this.mode === "tab") {
            this.setZoom(this.zoom - 0.1);
        } else {
            handled = false;
        }
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    // ---- live drawing ----

    attachLive(view) {
        const {ratio, width, height} = this.canvasMetrics(view);
        this.live.width = width;
        this.live.height = height;
        this.live.dataset.ratio = String(ratio);
        this.live.classList.toggle("kmg-ink__live--hl", this.current?.stroke?.t === "hl");
        view.el.append(this.live);
    }

    detachLive() {
        cancelAnimationFrame(this.liveFrame);
        this.liveFrame = 0;
        this.live.remove();
    }

    scheduleLive() {
        if (!this.liveFrame) {
            this.liveFrame = requestAnimationFrame(() => {
                this.liveFrame = 0;
                this.drawLive();
            });
        }
    }

    drawLive() {
        const current = this.current;
        if (!current) {
            return;
        }
        const view = current.view;
        const s = view.el.clientWidth / view.page.w;
        const ratio = Number(this.live.dataset.ratio) || 1;
        const ctx = this.live.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.live.width, this.live.height);
        ctx.setTransform(ratio * s, 0, 0, ratio * s, 0, 0);
        const paper = this.doc.data.paper;
        if (current.kind === "ink") {
            const stroke = current.shape ?
                {...current.stroke, sh: current.shape, p: shapePoints(current.shape)} : current.stroke;
            drawStroke(ctx, stroke, paper);
        } else if (current.kind === "lasso") {
            ctx.save();
            ctx.strokeStyle = "#3573f0";
            ctx.lineWidth = 2 / s;
            ctx.setLineDash([8 / s, 6 / s]);
            ctx.fillStyle = "rgba(53, 115, 240, .08)";
            ctx.beginPath();
            current.points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }

    // ---- gestures: fingers pan, two fingers pinch (zoom in the tab) ----

    startGesture() {
        const points = [...this.touches.values()];
        const mid = points.reduce((acc, p) => ({x: acc.x + p.x / points.length, y: acc.y + p.y / points.length}), {x: 0, y: 0});
        const spread = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
        this.gesture = {mid, spread, zoom: this.zoom};
    }

    updateGesture() {
        const gesture = this.gesture;
        const points = [...this.touches.values()];
        if (!points.length) {
            return;
        }
        const mid = points.reduce((acc, p) => ({x: acc.x + p.x / points.length, y: acc.y + p.y / points.length}), {x: 0, y: 0});
        const scroller = this.scroller();
        if (scroller) {
            scroller.scrollBy(gesture.mid.x - mid.x, gesture.mid.y - mid.y);
        }
        gesture.mid = mid;
        if (this.mode === "tab" && points.length > 1 && gesture.spread > 0) {
            const spread = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            this.setZoom(gesture.zoom * spread / gesture.spread, mid, false);
        }
    }

    onWheel(event) {
        if (!event.ctrlKey && !event.metaKey) {
            return;
        }
        event.preventDefault();
        this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.002), {x: event.clientX, y: event.clientY});
    }

    setZoom(value, anchor, snap = true) {
        const zoom = clamp(value, 0.5, 4);
        const scroller = this.scrollEl;
        const rect = scroller.getBoundingClientRect();
        const ax = anchor ? anchor.x - rect.left : rect.width / 2;
        const ay = anchor ? anchor.y - rect.top : rect.height / 2;
        const fx = (scroller.scrollLeft + ax) / Math.max(1, scroller.scrollWidth);
        const fy = (scroller.scrollTop + ay) / Math.max(1, scroller.scrollHeight);
        this.zoom = zoom;
        this.layout();
        scroller.scrollLeft = fx * scroller.scrollWidth - ax;
        scroller.scrollTop = fy * scroller.scrollHeight - ay;
        clearTimeout(this.zoomSnap);
        if (snap && zoom !== 1 && Math.abs(zoom - 1) < 0.05) {
            this.zoomSnap = setTimeout(() => this.setZoom(1, anchor, false), 200);
        }
    }

    // ---- the AI ----

    async ask(mode) {
        const doc = this.doc;
        if (doc.busy) {
            return;
        }
        const i18n = this.i18n;
        const pages = doc.data.pages;
        const fresh = pages.map(page => ({page, strokes: page.strokes.filter(stroke => !stroke.sent && stroke.t !== "hl")}))
            .filter(group => group.strokes.length);
        if (fresh.length === 0 && mode !== "quiz") {
            showMessage(i18n.writeFirst);
            return;
        }
        this.clearSelection();
        doc.busy = true;
        doc.dispatchEvent(new CustomEvent("status"));
        const history = pages.flatMap(page => page.items).map(item => ({
            role: item.type === "reply" ? "assistant" : "user",
            content: item.text,
        }));
        try {
            const canvases = fresh.slice(-4).map(group => renderStrokesImage(group.strokes, doc.data.paper)).filter(Boolean);
            const context = this.blockElement?.isConnected ?
                documentContext(this.blockElement) : await documentContextById(this.blockId || doc.blockId);
            const result = await askAI({
                images: canvases.length ? [stackImages(canvases)] : [],
                text: mode === "quiz" && fresh.length === 0 ? i18n.quizStart : "",
                context,
                mode,
                history,
            });
            const target = fresh.length ? fresh[fresh.length - 1].page :
                [...pages].reverse().find(page => !pageIsEmpty(page)) || pages[0];
            const paper = doc.data.paper;
            const writing = strokeBounds(target.strokes.filter(stroke => stroke.t !== "hl" &&
                (fresh.length ? fresh[fresh.length - 1].strokes.includes(stroke) : true)));
            const lastReply = [...target.items].reverse().find(item => item.type === "reply");
            const bottom = Math.max(writing ? writing.maxY : 0, lastReply ? lastReply.y + lastReply.h : 0,
                (paper.top ?? 2) * paper.line - paper.line);
            let lineY = snapToLine(paper, bottom + paper.line * 0.5);
            if (lineY - bottom < paper.line * 0.9) {
                lineY += paper.line;
            }
            if (result.transcript) {
                target.items.push({type: "note", text: result.transcript});
            } else if (fresh.length) {
                showMessage(i18n.noTranscript, 6000);
            }
            const reply = {type: "reply", text: result.reply, y: this.replyTop(lineY, bottom), h: 0, mode};
            target.items.push(reply);
            fresh.forEach(group => group.strokes.forEach(stroke => {
                stroke.sent = true;
            }));
            const view = this.views.get(target.id);
            if (view) {
                view.freshReply = reply;
            }
            doc.ensureTrailingPage();
            doc.changed({pages: "all", structure: true}, false);
            await doc.save();
            this.plugin.writeConversation(doc);
        } catch (error) {
            showMessage(`${i18n.askFailed} ${error.message}`, 7000, "error");
        } finally {
            doc.busy = false;
            doc.dispatchEvent(new CustomEvent("status"));
        }
    }
}
