import { useEffect, useState } from "react";
import InteractiveAtmosphere from "./components/InteractiveAtmosphere";
import LightBg from "./components/LightBg";
import ScrollProgress from "./components/ScrollProgress";
import ScrollReveal from "./components/ScrollReveal";

const GITHUB = "https://github.com/kabirprokk/OSIN";
const INSTALL = "npm install -g @kabirprokk/osin-cli";

function SectionLabel({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="section-label">
      <span>{number} / {title}</span><i aria-hidden="true" /><span>{detail}</span>
    </div>
  );
}

function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const closeMenu = () => setMenuOpen(false);
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="OSIN home" onClick={closeMenu}>
        <img src="/osin-logo-source.png" width="36" height="36" alt="" />
        <span>OSIN<span className="brand-dot">.</span></span>
      </a>
      <button className="menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="site-nav" aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen((open) => !open)}>
        <span /><span />
      </button>
      <nav className={`site-nav${menuOpen ? " is-open" : ""}`} id="site-nav" aria-label="Main navigation">
        <a href="#features" onClick={closeMenu}>Features</a>
        <a href="#how" onClick={closeMenu}>How it works</a>
        <a className="nav-link" href={GITHUB} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow"><span className="status-dot" /> AN AI CODING ASSISTANT, IN YOUR TERMINAL</p>
        <h1 id="hero-title">Think it through.<br /><span>Right where you build.</span></h1>
        <p className="hero-intro">OSIN gives you a focused place to think through coding problems with AI—without leaving your terminal. Bring a compatible API endpoint and model; keep the conversation close to your work.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#get-started">Get started <span aria-hidden="true">↓</span></a>
          <a className="button button-quiet" href={GITHUB} target="_blank" rel="noreferrer">Explore the source <span aria-hidden="true">↗</span></a>
        </div>
        <p className="hero-note"><span aria-hidden="true">⌘</span> Terminal-native · Endpoint-configurable · Open source</p>
      </div>
      <div className="hero-emblem" aria-hidden="true">
        <div className="emblem-orbit emblem-orbit--one" /><div className="emblem-orbit emblem-orbit--two" />
        <span className="emblem-cross emblem-cross--h" /><span className="emblem-cross emblem-cross--v" />
        <img src="/osin-emblem-transparent.png" width="420" height="420" alt="" fetchPriority="high" />
        <span className="emblem-caption">OSIN / IN THE TERMINAL</span>
      </div>
      <div className="hero-index"><span>INDEPENDENT THINKING</span><span>01—04</span></div>
    </section>
  );
}

function TerminalShowcase() {
  return (
    <section className="showcase section-wrap" aria-labelledby="demo-title">
      <SectionLabel number="01" title="IN THE TERMINAL" detail="OSIN, running for real" />
      <ScrollReveal className="showcase-frame">
        <figure className="terminal-capture">
          <img src="/osin-terminal.png" alt="Screenshot of the real OSIN terminal interface running locally in Windows Terminal, showing its new-chat workspace and the /help command output." width="1129" height="635" fetchPriority="high" />
          <figcaption id="demo-title"><span>REAL OSIN TERMINAL CAPTURE</span><span>Captured locally while running <code>/help</code>. The interface and command output are real; no model request was made.</span></figcaption>
        </figure>
      </ScrollReveal>
    </section>
  );
}

