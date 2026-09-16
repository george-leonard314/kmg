// Small UI helpers: icons, popovers, the note text sent to the AI as context.

const svgIcon = (body) => `<svg class="kmg-ink__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
    pen: svgIcon(`<path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M13.5 7l3.5 3.5"/>`),
    ball: svgIcon(`<path d="M5 19l1.5-4.5 9.8-9.8 3 3-9.8 9.8z"/><circle cx="5" cy="19" r="1.2" fill="currentColor"/>`),
    shape: svgIcon(`<rect x="3" y="12" width="8" height="8" rx="1"/><circle cx="16.5" cy="7.5" r="4.5"/>`),
    pencil: svgIcon(`<path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19z"/><path d="M5 15.5L8.5 19"/><path d="M13.5 7l3.5 3.5"/>`),
    hl: svgIcon(`<path d="M9 17l-3-3 9-9 3 3z"/><path d="M6 14l-2 4h5l0-1"/><path d="M4 21h16" stroke-width="3" opacity=".45"/>`),
    eraser: svgIcon(`<path d="M8.5 19.5L3.8 14.8a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l5.3 5.3a1.5 1.5 0 0 1 0 2.1l-8.2 8.3z"/><path d="M8 10l6 6"/><path d="M12 20h8"/>`),
    lasso: svgIcon(`<ellipse cx="12" cy="9" rx="8" ry="5" stroke-dasharray="3 2.2"/><path d="M7.5 13c-.8 2.2.3 4.8 2.8 6"/>`),
    undo: svgIcon(`<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
    redo: svgIcon(`<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`),
    finger: svgIcon(`<path d="M9 12V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5a1.5 1.5 0 0 1 3 0V12"/><path d="M15 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4.5 16a1.5 1.5 0 0 1 2.3-1.9L9 16"/>`),
    paper: svgIcon(`<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/>`),
    pages: svgIcon(`<rect x="8" y="3" width="12" height="15" rx="1.5"/><path d="M5 7v12.5A1.5 1.5 0 0 0 6.5 21H16"/>`),
    fullscreen: svgIcon(`<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`),
    size: svgIcon(`<path d="M4 7h16" stroke-width="1.2"/><path d="M4 12h16" stroke-width="2.4"/><path d="M4 17.5h16" stroke-width="4"/>`),
    up: svgIcon(`<path d="M6 14l6-6 6 6"/>`),
    down: svgIcon(`<path d="M6 10l6 6 6-6"/>`),
    copy: svgIcon(`<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>`),
    add: svgIcon(`<path d="M12 5v14M5 12h14"/>`),
    clear: svgIcon(`<path d="M5 5l14 14M19 5L5 19"/>`),
    trash: svgIcon(`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`),
    sparkle: svgIcon(`<path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>`),
    pdf: svgIcon(`<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/><path d="M9 13h6M9 16.5h4"/>`),
};

let openPopoverElement = null;

const closePopover = () => {
    if (openPopoverElement) {
        openPopoverElement.dispatchEvent(new CustomEvent("close"));
        openPopoverElement.remove();
        openPopoverElement = null;
    }
};

// A floating panel under (or above) anchor; closes on a press outside it or Escape.
const openPopover = (anchor, html, className = "") => {
    closePopover();
    const popover = document.createElement("div");
    popover.className = `kmg-ink-popover ${className}`;
    popover.innerHTML = html;
    document.body.append(popover);
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const left = clamp(rect.left, 8, window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    const onDown = (event) => {
        if (!popover.contains(event.target) && !anchor.contains(event.target)) {
            closePopover();
        }
    };
    const onKey = (event) => {
        if (event.key === "Escape") {
            closePopover();
        }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    popover.addEventListener("close", () => {
        document.removeEventListener("pointerdown", onDown, true);
        document.removeEventListener("keydown", onKey, true);
    });
    openPopoverElement = popover;
    return popover;
};

// The note around a handwriting block, as plain text.
const documentContext = (blockElement) => {
    const wysiwyg = blockElement?.closest(".protyle-wysiwyg");
    if (!wysiwyg) {
        return "";
    }
    const parts = [];
    wysiwyg.querySelectorAll(":scope > [data-node-id]").forEach(item => {
        if (item === blockElement) {
            parts.push("[this handwriting notebook]");
        } else if (item.getAttribute("data-type") === "NodeCustomBlock" && item.getAttribute("data-info") === INFO) {
            parts.push(parseContent(item.getAttribute("data-content") || "").text);
        } else {
            parts.push(item.textContent || "");
        }
    });
    const text = parts.join("\n").trim();
    return text.length > MAX_CONTEXT ? text.slice(-MAX_CONTEXT) : text;
};

// The same for a block that is not on screen (the full-screen tab): the note exported as Markdown.
const documentContextById = async (blockId) => {
    if (!blockId) {
        return "";
    }
    const info = await fetchSyncPost("/api/block/getBlockInfo", {id: blockId});
    if (info.code !== 0 || !info.data?.rootID) {
        return "";
    }
    const exported = await fetchSyncPost("/api/export/exportMdContent", {id: info.data.rootID});
    const text = (exported.data?.content || "")
        .split("\n")
        .filter(line => !line.startsWith(`;;;${INFO}`) && !line.startsWith("{\"v\":1,\"file\"") && line.trim() !== ";;;")
        .join("\n").trim();
    return text.length > MAX_CONTEXT ? text.slice(-MAX_CONTEXT) : text;
};

const askAI = (body) => fetchSyncPost("/api/ai/ink/reply", body).then(response => {
    if (response.code !== 0) {
        throw new Error(response.msg || "the AI did not answer");
    }
    return response.data;
});
