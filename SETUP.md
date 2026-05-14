# Setup: Pushing this to GitHub with Claude Code

Step-by-step to take this folder, push it as a new GitHub repo, and use [Claude Code](https://docs.claude.com/en/docs/claude-code) for ongoing iteration.

---

## 1. One-time setup

If you haven't already, install Claude Code and the GitHub CLI:

```bash
# Claude Code (see https://docs.claude.com/en/docs/claude-code for current instructions)
npm install -g @anthropic-ai/claude-code

# GitHub CLI
brew install gh        # macOS
# OR
winget install GitHub.cli  # Windows
# OR
sudo apt install gh    # Linux

gh auth login
```

---

## 2. Initialize the repo locally

From the `vtf-message-reader/` directory:

```bash
cd vtf-message-reader

git init
git add .
git commit -m "Initial commit: VTF Message Reader v1.5.0"
```

---

## 3. Personalize before publishing

Two things to update before pushing:

**a) `LICENSE`** — Replace `[Your Name]` with your actual name on the Copyright line.

**b) `CHANGELOG.md`** — At the bottom, replace `YOUR-USERNAME` in the comparison links with your GitHub username.

**c) `vtf-message-reader.user.js`** (optional but nice) — Add `@homepage` and `@supportURL` lines to the metadata block so Tampermonkey shows useful links:

```javascript
// @homepage     https://github.com/YOUR-USERNAME/vtf-message-reader
// @supportURL   https://github.com/YOUR-USERNAME/vtf-message-reader/issues
// @updateURL    https://raw.githubusercontent.com/YOUR-USERNAME/vtf-message-reader/main/vtf-message-reader.user.js
// @downloadURL  https://raw.githubusercontent.com/YOUR-USERNAME/vtf-message-reader/main/vtf-message-reader.user.js
```

The `@updateURL` / `@downloadURL` lines enable one-click auto-update in Tampermonkey.

---

## 4. Create the GitHub repo and push

```bash
# Create a new public repo and push in one command:
gh repo create vtf-message-reader --public --source=. --remote=origin --push

# OR, if you prefer private:
gh repo create vtf-message-reader --private --source=. --remote=origin --push
```

That's it — your repo is now live at `https://github.com/YOUR-USERNAME/vtf-message-reader`.

---

## 5. Add nice-to-haves on GitHub

Once the repo is on GitHub, consider:

- **Topics**: Click "About" → gear icon → add tags like `userscript`, `tampermonkey`, `text-to-speech`, `chat`, `trading`, `accessibility`.
- **Description**: Something like *"Reads VTF Virtual Trading Floor chat messages aloud in real time."*
- **Release**: Tag v1.5.0 → `gh release create v1.5.0 --title "v1.5.0" --notes-from-tag` (after creating a git tag with `git tag v1.5.0 && git push --tags`).

---

## 6. Iterating with Claude Code

In the project directory:

```bash
cd vtf-message-reader
claude
```

Claude Code will automatically read `CLAUDE.md` and have full context on:
- What this project does
- The Angular DOM structure of VTF
- Code conventions used in the single file
- How to bump versions and update the changelog
- Things to NOT do (split into multiple files, add dependencies, etc.)

### Example prompts for Claude Code

- *"Add keyboard shortcuts — space to pause/resume, right arrow to skip."*
- *"Add a 'whitelist' mode where only specific users' messages are read, opposite of the ignore list."*
- *"Long messages over 200 characters should be truncated to the first sentence."*
- *"Add a notification toast in the panel when a message from an ignored user comes in."*
- *"Replace the auto-detection with a hardcoded `app-roomscroller` selector and remove the picker."*

### Workflow Claude Code will follow

Per the conventions in `CLAUDE.md`, when you ask for a change Claude Code will:

1. Edit `vtf-message-reader.user.js`.
2. Bump the `@version` field in the metadata header.
3. Add an entry to `CHANGELOG.md`.
4. Commit with a descriptive message.
5. Create a PR via `gh pr create`.

---

## 7. Creating a PR for the first change

If you're working on a feature branch:

```bash
git checkout -b feature/keyboard-shortcuts

# Make changes (or have Claude Code do it)

git add .
git commit -m "Add keyboard shortcuts for playback controls"
git push -u origin feature/keyboard-shortcuts

gh pr create --title "Add keyboard shortcuts for playback controls" --body "Adds:
- Space to pause/resume
- Right arrow to skip
- Escape to stop

Updates CHANGELOG and bumps version to 1.6.0."
```

Claude Code can do all of this autonomously if asked.

---

## Files you're shipping

```
vtf-message-reader/
├── .gitignore
├── CHANGELOG.md
├── CLAUDE.md
├── LICENSE
├── README.md
├── SETUP.md                      ← this file
└── vtf-message-reader.user.js    ← the entire product
```

Once published, end users only need the `.user.js` file (they can grab it from the GitHub raw URL or click "Install" if you ever publish to Greasy Fork).