const features = [
  { id: "01", symbol: "⌨", title: "A focused terminal workspace", text: "A mouse-enabled, keyboard-friendly chat interface with multiple conversations, recent chats, and a model settings view.", detail: "Ask a question or describe a coding task.", wide: true },
  { id: "02", symbol: "⇄", title: "Choose your endpoint", text: "Configure a model name and OpenAI-compatible chat-completions endpoint through environment variables.", detail: "OSIN_MODEL  /  GROQ_BASE_URL" },
  { id: "03", symbol: "▤", title: "Bring text into the chat", text: "Attach UTF-8 text files with /attach, or paste larger text to turn it into an attachment. File and request sizes are bounded.", detail: "notes.md  ·  READY TO ATTACH" },
  { id: "04", symbol: "/", title: "Commands that stay out of the way", text: "Use slash commands for new chats, settings, attachments, undo, copying a response, help, and usage.", detail: "/new   /attach   /usage   + more" },
  { id: "05", symbol: "◷", title: "See reported token usage", text: "When the endpoint returns usage data, OSIN totals requests and input/output tokens for the current chat. It is not a cost estimate.", detail: "INPUT ━━━━━━━━  OUTPUT ━━━━━" },
];

function Features() {
  return (
    <section className="features section-wrap" id="features">
      <SectionLabel number="02" title="BUILT FOR THE LOOP" detail="Useful details, not magic tricks" />
      <div className="section-heading">
        <div><p className="micro-label">A SMALLER DISTANCE FROM QUESTION TO CLARITY</p><h2>A calmer place<br />to <em>work it out.</em></h2></div>
        <p>OSIN is a terminal chat for coding questions. It keeps the interaction simple: choose a model, bring relevant text into the conversation, and stay in your shell.</p>
      </div>
      <div className="feature-grid">
        {features.map((feature, index) => (
          <ScrollReveal className={`feature-card${feature.wide ? " feature-wide" : ""}`} delay={Math.min(index * 0.06, 0.24)} key={feature.id}>
            <div className="feature-top"><span>{feature.id}</span><b>{feature.symbol}</b></div>
            <h3>{feature.title}</h3><p>{feature.text}</p>
            <div className={`feature-detail${feature.wide ? " mini-terminal" : ""}`}>{feature.wide && <span className="mini-prompt">›</span>}{feature.detail}{feature.wide && <i className="mini-cursor" />}</div>
          </ScrollReveal>
        ))}
      </div>
      <p className="capability-note"><span aria-hidden="true">i</span> OSIN sends chat requests to the configured endpoint. The code does not provide tools that edit project files or run shell commands.</p>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["01", "Set your endpoint", "Provide an API key and model. OSIN defaults to Groq’s OpenAI-compatible endpoint, or you can configure another compatible URL."],
    ["02", "Start a conversation", "Launch OSIN in an interactive terminal and describe the coding question you want to work through."],
    ["03", "Add context, as needed", "Attach UTF-8 text files or ask follow-up questions. OSIN sends the chat to your configured endpoint and displays its response."],
  ];
  return (
    <section className="how section-wrap" id="how">
      <SectionLabel number="03" title="HOW IT WORKS" detail="A direct path in" />
      <div className="how-layout">
        <ScrollReveal className="how-intro-block" from="left"><p className="micro-label">YOU STAY IN CONTROL</p><h2>Three steps.<br /><em>Then get to work.</em></h2><p>OSIN is a chat interface, not an autonomous agent. You decide what to ask and what context to share.</p></ScrollReveal>
        <ol className="steps">{steps.map(([number, title, text], index) => (
          <ScrollReveal key={number} delay={index * 0.09}><li><span className="step-number">{number}</span><div><h3>{title}</h3><p>{text}</p></div></li></ScrollReveal>
        ))}</ol>
      </div>
    </section>
  );
}

