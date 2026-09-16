# KMG Ink

You write by hand in KMG, and the AI writes back on the page.

- **Handwriting page:** type `/ink` (or `/handwriting`) in a note.
  - Write with a stylus, a mouse or a touchpad.
  - Once a stylus has touched the page, fingers scroll instead of drawing.
  - The eraser removes whole strokes. Undo removes the last stroke that hasn't been sent yet.
- **Ask AI:** the AI reads what you wrote since its last reply and answers under it in a handwriting font.
  - It also transcribes your handwriting and keeps that text in the block, so search finds handwritten notes.
- **Quiz me:** the AI asks a question on the note. Write your answer and press **Quiz me** again; it marks your answer and asks the next question.
- **Discuss with AI:** select a passage in a PDF (or click an annotation) and choose **Discuss with AI** from the popup.
  - This creates a note under *AI discussions / <PDF name>* with the quote, a link back to the PDF and the AI's opening explanation, so you can keep discussing by hand.

## Setup

1. **Pick a model.** Settings → AI: add any provider (Anthropic's OpenAI-compatible endpoint, OpenAI, OpenRouter, a local server…) and choose it as the **agent** model. KMG Ink uses the agent model, or the editing model if no agent model is set.
   - The model must accept images to read handwriting.
   - For Claude: base URL `https://api.anthropic.com/v1/`, your API key, and a Claude model name.
2. **Enable the plugin.** Settings → Marketplace → Downloaded: enable **KMG Ink**.

## Where things are stored

- Strokes and replies are saved in `data/assets/kmg-ink/<id>.json`, so they sync with the workspace.
- The note holds a block like this:

  ```
  ;;;kmg-ink/page
  {"v":1,"file":"assets/kmg-ink/<id>.json"}
  Me: <transcribed handwriting>
  AI: <reply>
  ;;;
  ```

- The request goes through the KMG kernel (`/api/ai/ink/reply`). The API key never reaches the page.
- Only the newest strokes are sent, as a black-on-white PNG, together with the note's text as context.

## Font

The replies use [Caveat](https://github.com/googlefonts/caveat), under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
