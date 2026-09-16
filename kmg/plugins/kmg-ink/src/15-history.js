// Undo and redo for one notebook. An operation is {apply(), revert(), detail}: apply has already
// run when it is pushed; detail is what doc.changed() reports after either direction.

class History {
    constructor(doc) {
        this.doc = doc;
        this.done = [];
        this.undone = [];
    }

    push(op) {
        this.done.push(op);
        if (this.done.length > 200) {
            this.done.shift();
        }
        this.undone = [];
        this.doc.changed(op.detail);
    }

    // Runs apply and records it.
    run(op) {
        op.apply();
        this.push(op);
    }

    undo() {
        const op = this.done.pop();
        if (!op) {
            return false;
        }
        op.revert();
        this.undone.push(op);
        this.doc.changed(op.detail);
        return true;
    }

    redo() {
        const op = this.undone.pop();
        if (!op) {
            return false;
        }
        op.apply();
        this.done.push(op);
        this.doc.changed(op.detail);
        return true;
    }
}

const opAddStroke = (page, stroke) => ({
    detail: {pages: [page.id]},
    apply: () => page.strokes.push(stroke),
    revert: () => {
        const index = page.strokes.indexOf(stroke);
        if (index >= 0) {
            page.strokes.splice(index, 1);
        }
    },
});

// removed: [{stroke, index}] in ascending index order, as they were before removal.
const opRemoveStrokes = (page, removed) => ({
    detail: {pages: [page.id]},
    apply: () => {
        const gone = new Set(removed.map(item => item.stroke));
        page.strokes = page.strokes.filter(stroke => !gone.has(stroke));
    },
    revert: () => removed.forEach(({stroke, index}) => page.strokes.splice(index, 0, stroke)),
});

// Replaces each stroke's points (and shape) by a transformed copy; before/after are [{stroke, p, sh}].
const opReshape = (page, before, after) => {
    const set = (states) => states.forEach(({stroke, p, sh}) => {
        stroke.p = p;
        if (sh) {
            stroke.sh = sh;
        }
        forgetOutline(stroke);
    });
    return {detail: {pages: [page.id]}, apply: () => set(after), revert: () => set(before)};
};

const opRecolor = (page, strokes, color) => {
    const old = strokes.map(stroke => stroke.c);
    return {
        detail: {pages: [page.id]},
        apply: () => strokes.forEach(stroke => {
            stroke.c = color;
        }),
        revert: () => strokes.forEach((stroke, index) => {
            stroke.c = old[index];
        }),
    };
};

const opPaper = (data, paper) => {
    const old = data.paper;
    return {
        detail: {pages: "all", paper: true},
        apply: () => {
            data.paper = paper;
        },
        revert: () => {
            data.paper = old;
        },
    };
};

// Any change to the page list: before/after are arrays of the same page objects.
const opPages = (data, before, after) => ({
    detail: {pages: "all", structure: true},
    apply: () => {
        data.pages = after.slice();
    },
    revert: () => {
        data.pages = before.slice();
    },
});