function GettingStarted() {
  const [copied, setCopied] = useState("");
  const [status, setStatus] = useState("");
  const commands = [INSTALL, "osin init", "osin"];

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      setStatus("Copied command to clipboard.");
      window.setTimeout(() => setCopied((current) => current === command ? "" : current), 1800);
    } catch {
      setStatus("Clipboard access is unavailable. Select and copy the command instead.");
    }
  };

  return (
    <section className="get-started section-wrap" id="get-started">
      <SectionLabel number="04" title="GETTING STARTED" detail="One install. Your terminal." />
      <div className="start-panel">
        <ScrollReveal className="start-copy" from="left">
          <span className="terminal-label"><i /> INSTALLATION</span><h2>From prompt<br /><em>to first run.</em></h2>
          <p>Install OSIN globally, create your private per-user config, add an OpenAI-compatible provider key and endpoint, then launch the workspace. No project files are changed by setup.</p>
          <ol className="install-steps">
            <li><span>01</span><div><strong>Install globally</strong><code>{INSTALL}</code></div></li>
            <li><span>02</span><div><strong>Initialize your config</strong><code>osin init</code></div></li>
            <li><span>03</span><div><strong>Set key, base URL &amp; model</strong><code>OSIN_API_KEY · OSIN_BASE_URL · OSIN_MODEL</code></div></li>
            <li><span>04</span><div><strong>List available models, then launch</strong><code>/models · osin</code></div></li>
          </ol>
          <a className="text-link" href={GITHUB} target="_blank" rel="noreferrer">Read the complete installation guide <span aria-hidden="true">↗</span></a>
        </ScrollReveal>
        <ScrollReveal className="setup-terminal" from="right" delay={0.12}>
          <div className="setup-bar"><span>OSIN / QUICKSTART</span><span className="setup-live"><i /> PUBLIC NPM RELEASE LIVE</span></div>
          <div className="setup-content">
            <p># Install globally from npm</p><Command command={commands[0]} copied={copied === commands[0]} onCopy={copyCommand} />
            <p># Create your per-user config</p><Command command={commands[1]} copied={copied === commands[1]} onCopy={copyCommand} />
            <p># Set OSIN_API_KEY, OSIN_BASE_URL and OSIN_MODEL</p><p># In the app: /models lists your provider's models</p>
            <Command command={commands[2]} copied={copied === commands[2]} onCopy={copyCommand} />
            <p className="setup-footnote">Requires Node.js 18+. OSIN currently supports OpenAI-compatible Chat Completions APIs. See the README for provider configuration.</p>
            <p className="copy-status" aria-live="polite">{status}</p>
          </div>
        </ScrollReveal>
      </div>
      <p className="domain-note"><span aria-hidden="true">⌁</span> Prepared for <strong>osin.pages.dev</strong> · Cloudflare Pages deployment</p>
    </section>
  );
}

function Command({ command, copied, onCopy }: { command: string; copied: boolean; onCopy: (command: string) => void }) {
  return <div className="install-command"><code>{command}</code><button type="button" className="copy-command" onClick={() => onCopy(command)} aria-label={`${copied ? "Copied" : "Copy"} command: ${command}`}>{copied ? "COPIED" : "COPY"}</button></div>;
}

function SiteFooter() {
  return (
    <>
      <section className="final-cta section-wrap"><div className="cta-rule" /><div className="cta-content">
        <div className="cta-brand"><img src="/osin-logo-source.png" alt="" width="48" height="48" /><span>OSIN</span></div>
        <div><p className="micro-label">OPEN SOURCE. YOUR WORKFLOW.</p><h2>Make room for<br /><em>the next good question.</em></h2><p>Explore the source and see if OSIN fits your workflow.</p></div>
        <a className="button button-primary" href={GITHUB} target="_blank" rel="noreferrer">View OSIN on GitHub <span aria-hidden="true">↗</span></a>
      </div></section>
      <footer className="site-footer"><a className="footer-brand" href="#top"><img src="/osin-logo-source.png" alt="" width="27" height="27" /><span>OSIN</span></a><p>AI coding, funded intelligently.</p><a href={GITHUB} target="_blank" rel="noreferrer">Source on GitHub ↗</a><span className="copyright">© OSIN · Built for the terminal.</span></footer>
    </>
  );
}

export default function App() {
  return (
    <div className="site-shell">
      <LightBg /><InteractiveAtmosphere /><ScrollProgress />
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="page-content"><SiteHeader /><main id="main"><Hero /><TerminalShowcase /><Features /><HowItWorks /><GettingStarted /><SiteFooter /></main></div>
    </div>
  );
}
