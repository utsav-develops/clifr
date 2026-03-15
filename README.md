# errsplain ⚡

AI-powered terminal error summarizer. When a command fails, it instantly streams a plain-English explanation below the raw error — before you've finished reading line 1.

```
$ ep npm install

npm ERR! code EACCES
npm ERR! syscall mkdir
npm ERR! path /usr/local/lib/node_modules
... (raw error prints immediately) ...

── errsplain ────────────────────────────────────────────────────
⚡ You don't have write permission to /usr/local/lib. Run:
   sudo npm install -g <package>
─────────────────────────────────────────────────────────────────
  run with --raw to see full error only
```

## How it works

- Runs your command normally — stdout/stderr print **immediately**, zero delay
- If exit code is non-zero, **streams** a 1-2 sentence explanation from Claude Haiku
- First word of explanation appears in ~200-400ms (time-to-first-token)
- Raw error is always shown first — the AI summary appears below it
- Short input = fast response: stderr is trimmed to last 15 lines before sending

## Install

```bash
git clone <this repo>
cd errsplain
npm install
npm link        # makes `ep` and `errsplain` available globally
```

## Setup

```bash
ep --setup      # prompts for your Anthropic API key, saves to ~/.config/errsplain/config.json
```

Or set it as an env var:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
ep <any command>

ep git push origin main
ep npm install
ep brew install node
ep python train.py
ep docker build .
```

## Options

```
--raw              Skip AI explanation, just run the command
--setup            Configure API key
--install-hook     Add auto-explain hook to .zshrc / .bashrc (experimental)
--version          Show version
```

## Shell hook (optional)

Instead of prefixing every command with `ep`, you can install a shell hook that watches for any failing command and explains it automatically:

```bash
ep --install-hook
source ~/.zshrc
```

Note: hook mode only shows the summary after the fact. `ep <cmd>` mode is recommended for the best experience — raw output + summary in one flow.

## Config

API key is saved to `~/.config/errsplain/config.json`. You can also set `ANTHROPIC_API_KEY` in your environment — the env var takes precedence.

## Why Haiku?

Claude Haiku has the lowest time-to-first-token of Anthropic's models (~200-400ms for short prompts). Combined with streaming, the user sees the first word of the explanation almost immediately after the raw error finishes printing. Larger models would add 1-3 seconds of waiting — enough to break the feeling of "instant".
