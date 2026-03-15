# contributing to clifr

thanks for taking the time to contribute. clifr is a small focused tool — keep it simple and fast.

---

## what we're looking for

- **new ecosystem support** — cargo, composer, pip on linux, etc. each registry is a small fetch function, ~15 lines
- **prompt improvements** — better LLM instructions that produce more accurate fixes
- **shell compatibility** — fish shell support, bash edge cases
- **linux support** — currently macOS only (`pbcopy`); PRs adding `xclip`/`xdotool` for linux welcome
- **bug fixes** — especially around error detection patterns or registry parsing

## what we're not looking for

- new npm dependencies — clifr has zero by design
- UI/output changes that add noise
- breaking changes to the CLI interface

---

## setup

```bash
git clone https://github.com/utsav-develops/clifr
cd clifr
npm link          # registers `ep` and `clifr` globally from your local clone
ep --setup        # add your Groq API key (free at console.groq.com)
```

debug mode shows registry lookups and raw model responses:

```bash
CLIFR_DEBUG=1 ep <command>
```

---

## adding a new registry

each registry is one async function in `bin/clifr.js`. pattern:

```js
async function fetchCargo(pkg) {
  try {
    const name = pkg.trim().split(/[@=]/)[0];
    const res = await fetch(`https://crates.io/api/v1/crates/${name}`, {
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "clifr/2.0" }, // crates.io requires a UA
    });
    if (!res.ok) return null;
    const data = await res.json();
    return `crates.io: ${name}@${data.crate?.newest_version} | rust: ${data.crate?.rust_version ?? "?"}`;
  } catch {
    return null;
  }
}
```

then add a detection pattern in `fetchRegistryInfo()`:

```js
// Cargo
const cargoPkg =
  trimmed.match(/error.*`([\w_]+)`.*not found/i)?.[1] ??
  (command.startsWith("cargo add") ? command.split(/\s+/)[2] : null);
if (cargoPkg) return fetchCargo(cargoPkg);
```

rules:

- always return `null` on failure, never throw
- keep the returned string short — it goes directly into the LLM prompt
- test with `CLIFR_DEBUG=1 ep <command>` to verify the `[registry]` line shows up

---

## pull request checklist

- [ ] `CLIFR_DEBUG=1 ep <command>` shows the registry data being fetched
- [ ] simple errors (permission denied, file not found) still use the fast 8b path — no regression
- [ ] no new npm dependencies
- [ ] `source ~/.zshrc` after `ep --install-hook` loads without errors

---

## reporting a bug

open an issue with:

1. the exact command you ran
2. what clifr showed
3. what you expected
4. output of `CLIFR_DEBUG=1 ep <same command>`
5. `ep --version` and `node --version`

---

## code style

- ES modules only (`import`/`export`)
- zero npm dependencies
- `async`/`await`, no callbacks
- errors caught silently where they'd interrupt the user's workflow — clifr should never crash a terminal session
- keep prompts tight — every extra token adds latency

---

## license

by contributing, you agree your code will be released under the [MIT license](./LICENSE).
