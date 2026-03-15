<div align="center">

# clifr ⚡

**AI-powered terminal error summarizer**

When a command fails, clifr instantly explains what went wrong and gives you the exact fix — in plain English, before you've finished reading line one.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![Powered by Groq](https://img.shields.io/badge/powered%20by-Groq-orange)](https://groq.com)

</div>

---

## demo

```
$ git push origin fake-branch
fatal: 'fake-branch' does not appear to be a git repository

────────────────────────────────────────────────────────
 what  remote branch doesn't exist yet
 fix   git push --set-upstream origin fake-branch
────────────────────────────────────────────────────────
```

```
$ pip3 install tensorflow
ERROR: Could not find a version that satisfies the requirement tensorflow (from versions: none)
ERROR: No matching distribution found for tensorflow

────────────────────────────────────────────────────────
 what  tensorflow doesn't support Python 3.14 yet
 fix   python3.13 -m pip install tensorflow
 tip   tensorflow supports up to Python 3.13
────────────────────────────────────────────────────────
```

---

## how it works

- runs your command normally — output prints **immediately**, zero delay
- if it fails, explains the error using an LLM
- **self-routing**: fast `llama-3.1-8b` handles simple errors; escalates to `llama-3.3-70b` when it flags the problem as too complex
- **live registry lookups**: pip errors hit PyPI, npm errors hit the npm registry, brew hits Homebrew, gem hits RubyGems — real version data, not hallucinated fixes
- fix command is **auto-copied to clipboard**
- confidence bar only shown when the model is uncertain (< 60%)
- **zero dependencies** — uses Node's built-in `fetch`, no `node_modules`

---

## install

**requirements**: Node.js ≥ 18, macOS

```bash
git clone https://github.com/utsav-develops/clifr
cd clifr
npm link
```

get a **free** Groq API key at [console.groq.com](https://console.groq.com) — no credit card needed.

```bash
ep --setup
# or
clifr --setup
```

---

## usage

both `ep` and `clifr` are the same command — use whichever you prefer.

### prefix mode

wrap any command with `ep` or `clifr`:

```bash
ep git push origin main
ep npm install
ep pip3 install tensorflow
ep brew install node
ep gem install rails
```

### shell hook — recommended

install once, and every failing command in your terminal gets explained automatically. no prefix needed.

```bash
ep --install-hook
source ~/.zshrc   # or ~/.bashrc
```

after that, just use your terminal normally:

```
$ pip3 install tensorflow
ERROR: No matching distribution found for tensorflow

────────────────────────────────────────────────────────
 what  tensorflow doesn't support Python 3.14 yet
 fix   python3.13 -m pip install tensorflow
────────────────────────────────────────────────────────
```

---

## options

| command             | description                                     |
| ------------------- | ----------------------------------------------- |
| `ep --setup`        | save your Groq API key                          |
| `ep --install-hook` | auto-explain all failing commands in your shell |
| `ep --raw <cmd>`    | run a command without explanation               |
| `ep --version`      | show version                                    |

| env var         | description                                   |
| --------------- | --------------------------------------------- |
| `CLIFR_OFF=1`   | temporarily disable the shell hook            |
| `CLIFR_DEBUG=1` | show registry lookups and raw model responses |

---

## ecosystem support

| ecosystem    | registry         | what clifr fetches                                        |
| ------------ | ---------------- | --------------------------------------------------------- |
| Python / pip | PyPI             | latest version, `requires_python`, tested Python versions |
| Node / npm   | npm registry     | latest version, engine requirements                       |
| Homebrew     | formulae.brew.sh | formula version, description                              |
| Ruby / gem   | RubyGems         | gem version, Ruby requirement                             |

---

## why it's fast

Groq's hardware is built for inference speed. `llama-3.1-8b-instant` has a time-to-first-token of ~200ms on short prompts. For most errors the explanation appears almost immediately after the command output. The 70b model only kicks in when the 8b flags an error as too complex (version conflicts, dependency issues, etc.).

---

## contributing

see [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## license

MIT © [Utsav Acharya](https://github.com/utsav-develops)
