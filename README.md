# OSIN CLI

OSIN is a terminal-based AI coding assistant with a mouse-enabled chat
workspace, text-file attachments, large-paste handling, and slash commands.
It supports OpenAI-compatible APIs and ChatGPT account access through the
official Codex CLI. OSIN does not run shell commands or directly edit project
files.

## Install globally

Install OSIN globally from the public npm registry:

```sh
npm install --global @kabirprokk/osin-cli
```

The `osin` command is then available from any directory. Node.js 18 or newer
and npm are required.

Update an existing global installation with:

```sh
npm install --global @kabirprokk/osin-cli@latest
```

Then restart OSIN.

To install from the source repository instead, clone it and run
`npm install --global .` from its root:

```sh
git clone https://github.com/kabirprokk/OSIN.git
cd OSIN
npm install --global .
```

The `WEB/` directory contains the OSIN website source.

## Configure

Create per-user configuration files:

```sh
osin init
```

Edit the generated `.env` file and set the API key, OpenAI-compatible API base
URL, and model ID for your provider:

```dotenv
OSIN_API_KEY=your_provider_key
OSIN_BASE_URL=https://api.openai.com/v1
OSIN_MODEL=gpt-4o-mini
```

OSIN currently sends OpenAI-compatible Chat Completions requests. Use `/models`
to query model IDs exposed by that provider to your key; a returned model may
not necessarily support chat completions. Legacy `GROQ_*` and `OPENAI_*`
environment variables are recognized. Existing process environment variables
take precedence over values in the config file.

To use your ChatGPT account instead, install the official Codex CLI and type
`/signin` inside OSIN. Codex handles the browser/device sign-in and account
credentials; OSIN does not read or store those credentials. Type `/model` to
browse the visible Codex models, `/test-model` to test the selected model, or
`/api` to return to the configured API-key provider. Codex responses are run in
read-only mode. A model is only excluded from the API model picker after the
provider explicitly reports that the model is unsupported.

- Windows: `%APPDATA%\OSIN\.env`
- macOS and Linux: `$XDG_CONFIG_HOME/osin/.env`, or `~/.config/osin/.env`

Then start the workspace:

```sh
osin
```

Use `osin --help` for command-line options. Inside the workspace, type `/` to
see available commands. OSIN checks npm for a newer release in the background
and shows an `/update` prompt when one is available. Run `/update` to install
the latest release, then exit and restart OSIN. Set
`OSIN_DISABLE_UPDATE_CHECK=1` to disable the background check. The check only
requests public version metadata from npm; it doesn't send your API key or
model conversation. Use `/attach <path>` to attach a UTF-8 text file.

The config directory also stores optional `sponsors.json` and local aggregate
`metrics.json` data. A clearly labeled sponsor appears only in the welcome view
and hides after the first prompt or a click. Metrics are not uploaded. Keep API
keys private and do not attach secret files.

## Develop and test

```sh
npm test
node osin.js --version
```

The project has no runtime dependencies.
