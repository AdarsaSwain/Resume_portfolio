# Resume to Portfolio

People paste or upload a resume and get a finished one-page portfolio site they can download, host, or share by link. It ships as a complete site and as a plugin you can drop into another site.

## What is here

| Path | What it is |
|---|---|
| `public/index.html` | The full site: landing page with the builder |
| `public/view.html` | The page that opens shared portfolio links |
| `public/embed-demo.html` | The plugin running inside a differently styled page |
| `public/plugin/resume-portfolio.js` | The plugin: one file, no dependencies |
| `server.js` | Optional Node server: serves `public/` and adds AI parsing |

## Run it

**No server.** Open `public/index.html` in a browser, or upload the `public/` folder to any static host (GitHub Pages, Netlify, Vercel). Resumes are parsed in the browser.

**With AI parsing.** Claude reads the resume and writes the sections, which handles messy resumes much better than the built-in parser.

```bash
npm install
# PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
export ANTHROPIC_API_KEY=sk-ant-...
npm start          # http://localhost:3000
```

Without a key the server still runs and the builder uses the built-in parser.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns AI parsing on |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for parsing |
| `PORT` | `3000` | Port |
| `RATE_LIMIT` | `10` | Builds allowed per IP per 10 minutes |
| `ALLOWED_ORIGINS` | none | Comma-separated origins of other sites allowed to call `/api/parse` |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limiting sees real IPs |

## Use it as a plugin

Copy `public/plugin/resume-portfolio.js` and `public/view.html` to your site, then:

```html
<script src="/plugin/resume-portfolio.js" defer></script>

<resume-portfolio
  theme="midnight"
  accent="#0f8a5f"
  parse-endpoint="/api/parse"
  share-url="/view.html">
</resume-portfolio>
```

The element keeps its styles inside a shadow root, lays itself out from the width you give it, and follows your page's `color-scheme`.

### Attributes (all optional)

| Attribute | Meaning |
|---|---|
| `parse-endpoint` | URL that accepts `POST {"text": "..."}` and returns portfolio JSON. Without it the built-in parser is used. If the call fails, the built-in parser takes over. |
| `share-url` | Page that shows shared portfolios. Default: `view.html` one level above the script. |
| `theme` | `clean`, `midnight`, `editorial`, `sand` or `terminal` |
| `accent` | Starting accent colour as `#rrggbb` |
| `scheme` | `light` or `dark` to force the builder's own colours |
| `storage-key` | localStorage key for the visitor's draft. `none` turns saving off. |

### Events

```js
document.addEventListener('portfolio-built', e => {
  e.detail.data;    // structured portfolio
  e.detail.html;    // complete HTML document
  e.detail.source;  // "ai" or "parser"
});
document.addEventListener('portfolio-shared', e => e.detail.url);
```

### Methods

```js
const el = document.querySelector('resume-portfolio');
el.setResume(text);        // fill in and build
el.build();
el.getData();
el.getHTML();
await el.getShareUrl();
```

`window.ResumePortfolio` also exposes `parse(text)`, `normalize(data)`, `toHTML(data, theme, accent)`, `themes` and `mountShared(target)` for use without the element.

### Portfolio JSON

This is what `parse-endpoint` must return and what `portfolio-built` gives you:

```json
{
  "name": "", "title": "", "location": "", "email": "", "phone": "",
  "tagline": "", "summary": "",
  "links": [{ "label": "", "url": "" }],
  "experience": [{ "role": "", "company": "", "location": "", "dates": "", "bullets": [""] }],
  "projects": [{ "name": "", "description": "", "tech": [""], "url": "" }],
  "skills": [{ "group": "", "items": [""] }],
  "education": [{ "degree": "", "school": "", "dates": "", "details": "" }],
  "certifications": [""]
}
```

## How share links work

A share link holds the whole portfolio, compressed, after the `#` in the URL. Nothing is stored on a server, so there is no database to run and links never expire. The trade-offs: links are long, and a shared portfolio cannot be edited or taken down after the link is sent.

## Security notes

- Everything from a resume or a share link is escaped before it reaches the page, and only `https://` links and valid email addresses become clickable.
- `/api/parse` limits request size and rate per IP. Put real rate limiting or sign-in in front of it before heavy public use, because each build spends API credit.
- Keep `ANTHROPIC_API_KEY` on the server. It is never sent to the browser.
