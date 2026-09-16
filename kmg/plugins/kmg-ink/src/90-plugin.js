// The plugin: the note block, the full-screen tab, settings, and "Discuss with AI" in the PDF viewer.

const DEFAULT_SETTINGS = {
    tool: "pen",
    penKind: "pen",
    tools: {},
    recent: ["#1b1b1b", "#1f4fbf", "#c62828"],
    fingerDraw: true,
    fingerAuto: true,
    paper: DEFAULT_PAPER,
};

module.exports = class KmgInk extends Plugin {
    onload() {
        this.addIcons(`<symbol id="iconKmgInk" viewBox="0 0 32 32"><path d="M25.4 3.2a3 3 0 0 1 4.2 4.2L13 24l-6.4 2.2L8.8 19.8zM6 28h20v2H6z"/></symbol>`);
        const i18n = this.i18n;
        // Views wait for settingsReady; the renderers are registered at once so no block misses them.
        this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        this.views = new Set();
        this.settingsReady = this.loadData("settings.json").then(saved => {
            Object.assign(this.settings, saved || {});
            this.settings.tools = this.settings.tools || {};
        }).catch(() => null);

        this.customBlockRenders[BLOCK] = {
            render: (options) => this.renderBlock(options),
        };

        this.protyleSlash = [{
            filter: ["ink", "handwriting", "hand", "pen", "notebook", "draw by hand"],
            html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconKmgInk"></use></svg><span class="b3-list-item__text">${i18n.handwritingPage}</span></div>`,
            id: "insertPage",
            callback: (protyle, nodeElement) => this.insertPage(nodeElement),
        }];

        this.addCommand({
            langKey: "insertPage",
            hotkey: "",
            editorCallback: () => {
                const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
                const node = range?.startContainer?.parentElement?.closest("[data-node-id]");
                if (node) {
                    this.insertPage(node);
                }
            },
        });

        const plugin = this;
        this.addTab({
            type: TAB,
            init() {
                const host = document.createElement("div");
                host.className = "kmg-ink-tab";
                this.element.append(host);
                this.notebook = new NotebookView({
                    plugin, element: host, file: this.data.file, mode: "tab", blockId: this.data.blockId,
                });
                this.notebook.start();
            },
            destroy() {
                this.notebook?.dispose();
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
        // Open notebooks close and save now, so a reloaded plugin reads what they wrote.
        const saves = [...this.views].map(view => view.dispose());
        if (this.settingsTimer) {
            clearTimeout(this.settingsTimer);
            saves.push(this.saveData("settings.json", this.settings));
        }
        window[FLUSH] = Promise.all(saves).catch(() => null);
        closePopover();
        document.removeEventListener("pointerdown", this.onPdfClick, true);
        this.pdfObserver?.disconnect();
        document.querySelectorAll(".kmg-ink-pdf-button").forEach(item => item.remove());
    }

    // Settings changed elsewhere (sync, another window): take them over instead of letting KMG
    // reload the plugin, which would close every open notebook.
    async onDataChanged() {
        const saved = await this.loadData("settings.json").catch(() => null);
        if (saved) {
            Object.assign(this.settings, saved);
        }
    }

    saveSettings() {
        clearTimeout(this.settingsTimer);
        this.settingsTimer = setTimeout(() => {
            this.settingsTimer = 0;
            this.saveData("settings.json", this.settings);
        }, 600);
    }

    async insertPage(nodeElement) {
        const file = `assets/kmg-ink/${newId()}.json`;
        await saveNotebook(file, newNotebook(this.settings.paper));
        const id = nodeElement.getAttribute("data-node-id");
        const leftover = (nodeElement.textContent || "").replace(/[/、][^\s/]*$/, "").trim();
        if (nodeElement.getAttribute("data-type") === "NodeParagraph" && !leftover) {
            fetchPost("/api/block/updateBlock", {dataType: "markdown", data: pageMarkdown(file), id});
        } else {
            fetchPost("/api/block/insertBlock", {dataType: "markdown", data: pageMarkdown(file), previousID: id});
        }
    }

    renderBlock({element, content, setContent}) {
        const {meta, text} = parseContent(content);
        if (!meta?.file) {
            element.innerHTML = `<div class="kmg-ink__error">${this.i18n.brokenPage}</div><pre>${escapeHtml(text)}</pre>`;
            return;
        }
        const blockElement = element.closest('[data-type="NodeCustomBlock"]');
        const view = new NotebookView({
            plugin: this,
            element,
            file: meta.file,
            mode: "block",
            blockId: blockElement?.getAttribute("data-node-id") || "",
            blockElement,
            setContent,
        });
        view.start();
        return () => view.dispose();
    }

    openNotebookTab(file, blockId, blockElement) {
        const title = blockElement?.closest(".protyle")?.querySelector(".protyle-title__input")?.textContent?.trim();
        openTab({
            app: this.app,
            custom: {
                id: this.name + TAB,
                icon: "iconKmgInk",
                title: title || this.i18n.handwritingPage,
                data: {file, blockId},
            },
        });
    }

    // The block's text carries the conversation for search.
    writeConversation(doc) {
        const writer = doc.blockWriters && [...doc.blockWriters][0];
        if (writer) {
            writer();
        } else if (doc.blockId) {
            fetchPost("/api/block/updateBlock", {
                dataType: "markdown",
                data: pageMarkdown(doc.file, conversationText(doc.data)),
                id: doc.blockId,
            });
        }
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

    findPdfAsset(element) {
        const model = (getAllModels().asset || []).find(item => item.element?.contains(element));
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
        const pageText = util.closest(".pdf__outer")?.querySelector(".page[data-loaded] .textLayer")?.textContent || "";
        await this.createDiscussion({
            quote,
            pdfPath,
            annotationId: annotation?.getAttribute("data-node-id"),
            request: {text: quote, context: pageText.slice(0, MAX_CONTEXT), mode: "discuss", history: []},
        });
    }

    // A note under "AI discussions / <PDF name>" with the quote, a link back and a notebook holding the AI's reply.
    async createDiscussion({quote, pdfPath, annotationId, request, result}) {
        const i18n = this.i18n;
        const pdfName = decodeURIComponent((pdfPath.split("/").pop() || "PDF").replace(/\.pdf$/i, ""))
            .replace(/-\d{14}-[a-z0-9]{7}$/, "");
        const refLine = annotationId && pdfPath ? `<<${pdfPath}/${annotationId} "${pdfName}">>` : (pdfPath ? `[${pdfName}](${pdfPath})` : "");
        const notebook = await this.pickNotebook();
        if (!notebook) {
            return;
        }
        if (!result) {
            showMessage(i18n.thinking, -1, "info", "kmg-ink-thinking");
            try {
                result = await askAI(request);
            } catch (error) {
                showMessage(`${i18n.askFailed} ${error.message}`, 7000, "error");
                return;
            } finally {
                hideMessage("kmg-ink-thinking");
            }
        }
        const file = `assets/kmg-ink/${newId()}.json`;
        const data = newNotebook(this.settings.paper);
        data.pages[0].items.push({type: "note", text: quote}, {type: "reply", text: result.reply, y: 40, h: 0, mode: request?.mode || "discuss"});
        data.pages.push(emptyPage());
        await saveNotebook(file, data);
        const title = quote.replace(/\s+/g, " ").slice(0, 60).replace(/[/\\]/g, "-") || pdfName;
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
        if (isMobile()) {
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
        if (notebooks.some(item => item.id === this.settings.notebook)) {
            return this.settings.notebook;
        }
        if (notebooks.length === 1) {
            return notebooks[0].id;
        }
        return new Promise(resolve => {
            let chosen = "";
            const dialog = new Dialog({
                title: this.i18n.chooseNotebook,
                content: `<div class="b3-dialog__content"><select class="b3-select fn__block">${notebooks.map(item =>
                    `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
                width: "360px",
                destroyCallback: () => resolve(chosen),
            });
            const select = dialog.element.querySelector("select");
            dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
            dialog.element.querySelector(".b3-button--text").addEventListener("click", () => {
                chosen = select.value;
                this.settings.notebook = chosen;
                this.saveSettings();
                dialog.destroy();
            });
        });
    }
};
