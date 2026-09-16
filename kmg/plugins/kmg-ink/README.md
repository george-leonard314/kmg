# KMG Ink

You take handwritten notes in KMG, the way you would on a tablet, and the AI writes back on the page. The pages, paper and tools follow [Saber](https://github.com/saber-notes/saber).

## Notebooks

- **New notebook:** type `/ink` (or `/handwriting`, `/notebook`) in a note.
- **Pages:** A4-shaped pages in one scrolling column. There is always one empty page at the end: writing on it adds the next.
  - **Pages** (toolbar) lists them with thumbnails: move up or down, insert a page after, duplicate, clear or delete.
- **Full screen:** the toolbar's full-screen button opens the notebook in its own tab (desktop).
  - `Ctrl` + mouse wheel, `Ctrl` + `+`/`-` or a two-finger pinch zooms from 0.5× to 4×; it snaps back to 1× near it.
  - The tab and the note show the same notebook; a change in one appears in the other.
- **Paper** (toolbar): blank, lined, college, grid, dots, music staves, guitar tabs or Cornell notes; line spacing, line thickness, and cream, white or dark paper. The paper belongs to the notebook, and a new notebook starts with the last paper you chose.

## Tools

- **Pen:** click it again to choose the fountain pen (follows stylus pressure), the ballpoint (even width) or the shape pen.
- **Pencil:** tapered, with a grain.
- **Highlighter:** drawn under the ink, and overlapping strokes do not get darker.
- **Shapes:** the shape pen turns a stroke into a line, rectangle, triangle, star or ellipse. With any pen, holding still for half a second at the end of a stroke does the same.
- **Eraser:** removes whole strokes (`Ctrl+E`). The eraser end or the button of a stylus erases while held.
- **Lasso:** draw a loop around strokes to select them.
  - Drag to move them, drag the round handle to resize them.
  - Pick a colour to recolour them, or use Duplicate or Delete (also `Delete`).
- **Colour and size:** each tool keeps its own. The colour menu has the last five colours, a main, pastel and grey palette, and any other colour. Click an active pencil or highlighter again for its size.
- **Undo and redo:** `Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y` (for strokes, moves, colours, paper and pages).
- **Fingers:** fingers draw until a stylus touches a page; then fingers scroll (and pinch in the full-screen tab) and only the stylus draws. The hand button switches finger drawing back on.

## The AI

- **Ask AI:** the AI reads what you wrote since its last reply and answers under it in a handwriting font, on the lines. A reply that does not fit goes to the top of the next page.
  - It also transcribes your handwriting and keeps that text in the note, so search finds handwritten notes.
- **Language:** the AI replies in English, in Romanian when your writing is clearly Romanian (with or without diacritics), and in Dutch when it is clearly Dutch. A word shared by several languages, like *SALUT*, gets an English reply.
- **Quiz me:** the AI asks a question on the note. Write your answer and press **Quiz me** again; it marks your answer and asks the next question.
- **Discuss with AI:** select a passage in a PDF (or click an annotation) and choose **Discuss with AI** from the popup.
  - This creates a note under *AI discussions / <PDF name>* with the quote, a link back to the PDF and the AI's opening explanation, so you can keep discussing by hand.

## Setup

1. **Pick a model.** Settings → AI: add any provider (Anthropic's OpenAI-compatible endpoint, OpenAI, OpenRouter, a local server…) and choose it as the **agent** model. KMG Ink uses the agent model, or the editing model if no agent model is set.
   - The model must accept images to read handwriting.
   - For Claude: base URL `https://api.anthropic.com/v1/`, your API key, and a Claude model name.
2. **The plugin** comes with KMG and is switched on in every workspace. Settings → Marketplace → Downloaded switches it off or on.

## Where things are stored

- Each notebook is `data/assets/kmg-ink/<id>.json`, so it syncs with the workspace. Your tools, colours and last paper are in the plugin's settings.
- The note holds a block like this:

  ```
  ;;;kmg-ink/page
  {"v":1,"file":"assets/kmg-ink/<id>.json"}
  Me: <transcribed handwriting>
  AI: <reply>
  ;;;
  ```

- A handwriting page from KMG Ink 0.1 opens as a notebook: its long sheet is cut into pages between lines of writing, and its replies keep their size.
- The request goes through the KMG kernel (`/api/ai/ink/reply`). The API key never reaches the page.
- Only the newest strokes are sent, as a black-on-white PNG, together with the note's text as context.

## Development

`index.js` is generated: edit `src/*.js` (joined in name order into one scope) and run `python3 build.py`. `node test/logic.test.js` tests the parts that need no page. The Arch package ships neither `src/` nor `test/`.

## Licences

- The replies use [Caveat](https://github.com/googlefonts/caveat), under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
- Strokes are drawn with [perfect-freehand](https://github.com/steveruizok/perfect-freehand) 1.2.3, under the MIT License (`LICENSES/perfect-freehand.txt`).
