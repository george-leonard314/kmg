// KMG Ink: handwriting pages where the AI writes back on the page.
// Plain JavaScript on purpose: KMG loads it as is, no build step.

const {
    Plugin, Dialog, showMessage, hideMessage, fetchPost, fetchSyncPost, getFrontend, getAllModels, openTab, openMobileFileById,
} = require("siyuan");

const PLUGIN = "kmg-ink";
const BLOCK = "page";
const INFO = `${PLUGIN}/${BLOCK}`;
const PAGE_WIDTH = 1000; // logical units; the page scales to the editor width
const START_HEIGHT = 700;
const GROW_BY = 400;
const REPLY_LEFT = 70;
const REPLY_WIDTH = 860;
const REPLY_FONT = 34; // logical units
const LINE_SPACING = 50;
const MAX_CONTEXT = 8000;
const COLORS = ["#1b1b1b", "#1f4fbf", "#c62828"];
const REPLY_COLOR = "#8a4b08";

const newId = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}` +
        `${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 9)}`;
};

const pageContent = (file, text = "") => JSON.stringify({v: 1, file}) + (text ? "\n" + text : "");

const pageMarkdown = (file, text = "") => `;;;${INFO}\n${pageContent(file, text)}\n;;;`;

// Block content: first line is JSON metadata, the rest is the conversation as plain text (so search finds it).
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

const conversationText = (data) => data.items.map(item =>
    item.type === "reply" ? `AI: ${item.text}` : `Me: ${item.text}`).join("\n")
    .split("\n").filter(line => line.trim() !== ";;;").join("\n");

const loadPage = async (file) => {
    try {
        const response = await fetch("/api/file/getFile", {
            method: "POST",
            body: JSON.stringify({path: `/data/${file}`}),
        });
        if (response.status === 200) {
            const data = await response.json();
            if (Array.isArray(data.strokes)) {
                return {
                    height: data.height || START_HEIGHT,
                    strokes: data.strokes,
                    items: Array.isArray(data.items) ? data.items : [],
                    asked: data.asked || 0,
                };
            }
        }
    } catch (error) {
        console.warn(`${PLUGIN}: cannot read ${file}`, error);
    }
    return {height: START_HEIGHT, strokes: [], items: [], asked: 0};
};

const savePage = (file, data) => {
    const form = new FormData();
    form.append("path", `/data/${file}`);
    form.append("isDir", "false");
    form.append("modTime", String(Math.floor(Date.now() / 1000)));
    form.append("file", new Blob([JSON.stringify(data)], {type: "application/json"}), file.split("/").pop());
    return fetch("/api/file/putFile", {method: "POST", body: form});
};

const strokeBounds = (strokes) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokes.forEach(stroke => stroke.p.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }));
    return minX === Infinity ? null : {minX, minY, maxX, maxY};
};

const distanceToSegment = (x, y, [x0, y0], [x1, y1]) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length)) : 0;
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
};

const strokeHit = (stroke, x, y, radius) => stroke.p.length === 1 ?
    Math.hypot(x - stroke.p[0][0], y - stroke.p[0][1]) < radius :
    stroke.p.some((point, index) => index > 0 && distanceToSegment(x, y, stroke.p[index - 1], point) < radius);

const drawStroke = (ctx, stroke, scale, color) => {
    const points = stroke.p;
    ctx.strokeStyle = color || stroke.c;
    ctx.fillStyle = color || stroke.c;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0][0] * scale, points[0][1] * scale, stroke.w * scale / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    for (let i = 1; i < points.length; i++) {
        const [x0, y0, p0] = points[i - 1];
        const [x1, y1, p1] = points[i];
        ctx.lineWidth = Math.max(0.6, stroke.w * scale * (0.45 + ((p0 + p1) / 2) * 0.9));
        ctx.beginPath();
        ctx.moveTo(x0 * scale, y0 * scale);
        ctx.lineTo(x1 * scale, y1 * scale);
        ctx.stroke();
    }
};

// Newest handwriting as a black-on-white PNG, cropped and at most 1568px wide.
const renderStrokesImage = (strokes) => {
    const bounds = strokeBounds(strokes);
    if (!bounds) {
        return "";
    }
    const pad = 20;
    const width = bounds.maxX - bounds.minX + pad * 2;
    const height = bounds.maxY - bounds.minY + pad * 2;
    const scale = Math.min(1568 / width, 1568 / height, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate((pad - bounds.minX) * scale, (pad - bounds.minY) * scale);
    strokes.forEach(stroke => drawStroke(ctx, stroke, scale, "#000000"));
    return canvas.toDataURL("image/png");
};

const documentContext = (element) => {
    const wysiwyg = element.closest(".protyle-wysiwyg");
    if (!wysiwyg) {
        return "";
    }
    const block = element.closest('[data-type="NodeCustomBlock"]');
    const parts = [];
    wysiwyg.querySelectorAll(":scope > [data-node-id]").forEach(item => {
        if (item === block) {
            parts.push("[this handwriting page]");
        } else if (item.getAttribute("data-type") === "NodeCustomBlock" &&
            item.getAttribute("data-info") === INFO) {
            parts.push(parseContent(item.getAttribute("data-content") || "").text);
        } else {
            parts.push(item.textContent || "");
        }
    });
    const text = parts.join("\n").trim();
    return text.length > MAX_CONTEXT ? text.slice(-MAX_CONTEXT) : text;
};

const askAI = (body) => fetchSyncPost("/api/ai/ink/reply", body).then(response => {
    if (response.code !== 0) {
        throw new Error(response.msg || "the AI did not answer");
    }
    return response.data;
});

module.exports = class KmgInk extends Plugin {
    onload() {
        this.addIcons(`<symbol id="iconKmgInk" viewBox="0 0 32 32"><path d="M25.4 3.2a3 3 0 0 1 4.2 4.2L13 24l-6.4 2.2L8.8 19.8zM6 28h20v2H6z"/></symbol>`);
        const i18n = this.i18n;

        this.customBlockRenders[BLOCK] = {
            render: (options) => this.renderPage(options),
        };

        this.protyleSlash = [{
            filter: ["ink", "handwriting", "hand", "pen", "draw by hand"],
            html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconKmgInk"></use></svg><span class="b3-list-item__text">${i18n.handwritingPage}</span></div>`,
            id: "insertPage",
            callback: (protyle, nodeElement) => this.insertPage(nodeElement),
        }];

        this.addCommand({
            langKey: "insertPage",
            hotkey: "",
            editorCallback: (protyle) => {
                const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
                const node = range?.startContainer?.parentElement?.closest("[data-node-id]");
                if (node) {
                    this.insertPage(node);
                }
            },
        });

        this.onPdfClick = (event) => {
            const rect = event.target.closest?.(".pdf__rect");
            if (rect) {
                this.lastAnnotation = rect;
            }
        };
        document.addEventListener("pointerdown", this.onPdfClick, true);
        this.pdfObserver = new MutationObserver(() => this.addPdfButtons());
        this.pdfObserver.observe(document.body, {childList: true, subtree: true});
    }

    onunload() {
        document.removeEventListener("pointerdown", this.onPdfClick, true);
        this.pdfObserver?.disconnect();
        document.querySelectorAll(".kmg-ink-pdf-button").forEach(item => item.remove());
    }

    async insertPage(nodeElement) {
        const file = `assets/kmg-ink/${newId()}.json`;
        await savePage(file, {height: START_HEIGHT, strokes: [], items: [], asked: 0});
        const id = nodeElement.getAttribute("data-node-id");
        const leftover = (nodeElement.textContent || "").replace(/[/、][^\s/]*$/, "").trim();
        if (nodeElement.getAttribute("data-type") === "NodeParagraph" && !leftover) {
            fetchPost("/api/block/updateBlock", {dataType: "markdown", data: pageMarkdown(file), id});
        } else {
            fetchPost("/api/block/insertBlock", {dataType: "markdown", data: pageMarkdown(file), previousID: id});
        }
    }

    renderPage({element, content, setContent}) {
        const i18n = this.i18n;
        const {meta, text} = parseContent(content);
        if (!meta?.file) {
            element.innerHTML = `<div class="kmg-ink__error">${i18n.brokenPage}</div><pre>${text.replace(/</g, "&lt;")}</pre>`;
            return;
        }
        const file = meta.file;
        element.innerHTML = `<div class="kmg-ink">
    <div class="kmg-ink__toolbar">
        <button class="kmg-ink__tool kmg-ink__tool--on" data-tool="pen" title="${i18n.pen}">✎</button>
        <button class="kmg-ink__tool" data-tool="eraser" title="${i18n.eraser}">⌫</button>
        ${COLORS.map((color, index) => `<button class="kmg-ink__color${index === 0 ? " kmg-ink__color--on" : ""}" data-color="${color}" style="background:${color}" title="${i18n.color}"></button>`).join("")}
        <button class="kmg-ink__tool" data-action="undo" title="${i18n.undo}">↶</button>
        <span class="kmg-ink__spacer"></span>
        <span class="kmg-ink__status"></span>
        <button class="kmg-ink__tool" data-action="quiz" title="${i18n.quizTip}">${i18n.quiz}</button>
        <button class="kmg-ink__ask" data-action="ask" title="${i18n.askTip}">${i18n.ask}</button>
    </div>
    <div class="kmg-ink__paper">
        <canvas class="kmg-ink__canvas"></canvas>
        <div class="kmg-ink__replies"></div>
    </div>
    <button class="kmg-ink__more" data-action="more">${i18n.moreSpace}</button>
</div>`;
        const paper = element.querySelector(".kmg-ink__paper");
        const canvas = element.querySelector(".kmg-ink__canvas");
        const repliesElement = element.querySelector(".kmg-ink__replies");
        const statusElement = element.querySelector(".kmg-ink__status");
        const ctx = canvas.getContext("2d");
        let data = {height: START_HEIGHT, strokes: [], items: [], asked: 0};
        let loaded = false;
        let disposed = false;
        let tool = "pen";
        let color = COLORS[0];
        let penSeen = false;
        let current = null;
        let touchScroll = null;
        let busy = false;
        let saveTimer = 0;

        const scale = () => paper.clientWidth / PAGE_WIDTH;
        const setStatus = (value) => statusElement.textContent = value;

        const layout = () => {
            const s = scale();
            if (!s) {
                return;
            }
            const ratio = window.devicePixelRatio || 1;
            paper.style.height = `${data.height * s}px`;
            paper.style.backgroundSize = `100% ${LINE_SPACING * s}px`;
            canvas.width = Math.round(paper.clientWidth * ratio);
            canvas.height = Math.round(data.height * s * ratio);
            canvas.style.height = `${data.height * s}px`;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            data.strokes.forEach(stroke => drawStroke(ctx, stroke, s));
            repliesElement.style.fontSize = `${REPLY_FONT * s}px`;
            repliesElement.querySelectorAll(".kmg-ink__reply").forEach(item => {
                const reply = data.items[Number(item.dataset.index)];
                item.style.top = `${reply.y * s}px`;
                item.style.left = `${REPLY_LEFT * s}px`;
                item.style.width = `${REPLY_WIDTH * s}px`;
            });
        };

        const renderReplies = () => {
            repliesElement.innerHTML = "";
            data.items.forEach((item, index) => {
                if (item.type !== "reply") {
                    return;
                }
                const reply = document.createElement("div");
                reply.className = "kmg-ink__reply";
                reply.dataset.index = String(index);
                reply.style.color = REPLY_COLOR;
                reply.textContent = item.text;
                repliesElement.append(reply);
            });
            layout();
            // A reply is measured once, after its first render; later writing goes below it.
            let measured = false;
            repliesElement.querySelectorAll(".kmg-ink__reply").forEach(replyElement => {
                const reply = data.items[Number(replyElement.dataset.index)];
                if (!reply.h && scale()) {
                    reply.h = Math.ceil(replyElement.offsetHeight / scale()) + 20;
                    data.height = Math.max(data.height, reply.y + reply.h + GROW_BY);
                    measured = true;
                }
            });
            if (measured) {
                layout();
                scheduleSave();
            }
        };

        const scheduleSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => savePage(file, data).catch(error => {
                setStatus(i18n.saveFailed);
                console.error(error);
            }), 800);
        };

        const growIfNeeded = (y) => {
            if (y > data.height - 150) {
                data.height += GROW_BY;
                layout();
            }
        };

        const toPage = (event) => {
            const rect = canvas.getBoundingClientRect();
            const s = scale();
            return [
                Math.round(((event.clientX - rect.left) / s) * 10) / 10,
                Math.round(((event.clientY - rect.top) / s) * 10) / 10,
                event.pointerType === "pen" ? Math.round((event.pressure || 0.5) * 100) / 100 : 0.5,
            ];
        };

        const eraseAt = ([x, y]) => {
            const radius = 14;
            const before = data.strokes.length;
            data.strokes = data.strokes.filter((stroke, index) => {
                const hit = strokeHit(stroke, x, y, radius);
                if (hit && index < data.asked) {
                    data.asked--;
                }
                return !hit;
            });
            if (data.strokes.length !== before) {
                layout();
                scheduleSave();
            }
        };

        const onPointerDown = (event) => {
            if (!loaded || busy) {
                return;
            }
            if (event.pointerType === "pen") {
                penSeen = true;
            }
            // With a stylus around, fingers scroll the page and never draw (palm rejection).
            if (event.pointerType === "touch" && penSeen) {
                const scroller = element.closest(".protyle-content");
                touchScroll = {id: event.pointerId, y: event.clientY, scroller};
                return;
            }
            event.preventDefault();
            canvas.setPointerCapture(event.pointerId);
            const eraser = tool === "eraser" || event.button === 5 || (event.buttons & 32) === 32;
            if (eraser) {
                current = {id: event.pointerId, eraser: true};
                eraseAt(toPage(event));
                return;
            }
            current = {id: event.pointerId, stroke: {c: color, w: 3, p: [toPage(event)]}};
        };

        const onPointerMove = (event) => {
            if (touchScroll && event.pointerId === touchScroll.id) {
                touchScroll.scroller?.scrollBy(0, touchScroll.y - event.clientY);
                touchScroll.y = event.clientY;
                return;
            }
            if (!current || event.pointerId !== current.id) {
                return;
            }
            event.preventDefault();
            const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
            events.forEach(item => {
                const point = toPage(item);
                if (current.eraser) {
                    eraseAt(point);
                    return;
                }
                const points = current.stroke.p;
                const last = points[points.length - 1];
                if (Math.abs(last[0] - point[0]) + Math.abs(last[1] - point[1]) < 0.8) {
                    return;
                }
                points.push(point);
                drawStroke(ctx, {c: current.stroke.c, w: current.stroke.w, p: [last, point]}, scale());
            });
        };

        const onPointerUp = (event) => {
            if (touchScroll && event.pointerId === touchScroll.id) {
                touchScroll = null;
                return;
            }
            if (!current || event.pointerId !== current.id) {
                return;
            }
            if (!current.eraser) {
                data.strokes.push(current.stroke);
                const s = scale();
                if (current.stroke.p.length === 1) {
                    drawStroke(ctx, current.stroke, s);
                }
                growIfNeeded(Math.max(...current.stroke.p.map(point => point[1])));
                scheduleSave();
            }
            current = null;
        };

        const ask = async (mode) => {
            if (busy) {
                return;
            }
            const fresh = data.strokes.slice(data.asked);
            if (fresh.length === 0 && mode !== "quiz") {
                showMessage(i18n.writeFirst);
                return;
            }
            busy = true;
            element.querySelector(".kmg-ink").classList.add("kmg-ink--busy");
            setStatus(i18n.thinking);
            const history = [];
            data.items.forEach(item => history.push({
                role: item.type === "reply" ? "assistant" : "user",
                content: item.text,
            }));
            try {
                const result = await askAI({
                    images: fresh.length ? [renderStrokesImage(fresh)] : [],
                    text: mode === "quiz" && fresh.length === 0 ? i18n.quizStart : "",
                    context: documentContext(element),
                    mode,
                    history,
                });
                if (disposed) {
                    return;
                }
                const bounds = strokeBounds(fresh);
                const lastReply = [...data.items].reverse().find(item => item.type === "reply");
                const below = Math.max(bounds ? bounds.maxY : 0, lastReply ? lastReply.y + lastReply.h : 0);
                if (result.transcript) {
                    data.items.push({type: "note", text: result.transcript});
                }
                const reply = {type: "reply", text: result.reply, y: Math.round(below + 40), h: 0, mode};
                data.items.push(reply);
                data.asked = data.strokes.length;
                renderReplies();
                repliesElement.lastElementChild?.classList.add("kmg-ink__reply--new");
                clearTimeout(saveTimer);
                await savePage(file, data);
                setContent(pageContent(file, conversationText(data)));
                setStatus("");
            } catch (error) {
                setStatus("");
                showMessage(`${i18n.askFailed} ${error.message}`, 7000, "error");
            } finally {
                busy = false;
                element.querySelector(".kmg-ink")?.classList.remove("kmg-ink--busy");
            }
        };

        const onClick = (event) => {
            const button = event.target.closest("button");
            if (!button) {
                return;
            }
            if (button.dataset.tool) {
                tool = button.dataset.tool;
                element.querySelectorAll("[data-tool]").forEach(item =>
                    item.classList.toggle("kmg-ink__tool--on", item === button));
            } else if (button.dataset.color) {
                color = button.dataset.color;
                tool = "pen";
                element.querySelectorAll("[data-color]").forEach(item =>
                    item.classList.toggle("kmg-ink__color--on", item === button));
                element.querySelectorAll("[data-tool]").forEach(item =>
                    item.classList.toggle("kmg-ink__tool--on", item.dataset.tool === "pen"));
            } else if (button.dataset.action === "undo") {
                if (data.strokes.length > data.asked) {
                    data.strokes.pop();
                    layout();
                    scheduleSave();
                }
            } else if (button.dataset.action === "more") {
                data.height += GROW_BY;
                layout();
                scheduleSave();
            } else if (button.dataset.action === "ask") {
                ask("reply");
            } else if (button.dataset.action === "quiz") {
                ask("quiz");
            }
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("contextmenu", event => event.preventDefault());
        element.addEventListener("click", onClick);
        const resizeObserver = new ResizeObserver(() => layout());
        resizeObserver.observe(paper);

        setStatus(i18n.loading);
        loadPage(file).then(page => {
            if (disposed) {
                return;
            }
            data = page;
            loaded = true;
            setStatus("");
            renderReplies();
        });

        return () => {
            disposed = true;
            resizeObserver.disconnect();
            if (saveTimer) {
                clearTimeout(saveTimer);
                savePage(file, data);
            }
        };
    }

    // "Discuss with AI" in the PDF selection popup.
    addPdfButtons() {
        document.querySelectorAll(".pdf__util").forEach(util => {
            if (util.querySelector(".kmg-ink-pdf-button")) {
                return;
            }
            const button = document.createElement("button");
            button.className = "b3-menu__item kmg-ink-pdf-button";
            button.innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#iconKmgInk"></use></svg><span class="b3-menu__label">${this.i18n.discuss}</span>`;
            button.addEventListener("mousedown", event => event.preventDefault());
            button.addEventListener("click", event => {
                event.stopPropagation();
                this.discussPdf(util);
            });
            util.append(button);
        });
    }

    findPdfAsset(util) {
        const model = (getAllModels().asset || []).find(item => item.element?.contains(util));
        return model?.path || "";
    }

    async discussPdf(util) {
        const i18n = this.i18n;
        const selection = window.getSelection()?.toString().trim() || "";
        const annotation = util.classList.contains("pdf__util--hide") ? null : this.lastAnnotation;
        const quote = selection || annotation?.getAttribute("data-content") || "";
        util.classList.add("fn__none");
        if (!quote) {
            showMessage(i18n.selectFirst);
            return;
        }
        const pdfPath = this.findPdfAsset(util);
        const pdfName = decodeURIComponent((pdfPath.split("/").pop() || "PDF").replace(/\.pdf$/i, ""))
            .replace(/-\d{14}-[a-z0-9]{7}$/, "");
        const annotationId = annotation?.getAttribute("data-node-id");
        const refLine = annotationId && pdfPath ? `<<${pdfPath}/${annotationId} "${pdfName}">>` : (pdfPath ? `[${pdfName}](${pdfPath})` : "");

        const notebook = await this.pickNotebook();
        if (!notebook) {
            return;
        }
        showMessage(i18n.thinking, -1, "info", "kmg-ink-thinking");
        let result;
        try {
            const pageText = util.closest(".pdf__outer")?.querySelector(".page[data-loaded] .textLayer")?.textContent || "";
            result = await askAI({text: quote, context: pageText.slice(0, MAX_CONTEXT), mode: "discuss", history: []});
        } catch (error) {
            hideMessage("kmg-ink-thinking");
            showMessage(`${i18n.askFailed} ${error.message}`, 7000, "error");
            return;
        }
        hideMessage("kmg-ink-thinking");
        const file = `assets/kmg-ink/${newId()}.json`;
        const data = {
            height: START_HEIGHT,
            strokes: [],
            items: [{type: "note", text: quote}, {type: "reply", text: result.reply, y: 40, h: 0, mode: "discuss"}],
            asked: 0,
        };
        await savePage(file, data);
        const title = quote.replace(/\s+/g, " ").slice(0, 60).replace(/[/\\]/g, "-");
        const markdown = [
            `> ${quote.replace(/\n/g, "\n> ")}`,
            "",
            refLine,
            "",
            pageMarkdown(file, conversationText(data)),
            "",
        ].join("\n");
        const response = await fetchSyncPost("/api/filetree/createDocWithMd", {
            notebook,
            path: `/${i18n.discussionsFolder}/${pdfName.replace(/[/\\]/g, "-")}/${title}`,
            markdown,
        });
        if (response.code !== 0) {
            showMessage(response.msg, 7000, "error");
            return;
        }
        const id = response.data;
        if (getFrontend().endsWith("mobile")) {
            openMobileFileById(this.app, id);
        } else {
            openTab({app: this.app, doc: {id}, position: "right"});
        }
    }

    async pickNotebook() {
        const response = await fetchSyncPost("/api/notebook/lsNotebooks", {});
        const notebooks = (response.data?.notebooks || []).filter(item => !item.closed);
        if (notebooks.length === 0) {
            showMessage(this.i18n.noNotebook);
            return "";
        }
        const saved = (await this.loadData("settings.json")) || {};
        if (notebooks.some(item => item.id === saved.notebook)) {
            return saved.notebook;
        }
        if (notebooks.length === 1) {
            return notebooks[0].id;
        }
        return new Promise(resolve => {
            const dialog = new Dialog({
                title: this.i18n.chooseNotebook,
                content: `<div class="b3-dialog__content"><select class="b3-select fn__block">${notebooks.map(item =>
                    `<option value="${item.id}">${item.name.replace(/</g, "&lt;")}</option>`).join("")}</select></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
                width: "360px",
                destroyCallback: () => resolve(""),
            });
            const select = dialog.element.querySelector("select");
            dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
            dialog.element.querySelector(".b3-button--text").addEventListener("click", () => {
                const notebook = select.value;
                this.saveData("settings.json", {...saved, notebook});
                resolve(notebook);
                dialog.destroy();
            });
        });
    }
};
