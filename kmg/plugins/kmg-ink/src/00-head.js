// KMG Ink: handwritten notebooks where the AI writes back on the page.
// Saber (github.com/saber-notes/saber) is the model for pages, paper and tools.

const {
    Plugin, Dialog, showMessage, hideMessage, fetchPost, fetchSyncPost, getFrontend, getAllModels, openTab,
    openMobileFileById,
} = require("siyuan");

const PLUGIN = "kmg-ink";
const BLOCK = "page";
const INFO = `${PLUGIN}/${BLOCK}`;
const TAB = "notebook";

// Page geometry in logical units; a page scales to the width it gets.
const PAGE_W = 1000;
const PAGE_H = 1400;

const REPLY_LEFT = 70;
const REPLY_WIDTH = 860;
const REPLY_COLOR = "#8a4b08";
const REPLY_COLOR_DARK = "#f0b36b";
const MAX_CONTEXT = 8000;
const AI_IMAGE_MAX = 1568;
const SAVE_DELAY = 800;
const HOLD_DELAY = 500; // a pen resting this long turns the stroke into a shape

const PALETTE = {
    main: ["#1b1b1b", "#c62828", "#ef6c00", "#f9a825", "#2e7d32", "#00838f", "#1f4fbf", "#6a1b9a", "#ad1457", "#ffffff"],
    pastel: ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffcfff"],
    grey: ["#000000", "#424242", "#9e9e9e", "#eeeeee", "#ffffff"],
};

const newId = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}` +
        `${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 9)}`;
};

const shortId = () => Math.random().toString(36).slice(2, 10);

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"})[c]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isMobile = () => getFrontend().endsWith("mobile");
