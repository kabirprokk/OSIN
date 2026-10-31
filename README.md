# OSIN CLI

OSIN is a Windows-first AI coding CLI. It opens a project workspace, plans a
task, inspects code, edits files, runs tests or shell commands, and shows the
resulting diff. Its interface is keyboard-first, mouse-enabled, monochrome with
a small purple accent, and retains the sponsor panel.

## Install from this source checkout

Requires Node.js 18+ and npm. From the repository root:

```powershell
npm install --global .
osin
```

The public npm package is updated only when a release is published; these
changes are available from this checkout.

## First launch

OSIN opens a guided provider setup. Choose **OpenAI / ChatGPT account sign-in**
to open the browser and connect your account, or choose API-key setup for
OpenAI, Anthropic, OpenRouter, Groq, Together AI, and custom HTTPS endpoints.
Anthropic uses its native Messages API, including tool calling and streaming.
OSIN bundles
the OpenAI Codex sign-in/runtime component, so you do not need to install a
second CLI. API-key setup lists models and tests that the selected model
supports tool/function calling before saving settings. API credentials are
saved in the per-user OSIN config. ChatGPT subscription access and API usage
are different provider paths; API providers may charge separately.

At each launch, type or accept the suggested workspace folder. Chats, plans,
command output, and changed-file details are saved locally per project. Common
secret paths are excluded from direct file tools, and obvious direct shell
references to secret files are blocked.

The first file edit or shell/Git action asks once for workspace permission. The
approval applies for that OSIN process. OSIN shows a plan/todo list, live agent
activity, changed files, and command output in a separate panel; after work, use
`/diff` to review the changes. Press Esc to stop an in-progress task. Use `/`
to see available commands.

ChatGPT account mode uses the bundled OpenAI Codex runtime in its
workspace-write sandbox after OSIN session approval. That runtime manages its
own file access, so its secret-file protections are not the same as OSIN's
direct API-agent filters. Keep secrets outside project files where possible.

## Useful commands

- `/setup` — connect or change provider
- `/model` and `/test-model` — select/test the active model
- `/plan` — show the current task plan and todos
- `/diff` — review project changes
- `/output` or `Ctrl+O` — view command output
- `/new`, `/clear`, `/undo` — manage chats
- `/signin` — open browser sign-in for your ChatGPT account
- `/exit` — close OSIN

OSIN checks npm for updates in the background. `/update` installs a published
release; `OSIN_DISABLE_UPDATE_CHECK=1` disables the check. The check requests
public version metadata only.

## Develop and test

```powershell
npm test
node osin.js --version
```

The CLI has no runtime dependencies. `WEB/` contains the website source.
