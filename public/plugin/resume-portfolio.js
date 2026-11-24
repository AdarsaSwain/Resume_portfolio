/*!
 * Resume to Portfolio plugin
 * One script tag gives any page a <resume-portfolio> element: visitors paste or
 * upload a resume and get a finished one-page portfolio site they can download
 * or share by link.
 *
 *   <script src="plugin/resume-portfolio.js" defer></script>
 *   <resume-portfolio></resume-portfolio>
 *
 * Attributes (all optional)
 *   parse-endpoint  URL that takes POST {"text": "..."} and returns portfolio JSON
 *                   (AI parsing). Without it the built-in parser runs in the browser.
 *   share-url       URL of the page that shows shared portfolios (default: ../view.html
 *                   next to this script).
 *   theme           clean | midnight | editorial | sand | terminal
 *   accent          #rrggbb
 *   scheme          light | dark (default: follows the host page)
 *   storage-key     localStorage key for the visitor's draft; "none" turns saving off
 *
 * Events (bubble out of the element)
 *   portfolio-built   detail: { data, html, source: "ai" | "parser" }
 *   portfolio-shared  detail: { url }
 *
 * Methods
 *   el.getData()  el.getHTML()  el.setResume(text, { build })  el.build()  el.getShareUrl()
 *
 * Also exposed: window.ResumePortfolio = { parse, normalize, toHTML, themes, mountShared }
 */
(function () {
'use strict';
if (window.ResumePortfolio) return;
const SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';

// ---- resume parsing and site rendering ----
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str = (v, max = 400) => (typeof v === 'string' || typeof v === 'number') ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '';
const arr = v => Array.isArray(v) ? v : [];
const strs = (v, max = 200) => arr(v).map(x => str(x, max)).filter(Boolean);

function safeUrl(u) {
  u = str(u, 300).replace(/[),.;]+$/, '');
  if (!u) return '';
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  else if (!/^https:\/\//i.test(u)) {
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u)) u = 'https://' + u;
    else return '';
  }
  return /^https:\/\/[^\s"'<>`]+$/i.test(u) ? u : '';
}
const isEmail = e => /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[a-z]{2,}$/i.test(e);
function linkLabel(u) {
  const h = u.replace(/^https:\/\/(www\.)?/i, '').toLowerCase();
  const known = [['linkedin.','LinkedIn'],['github.','GitHub'],['gitlab.','GitLab'],['x.com','X'],['twitter.','X'],['behance.','Behance'],['dribbble.','Dribbble'],['medium.','Medium'],['leetcode.','LeetCode'],['kaggle.','Kaggle'],['youtube.','YouTube']];
  for (const [k, v] of known) if (h.startsWith(k)) return v;
  return h.split('/')[0];
}

function normalize(d) {
  d = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  const seen = new Set();
  const links = arr(d.links).map(l => {
    const url = safeUrl(typeof l === 'string' ? l : l && l.url);
    if (!url || seen.has(url.toLowerCase())) return null;
    seen.add(url.toLowerCase());
    return { label: str(l && l.label, 40) || linkLabel(url), url };
  }).filter(Boolean).slice(0, 6);
  const email = str(d.email, 120);
  return {
    name: str(d.name, 80) || 'Your Name',
    title: str(d.title, 100),
    location: str(d.location, 80),
    email: isEmail(email) ? email : '',
    phone: str(d.phone, 40),
    tagline: str(d.tagline, 180),
    summary: str(d.summary, 1400),
    links,
    experience: arr(d.experience).map(e => ({ role: str(e && e.role, 100), company: str(e && e.company, 100), location: str(e && e.location, 80), dates: str(e && e.dates, 60), bullets: strs(e && e.bullets, 320).slice(0, 8) })).filter(e => e.role || e.company).slice(0, 12),
    projects: arr(d.projects).map(p => ({ name: str(p && p.name, 100), description: str(p && p.description, 600), tech: strs(p && p.tech, 40).slice(0, 10), url: safeUrl(p && p.url) })).filter(p => p.name).slice(0, 12),
    skills: arr(d.skills).map(g => ({ group: str(g && g.group, 50) || 'Skills', items: strs(g && g.items, 50).slice(0, 24) })).filter(g => g.items.length).slice(0, 10),
    education: arr(d.education).map(e => ({ degree: str(e && e.degree, 160), school: str(e && e.school, 160), dates: str(e && e.dates, 60), details: str(e && e.details, 320) })).filter(e => e.degree || e.school).slice(0, 6),
    certifications: strs(d.certifications, 160).slice(0, 12)
  };
}

const HEADS = [
  ['summary', /^(professional |career )?(summary|profile|about( me)?|objective)$/],
  ['experience', /^((work|professional|relevant) )?(experience|employment( history)?|work history)$/],
  ['projects', /^((personal|key|selected|side|academic|notable) )?projects$/],
  ['skills', /^((technical|core|key) )?(skills|competencies)( (&|and) tools)?$|^tech(nical)? stack$|^tools$/],
  ['education', /^education( (&|and) training)?$|^academics?$|^qualifications$/],
  ['certifications', /^(certifications?|certificates|licenses( (&|and) certifications)?|awards( (&|and) certifications)?|achievements)$/]
];
const BUL = /^\s*(?:[-•*▪●◦‣–—]|\d+[.)])\s+/;
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DPART = `(?:${MON}\\s*'?\\d{2,4}|\\d{1,2}[/.]\\d{4}|\\d{4})`;
const DATE_RE = new RegExp(`${DPART}\\s*(?:-|–|—|to|until)\\s*(?:${DPART}|present|current|now|ongoing|today)|${DPART}`, 'i');
const titleCase = s => (s === s.toUpperCase() && /[A-Z]/.test(s)) ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;

function splitHeader(line) {
  let t = line.trim(), dates = '';
  const segs = t.split(/\s+\|\s+|\s+[·•]\s+/);
  if (segs.length > 1) {
    const i = segs.findIndex(s => DATE_RE.test(s) || /^(ongoing|present|current)$/i.test(s.trim()));
    if (i >= 0) { dates = segs[i].trim(); segs.splice(i, 1); }
    t = segs.join(' | ');
  }
  if (!dates) {
    const m = t.match(DATE_RE);
    if (m) { dates = m[0]; t = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).replace(/\(\s*\)/g, '').replace(/[\s,(|–—-]+$/, '').trim(); }
  }
  dates = dates.replace(/^\(|\)$/g, '').replace(/\s*(?:-|–|—|\bto\b)\s*/i, ' – ').trim();
  const parts = t.split(/\s+(?:—|–|-|@|at)\s+|\s+\|\s+/).map(s => s.trim()).filter(Boolean);
  return { parts, dates };
}

function entries(ls, merge = true) {
  const out = []; let c = null;
  for (const raw of ls || []) {
    const l = raw.trim();
    if (!l) continue;
    if (BUL.test(l)) {
      if (!c) { c = { parts: [], dates: '', bullets: [] }; out.push(c); }
      c.bullets.push(l.replace(BUL, '').trim());
      continue;
    }
    const h = splitHeader(l);
    if (c && c.bullets.length && !h.dates && (/^[a-z(&,]/.test(l) || l.length > 60)) { c.bullets[c.bullets.length - 1] += ' ' + l; continue; }
    if (!merge) {
      if (c && !c.bullets.length && c.parts.length === 1 && !h.dates && l.split(/\s+/).length >= 5) { c.parts.push(l); continue; }
    } else if (c && !c.bullets.length && (c.parts.length < 2 || !c.dates) && h.parts.length <= 2 && !(c.dates && h.dates)) {
      c.parts.push(...h.parts); if (!c.dates) c.dates = h.dates; continue;
    }
    c = { parts: h.parts, dates: h.dates, bullets: [] }; out.push(c);
  }
  return out;
}

function quickParse(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(l => l.replace(/\t/g, ' ').replace(/\s+$/, ''));
  const headOf = l => {
    const t = l.trim().replace(/^#+\s*/, '').replace(/[:\-–—_=*]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 40) return null;
    for (const [k, re] of HEADS) if (re.test(t)) return k;
    return null;
  };
  const sec = { head: [] }; let cur = 'head';
  for (const l of lines) { const h = headOf(l); if (h) { cur = h; sec[cur] = sec[cur] || []; continue; } (sec[cur] = sec[cur] || []).push(l); }
  const head = sec.head.map(s => s.trim().replace(/^#+\s*/, '')).filter(Boolean);
  const emailM = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  const headText = head.join('\n');
  const phone = (headText.match(/\+?\d[\d\s().-]{7,}\d/g) || []).map(p => p.trim()).find(p => { const n = p.replace(/\D/g, '').length; return n >= 9 && n <= 15; }) || '';
  const noMail = headText.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ');
  const urlRe = /(https?:\/\/[^\s|,·•]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|dev|io|me|app|in|net|org|co|ai|page|site|xyz|tech)(?:\/[^\s|,·•]*)?)/gi;
  const links = [...new Set(noMail.match(urlRe) || [])].map(url => ({ url }));
  const segsOf = l => l.split(/\s*[|·•]\s*/).map(s => s.trim()).filter(Boolean);
  const name = titleCase((segsOf(head[0] || '')[0] || '').replace(/[^\p{L}\s.'-]/gu, '').trim());
  let title = '';
  if (head[1] && !/@|https?:|www\.|\d{6,}/.test(head[1])) title = segsOf(head[1])[0] || '';
  let location = '';
  for (const l of head.slice(1)) for (const s of segsOf(l)) {
    if (location || s === title || /@|https?:|www\.|\.(com|dev|io|me|in)\b/i.test(s) || (s.match(/\d/g) || []).length > 3 || s.length > 40) continue;
    if (/,/.test(s) || /^(remote|hybrid)/i.test(s)) location = s;
  }
  const summary = (sec.summary || []).map(s => s.trim().replace(BUL, '')).filter(Boolean).join(' ');
  const experience = entries(sec.experience).map(c => {
    const p = c.parts; let company = p[1] || '', loc = p.slice(2).join(', ');
    if (!loc && company.includes(',')) { const i = company.indexOf(','); loc = company.slice(i + 1).trim(); company = company.slice(0, i).trim(); }
    return { role: p[0] || '', company, location: loc, dates: c.dates, bullets: c.bullets };
  });
  const projects = entries(sec.projects, false).map(c => {
    let p = c.parts.slice();
    if (p.length && /^[^:]{2,50}:\s/.test(p[0]) && !/^https?:/i.test(p[0])) { const i = p[0].indexOf(':'); p.splice(0, 1, p[0].slice(0, i).trim(), p[0].slice(i + 1).trim()); }
    const rest = p.slice(1); let tech = [];
    if (rest.length >= 2 && !/https?:/i.test(rest[rest.length - 1])) tech = rest.pop().split(/\s*,\s*|\s+\/\s+/).filter(Boolean);
    const all = [rest.join(' — '), ...c.bullets].filter(Boolean).join(' ');
    const urlM = all.match(/https?:\/\/[^\s|,]+/);
    return { name: p[0] || '', description: all.replace(/https?:\/\/[^\s|,]+/g, '').trim(), tech, url: urlM ? urlM[0] : '' };
  });
  const groups = [];
  for (const l of (sec.skills || []).map(s => s.trim().replace(BUL, '')).filter(Boolean)) {
    const m = l.match(/^([^:]{2,30}):\s*(.+)$/);
    const g = m ? m[1].trim() : 'Skills';
    const items = (m ? m[2] : l).split(/\s*[,;|•·]\s*/).map(s => s.trim()).filter(Boolean);
    const ex = groups.find(x => x.group.toLowerCase() === g.toLowerCase());
    if (ex) ex.items.push(...items); else groups.push({ group: g, items });
  }
  const education = entries(sec.education).map(c => ({ degree: c.parts[0] || '', school: c.parts.slice(1).join(', '), dates: c.dates, details: c.bullets.join(' ') }));
  const certifications = (sec.certifications || []).map(s => s.trim().replace(BUL, '')).filter(Boolean);
  const tagline = title ? `${title}${location ? ' based in ' + location : ''}.` : '';
  return { name, title, location, email: emailM ? emailM[0] : '', phone, tagline, summary, links, experience, projects, skills: groups, education, certifications };
}

const THEMES = {
  clean: { bg: '#ffffff', ink: '#13161c', muted: '#5a6270', line: '#e3e6eb', card: '#f4f6f8', font: 'Space Grotesk', dark: false },
  midnight: { bg: '#0d1117', ink: '#e8edf3', muted: '#9aa5b4', line: '#252e3a', card: '#151b23', font: 'Space Grotesk', dark: true },
  editorial: { bg: '#ffffff', ink: '#1a1a1a', muted: '#626262', line: '#e5e5e5', card: '#f5f5f3', font: 'Fraunces', dark: false }
};
const FONT_URL = {
  'Space Grotesk': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&amp;family=Space+Grotesk:wght@500;700&amp;display=swap',
  'Fraunces': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&amp;family=Fraunces:opsz,wght@9..144,600;9..144,700&amp;display=swap'
};

function siteCss(t, ac) {
  const disp = `'${t.font}',Inter,system-ui,sans-serif`;
  const act = t.dark ? `color-mix(in srgb,${ac} 58%,#fff)` : ac;
  return `.site{--bg:${t.bg};--ink:${t.ink};--muted:${t.muted};--line:${t.line};--card:${t.card};--ac:${ac};--act:${act};container:site/inline-size;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.site *{box-sizing:border-box;min-width:0}
.site a{color:inherit}
.site h1,.site h2,.site h3{font-family:${disp};margin:0;line-height:1.1;letter-spacing:-.02em;font-weight:700}
.wrap{max-width:1080px;margin:0 auto;padding:0 clamp(18px,5cqi,48px)}
.nav{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;gap:20px;height:64px}
.site .logo{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:var(--ac);color:#fff;font:700 15px/1 ${disp};text-decoration:none}
.links{display:flex;gap:22px;margin-left:auto}
.links a{color:var(--muted);text-decoration:none;font-size:15px}
.links a:hover{color:var(--ink)}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:999px;background:var(--ac);color:#fff!important;text-decoration:none;font-weight:600;font-size:15px;border:1.5px solid var(--ac);white-space:nowrap}
.btn.ghost{background:transparent;color:var(--ink)!important;border-color:var(--line)}
.btn.ghost:hover{border-color:var(--ink)}
.hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:clamp(24px,5cqi,56px);align-items:end;padding-block:clamp(48px,9cqi,112px) clamp(40px,6cqi,72px)}
.hero.solo{grid-template-columns:minmax(0,1fr)}
.kicker{color:var(--act);font-weight:600;margin:0 0 14px}
.hero h1{font-size:clamp(44px,9cqi,92px);line-height:1;margin-bottom:20px}
.tagline{font-size:clamp(19px,2.4cqi,24px);line-height:1.4;max-width:32ch;margin:0 0 28px}
.actions{display:flex;flex-wrap:wrap;gap:10px}
.now{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px}
.now .k{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted);margin:0 0 8px}
.now .k::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ac);box-shadow:0 0 0 4px color-mix(in srgb,var(--ac) 22%,transparent)}
.now h3{font-size:22px;margin-bottom:4px}
.now p{margin:0;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.chips li{font-size:14px;line-height:1.4;padding:5px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
.now .chips{margin-top:18px}
.now .chips li{background:var(--bg)}
.sec{padding-block:clamp(16px,3cqi,32px)}
.sec-grid{display:grid;grid-template-columns:minmax(0,200px) minmax(0,1fr);gap:clamp(16px,4cqi,48px);border-top:1px solid var(--line);padding-top:clamp(28px,5cqi,48px);padding-bottom:clamp(12px,2cqi,24px)}
.sec h2{font-size:clamp(24px,3.2cqi,32px)}
.about p{font-size:clamp(18px,2.2cqi,21px);line-height:1.6;margin:0;max-width:62ch}
.jobs{list-style:none;margin:0;padding:0;display:grid;gap:36px}
.job{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 24px}
.job h3{font-size:21px}
.job .when{color:var(--muted);font-size:15px;white-space:nowrap;text-align:right}
.job .org{grid-column:1/-1;margin:0;color:var(--act);font-weight:600}
.job ul{grid-column:1/-1;margin:10px 0 0;padding-left:20px}
.job li{margin:4px 0}
.job li::marker{color:var(--ac)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:16px}
.card{display:flex;flex-direction:column;gap:12px;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--bg);transition:border-color .2s,transform .2s}
.card:hover{border-color:var(--ac);transform:translateY(-2px)}
.card h3{font-size:21px}
.card p{margin:0;color:var(--muted)}
.card .chips{margin-top:auto}
.card .more{font-weight:600;color:var(--act);text-decoration:none}
.skills{display:grid;gap:18px}
.skill{display:grid;grid-template-columns:minmax(0,170px) minmax(0,1fr);gap:16px;align-items:start;padding-bottom:18px;border-bottom:1px solid var(--line)}
.skill:last-child{border:0;padding-bottom:0}
.skill h3{font-size:17px;padding-top:5px}
.edu{list-style:none;margin:0;padding:0;display:grid;gap:22px}
.edu h3{font-size:19px}
.edu p{margin:2px 0 0;color:var(--muted)}
.certs{margin:24px 0 0;padding-left:20px}
.contact{margin-top:clamp(32px,6cqi,72px);background:var(--ac);color:#fff;padding-block:clamp(48px,8cqi,96px) 28px}
.contact h2{font-size:clamp(34px,6cqi,64px);margin-bottom:16px}
.contact .mail{font-size:clamp(20px,3cqi,30px);font-weight:600;text-decoration:underline;text-underline-offset:6px;overflow-wrap:anywhere}
.contact .phone{margin:10px 0 0;font-size:18px}
.contact .row{display:flex;flex-wrap:wrap;gap:10px;margin:28px 0 56px}
.contact .btn{background:#fff;color:#13161c!important;border-color:#fff}
.contact small{display:block;font-size:14px;opacity:.9}
@container site (max-width:760px){.hero,.sec-grid,.skill{grid-template-columns:minmax(0,1fr)}.links{display:none}.nav .wrap{justify-content:space-between}.hero{align-items:start}}
@container site (max-width:480px){.job{grid-template-columns:minmax(0,1fr)}.job .when{text-align:left}}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}`;
}

function siteBody(d) {
  const ini = d.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'P';
  const ext = (u, label, cls) => `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  const chips = list => list.length ? `<ul class="chips">${list.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  const cur = d.experience[0];
  const isNow = cur && /present|current|now|ongoing|today/i.test(cur.dates);
  const top = d.skills.flatMap(g => g.items).slice(0, 6);
  let aside = '';
  if (cur) {
    const start = cur.dates.split(/\s*(?:–|—|-|\bto\b)\s*/i)[0];
    const when = isNow ? (start && !/ongoing|present/i.test(start) ? 'since ' + start : '') : cur.dates;
    aside = `<aside class="now"><p class="k">${isNow ? 'Currently' : 'Most recently'}</p><h3>${esc(cur.role || cur.company)}</h3><p>${esc([cur.role ? cur.company : '', when].filter(Boolean).join(', '))}</p>${chips(top)}</aside>`;
  } else if (top.length) aside = `<aside class="now"><p class="k">Works with</p>${chips(top)}</aside>`;
  const kicker = [d.title, d.location && (d.title ? 'in ' + d.location : d.location)].filter(Boolean).join(' ');
  const tagline = d.tagline || (d.summary.match(/^.*?[.!?](\s|$)/) || [''])[0].trim();
  const acts = [d.email ? `<a class="btn" href="mailto:${esc(d.email)}">Email me</a>` : '', ...d.links.slice(0, 3).map(l => ext(l.url, l.label, 'btn ghost'))].join('');
  const nav = [];
  const sec = (id, title, inner) => { nav.push([id, title]); return `<section class="sec wrap" id="${id}"><div class="sec-grid"><h2>${title}</h2><div>${inner}</div></div></section>`; };
  let html = '';
  if (d.summary) html += sec('about', 'About', `<div class="about"><p>${esc(d.summary)}</p></div>`);
  if (d.experience.length) html += sec('experience', 'Experience', `<ol class="jobs">${d.experience.map(e => `<li class="job"><h3>${esc(e.role || e.company)}</h3><span class="when">${esc(e.dates)}</span>${(e.role && e.company) || e.location ? `<p class="org">${esc([e.role ? e.company : '', e.location].filter(Boolean).join(', '))}</p>` : ''}${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`);
  if (d.projects.length) html += sec('projects', 'Projects', `<div class="cards">${d.projects.map(p => `<article class="card"><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}${chips(p.tech)}${p.url ? ext(p.url, 'View project ↗', 'more') : ''}</article>`).join('')}</div>`);
  if (d.skills.length) html += sec('skills', 'Skills', `<div class="skills">${d.skills.map(g => `<div class="skill"><h3>${esc(g.group)}</h3>${chips(g.items)}</div>`).join('')}</div>`);
  if (d.education.length || d.certifications.length) {
    const t = d.education.length ? 'Education' : 'Certifications';
    html += sec('education', t, `${d.education.length ? `<ul class="edu">${d.education.map(e => `<li><h3>${esc(e.degree || e.school)}</h3><p>${esc([e.degree ? e.school : '', e.dates].filter(Boolean).join(', '))}</p>${e.details ? `<p>${esc(e.details)}</p>` : ''}</li>`).join('')}</ul>` : ''}${d.certifications.length ? `<ul class="certs">${d.certifications.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}`);
  }
  const navHtml = nav.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('');
  const contact = `<footer class="contact" id="contact"><div class="wrap"><h2>Get in touch</h2>${d.email ? `<a class="mail" href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : ''}${d.phone ? `<p class="phone">${esc(d.phone)}</p>` : ''}${d.links.length ? `<div class="row">${d.links.map(l => ext(l.url, l.label, 'btn')).join('')}</div>` : '<div class="row"></div>'}<small>© ${new Date().getFullYear()} ${esc(d.name)}</small></div></footer>`;
  return `<div class="site" id="top"><nav class="nav"><div class="wrap"><a class="logo" href="#top" aria-label="Home">${esc(ini)}</a><div class="links">${navHtml}</div><a class="btn" href="#contact">Contact</a></div></nav><header class="wrap hero${aside ? '' : ' solo'}"><div><p class="kicker">${esc(kicker)}</p><h1>${esc(d.name)}</h1>${tagline ? `<p class="tagline">${esc(tagline)}</p>` : ''}<div class="actions">${acts}</div></div>${aside}</header>${html}${contact}</div>`;
}

function fullDoc(d, key, ac) {
  const t = hasTheme(key) ? THEMES[key] : THEMES.clean;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.name)}${d.title ? ' | ' + esc(d.title) : ''}</title>
<meta name="description" content="${esc(d.tagline || d.summary.slice(0, 155))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_URL[t.font]}" rel="stylesheet">
<style>
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:${t.bg}}
${siteCss(t, ac)}
</style>
</head>
<body>
${siteBody(d)}
</body>
</html>
`;
}


Object.assign(THEMES, {
  sand: { bg: '#f6f0e4', ink: '#2a2118', muted: '#6b5d4d', line: '#e2d7c3', card: '#efe6d5', font: 'Fraunces', dark: false },
  terminal: { bg: '#0a0f0d', ink: '#d9f2e3', muted: '#8fa89a', line: '#1e2b25', card: '#101815', font: 'JetBrains Mono', dark: true }
});
FONT_URL['JetBrains Mono'] = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&amp;family=JetBrains+Mono:wght@500;700&amp;display=swap';
const THEME_LABELS = { clean: 'Clean', midnight: 'Midnight', editorial: 'Editorial', sand: 'Sand', terminal: 'Terminal' };
const ACCENTS = [['#2f5bea', 'Cobalt'], ['#d6127e', 'Magenta'], ['#0f8a5f', 'Emerald'], ['#d9530a', 'Tangerine'], ['#6d3fd8', 'Violet']];
const UI_FONTS = 'https://fonts.googleapis.com/css2?family=Overpass:wght@400;600;700;800&family=Inter:wght@400;600&family=Space+Grotesk:wght@500;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=JetBrains+Mono:wght@500;700&display=swap';

const hasTheme = k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(THEMES, k);
const validAccent = a => typeof a === 'string' && /^#[0-9a-f]{6}$/i.test(a);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fonts have to be loaded by the page itself: @font-face inside a shadow root is ignored.
const loadedFonts = new Set();
function loadFonts(href) {
  if (loadedFonts.has(href)) return;
  loadedFonts.add(href);
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

// Share links carry the whole portfolio in the URL fragment, so nothing is stored on a server.
const MAX_SHARE = 60000;
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
async function pack(obj) {
  let bytes = new TextEncoder().encode(JSON.stringify(obj)), tag = 'j';
  if (typeof CompressionStream === 'function') { bytes = await pipe(bytes, new CompressionStream('deflate-raw')); tag = 'z'; }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return tag + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(str) {
  const bin = atob(str.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
  let bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  if (str[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (str[0] !== 'j') throw new Error('unknown share format');
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Render the portfolio carried in location.hash into `target`. Resolves to false when there is none. */
async function mountShared(target) {
  target = target || document.body;
  const m = location.hash.match(/[#&]p=([A-Za-z0-9_-]+)/);
  if (!m || m[1].length > MAX_SHARE) return false;
  let p;
  try { p = await unpack(m[1]); } catch (e) { return false; }
  if (!p || typeof p !== 'object') return false;
  const data = normalize(p.d);
  const theme = hasTheme(p.t) ? p.t : 'clean';
  const accent = validAccent(p.a) ? p.a : ACCENTS[0][0];
  const t = THEMES[theme];
  loadFonts(FONT_URL[t.font].replace(/&amp;/g, '&'));
  document.title = data.name + (data.title ? ' | ' + data.title : '');
  document.body.style.margin = '0';
  document.body.style.background = t.bg;
  target.innerHTML = `<style>html{scroll-padding-top:72px}${siteCss(t, accent)}</style>${siteBody(data)}`;
  // In-page links would overwrite the fragment that holds the portfolio, so scroll by hand.
  target.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a');
    const h = a && a.getAttribute('href');
    if (!h || h[0] !== '#') return;
    e.preventDefault();
    const el = h === '#top' ? target : document.getElementById(h.slice(1));
    if (el) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });
  return { data, theme, accent };
}

const SAMPLE_TEXT = `MAYA FERNANDES
Frontend Engineer
Bengaluru, India | maya@example.com | linkedin.com/in/maya-example | github.com/maya-example

SUMMARY
Frontend engineer with 5 years of experience building fast, accessible web apps. I care about design systems, performance and clear writing.

EXPERIENCE
Senior Frontend Engineer — Northwind Labs, Bengaluru | Jan 2023 – Present
- Led the rebuild of the checkout flow, cutting load time from 4.2s to 1.6s
- Built a shared component library used by 6 product teams
Frontend Engineer — Paperboat Studio, Pune | Jun 2020 – Dec 2022
- Shipped a booking app used by 40,000 monthly visitors
- Introduced automated accessibility checks to the release pipeline

PROJECTS
Trailmark — An offline-first hiking log with map sync | React, IndexedDB, Mapbox
Tinytype — A tiny library for fluid typography | TypeScript

SKILLS
Languages: TypeScript, JavaScript, HTML, CSS
Frameworks: React, Next.js, Vue
Tools: Vite, Playwright, Figma, Git

EDUCATION
B.Tech in Computer Science — Example Institute of Technology | 2016 – 2020`;
const SAMPLE_NOTE = 'This is a made-up sample. Paste or drop your own resume to replace it.';

const UI_CSS = `
:host{display:block;--land:light-dark(#fbfbf2,#0d1c24);--ink:light-dark(#13242e,#e6f0f3);--muted:light-dark(#4a5b63,#a2b8c0);--brown:light-dark(#a8551b,#e3a476);--mag:#d6127e;--magt:light-dark(#b30e69,#ff7dbd);--panel:light-dark(#ffffff,#0f2731);--line:light-dark(#d7dccb,#2a4653);--chrome:light-dark(#e6ece6,#173a48);--desk:light-dark(#d9e1dc,#0b2029);color:var(--ink);font:16px/1.55 Overpass,system-ui,sans-serif;text-align:left}
:host([scheme=light]){color-scheme:light}
:host([scheme=dark]){color-scheme:dark}
*{box-sizing:border-box;min-width:0}
[hidden]{display:none!important}
.rp{container:rp/inline-size}
.grid{display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:24px;align-items:stretch}
.panel{display:flex;flex-direction:column;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px}
.panel.drag{outline:3px dashed var(--mag);outline-offset:-6px}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
h2{font-weight:800;font-size:20px;line-height:1.2;letter-spacing:-.01em;margin:0}
p{margin:0}
.up{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--ink);font-weight:700;font-size:15px;cursor:pointer;position:relative}
.up:hover{background:var(--ink);color:var(--panel)}
.up:focus-within{outline:3px solid var(--mag);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}
textarea,input[type=text]{width:100%;font:15px/1.5 Overpass,system-ui,sans-serif;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;background:var(--land);color:var(--ink)}
textarea{resize:vertical}
textarea:focus,input:focus,button:focus-visible,summary:focus-visible{outline:3px solid var(--mag);outline-offset:2px}
#resume{flex:1 1 auto;min-height:240px}
.note{font-size:13px;color:var(--brown);margin-top:-6px}
fieldset{border:0;margin:0;padding:0}
legend{font-weight:700;font-size:15px;padding:0;margin-bottom:8px}
.themes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.themes button{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 8px;border:1.5px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink);font:600 14px Overpass,sans-serif;cursor:pointer;text-align:left}
.themes button[aria-pressed=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.sw{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;border:1px solid rgba(128,128,128,.35);font-size:14px;font-weight:700}
.accents{display:flex;align-items:center;gap:2px;margin-top:6px;flex-wrap:wrap}
.accents span{font-size:14px;color:var(--muted);margin-right:6px}
.accents button{width:44px;height:44px;border:0;background:none;padding:0;display:grid;place-items:center;cursor:pointer;border-radius:50%}
.accents i{display:block;width:26px;height:26px;border-radius:50%;background:var(--c)}
.accents button[aria-pressed=true] i{box-shadow:0 0 0 3px var(--panel),0 0 0 5px var(--ink)}
.build{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;border:0;border-radius:14px;background:var(--mag);color:#fff;font:800 18px Overpass,sans-serif;cursor:pointer}
.build:hover{background:#b80f6c}
.build:disabled{opacity:.75;cursor:progress}
.spin{display:none;width:18px;height:18px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sp .8s linear infinite}
.busy .spin{display:block}
@keyframes sp{to{transform:rotate(360deg)}}
.mode{font-size:13px;color:var(--muted);margin-top:-4px}
.status{font-size:14px;min-height:1.5em;font-weight:600}
.status.err{color:var(--magt)}
.status:empty{display:none}
.acts{display:flex;gap:8px;flex-wrap:wrap}
.ghost{flex:1 1 auto;min-height:44px;padding:0 14px;border-radius:12px;border:1.5px solid var(--line);background:transparent;color:var(--ink);font:700 14px Overpass,sans-serif;cursor:pointer;white-space:nowrap}
.ghost:hover{border-color:var(--ink)}
#shareUrl{font-size:13px;padding:10px 12px}
details{border-top:1px solid var(--line);padding-top:4px}
summary{cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center}
#json{font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:280px;margin:4px 0 8px}
.stage{display:flex;flex-direction:column;border-radius:18px;overflow:hidden;background:var(--panel);border:1px solid var(--line);box-shadow:0 22px 44px -28px rgba(19,36,46,.55)}
.bar{display:flex;align-items:center;gap:12px;padding:8px 10px 8px 16px;background:var(--chrome)}
.dots{display:flex;gap:7px;flex:none}
.dots i{width:11px;height:11px;border-radius:50%}
.dots i:first-child{background:#e2675b}
.dots i:nth-child(2){background:#e7b84a}
.dots i:last-child{background:#5fb565}
.addr{flex:1;background:var(--panel);border-radius:999px;padding:8px 14px;font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seg{display:flex;flex:none;background:var(--panel);border-radius:999px;padding:3px}
.seg button{min-height:40px;padding:0 14px;border:0;border-radius:999px;background:none;color:var(--muted);font:700 14px Overpass,sans-serif;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--panel)}
.vp{height:clamp(600px,calc(100svh - 150px),940px);overflow:auto;background:var(--desk);overscroll-behavior:contain}
.device{min-height:100%}
.device.phone{width:390px;max-width:calc(100% - 24px);min-height:calc(100% - 32px);margin:16px auto;border-radius:28px;overflow:hidden;box-shadow:0 0 0 8px #13242e,0 20px 40px -20px rgba(0,0,0,.5)}
@container rp (max-width:900px){.grid{grid-template-columns:minmax(0,1fr)}.vp{height:min(78svh,820px)}}
@container rp (max-width:560px){.bar .dots{display:none}textarea,input[type=text]{font-size:16px}}
@media(prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
`;

const UI_HTML = `<div class="rp"><div class="grid">
  <section class="panel" id="panel" aria-label="Resume input">
    <div class="row">
      <h2>Your resume</h2>
      <label class="up">Upload PDF or text<input class="sr" type="file" id="file" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"></label>
    </div>
    <textarea id="resume" spellcheck="false" aria-label="Resume text"></textarea>
    <p class="note" id="note"></p>
    <fieldset>
      <legend>Look</legend>
      <div class="themes" id="themes">${Object.keys(THEMES).map(k => `<button type="button" data-theme-key="${k}" aria-pressed="false"><span class="sw" style="background:${THEMES[k].bg};color:${THEMES[k].ink};font-family:'${THEMES[k].font}',sans-serif">Aa</span>${THEME_LABELS[k]}</button>`).join('')}</div>
      <div class="accents" id="accents"><span>Accent</span>${ACCENTS.map(([c, n]) => `<button type="button" data-accent="${c}" aria-label="${n}" aria-pressed="false" style="--c:${c}"><i></i></button>`).join('')}</div>
    </fieldset>
    <button type="button" class="build" id="build"><span class="spin" aria-hidden="true"></span><span id="buildLabel">Build portfolio</span></button>
    <p class="mode" id="mode"></p>
    <p class="status" id="status" role="status" aria-live="polite"></p>
    <div class="acts">
      <button type="button" class="ghost" id="stop" hidden>Stop</button>
      <button type="button" class="ghost" id="download">Download .html</button>
      <button type="button" class="ghost" id="share">Copy share link</button>
      <button type="button" class="ghost" id="copy">Copy HTML</button>
      <button type="button" class="ghost" id="reset">Use sample</button>
    </div>
    <input type="text" id="shareUrl" readonly hidden aria-label="Share link">
    <details id="edit">
      <summary>Edit details</summary>
      <textarea id="json" spellcheck="false" aria-label="Portfolio details as JSON"></textarea>
      <button type="button" class="ghost" id="apply">Apply edits</button>
    </details>
  </section>
  <section class="stage" id="stage" aria-label="Portfolio preview">
    <div class="bar">
      <div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="addr" id="addr"></div>
      <div class="seg" id="seg" role="group" aria-label="Preview width">
        <button type="button" data-device="desktop" aria-pressed="true">Desktop</button>
        <button type="button" data-device="phone" aria-pressed="false">Phone</button>
      </div>
    </div>
    <div class="vp" id="vp"><div class="device" id="device"><div id="site"></div></div></div>
  </section>
</div></div>`;

let pdfReady = null;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
function loadPdf() {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  pdfReady = pdfReady || loadScript(base + 'pdf.min.js').then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; });
  pdfReady.catch(() => { pdfReady = null; });
  return pdfReady;
}

class ResumePortfolioElement extends HTMLElement {
  static get observedAttributes() { return ['parse-endpoint']; }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._api = null;
  }

  connectedCallback() {
    if (this._api) return;
    loadFonts(UI_FONTS);
    this._api = this._init();
  }

  attributeChangedCallback() { if (this._api) this._api.updateMode(); }

  getData() { return this._api ? JSON.parse(JSON.stringify(this._api.state.data)) : null; }
  getHTML() { return this._api ? this._api.html() : ''; }
  getShareUrl() { return this._api ? this._api.shareUrl() : Promise.resolve(''); }
  build() { return this._api ? this._api.build() : Promise.resolve(); }
  setResume(text, opts) {
    if (!this._api) return Promise.resolve();
    this._api.setText(String(text || ''));
    return opts && opts.build === false ? Promise.resolve() : this._api.build();
  }

  _init() {
    const host = this, root = this._root;
    root.innerHTML = `<style>${UI_CSS}</style>${UI_HTML}`;
    const $ = id => root.getElementById(id);
    const resume = $('resume'), json = $('json'), statusEl = $('status'), buildBtn = $('build'), vp = $('vp'), device = $('device'), panel = $('panel');
    const shadow = $('site').attachShadow({ mode: 'open' });

    const keyAttr = host.getAttribute('storage-key');
    const KEY = keyAttr === 'none' ? null : (keyAttr || 'resume-portfolio.v1');
    const state = {
      data: normalize(quickParse(SAMPLE_TEXT)),
      theme: hasTheme(host.getAttribute('theme')) ? host.getAttribute('theme') : 'clean',
      accent: validAccent(host.getAttribute('accent')) ? host.getAttribute('accent') : ACCENTS[0][0],
      device: 'desktop'
    };
    let ctl = null;
    resume.value = SAMPLE_TEXT;
    $('note').textContent = SAMPLE_NOTE;

    const endpoint = () => (host.getAttribute('parse-endpoint') || '').trim();
    const slug = () => (state.data.name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'my') + '-portfolio.html';
    const html = () => fullDoc(state.data, state.theme, state.accent);
    const status = (msg, kind) => { statusEl.textContent = msg || ''; statusEl.className = 'status' + (kind ? ' ' + kind : ''); };
    const save = () => { if (KEY) try { localStorage.setItem(KEY, JSON.stringify({ text: resume.value, theme: state.theme, accent: state.accent, data: state.data })); } catch (e) {} };
    const emit = (name, detail) => host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    const pressed = (box, attr, val) => { for (const b of box.querySelectorAll(`[${attr}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(attr) === val)); };

    function render() {
      const t = THEMES[state.theme];
      shadow.innerHTML = `<style>:host{display:block}${siteCss(t, state.accent)}</style>${siteBody(state.data)}`;
      device.style.background = t.bg;
      device.className = 'device' + (state.device === 'phone' ? ' phone' : '');
      $('addr').textContent = slug();
      pressed($('themes'), 'data-theme-key', state.theme);
      pressed($('accents'), 'data-accent', state.accent);
      pressed($('seg'), 'data-device', state.device);
      if (root.activeElement !== json) json.value = JSON.stringify(state.data, null, 2);
      $('shareUrl').hidden = true;
      save();
    }

    // Links inside the preview scroll the preview pane, not the host page.
    shadow.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      const h = a.getAttribute('href') || '';
      if (h[0] !== '#') return;
      e.preventDefault();
      const el = h === '#top' ? shadow.querySelector('.site') : shadow.getElementById(h.slice(1));
      if (!el) return;
      const top = el.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop - (h === '#top' ? 0 : 66);
      vp.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });

    function setBusy(on) {
      buildBtn.disabled = on;
      buildBtn.classList.toggle('busy', on);
      $('buildLabel').textContent = on ? 'Building…' : 'Build portfolio';
      $('stop').hidden = !on || !ctl;
    }

    function updateMode() {
      $('mode').textContent = endpoint()
        ? 'AI reads the resume and writes every section; the text is sent to this site’s server for that. Uploading a file builds it straight away.'
        : 'Built-in parser: works best with clear section headings, and the resume stays in this browser. Uploading a file builds it straight away.';
    }

    async function build() {
      const text = resume.value.trim();
      if (text.length < 40) { status('Paste a bit more of your resume first.', 'err'); resume.focus(); return; }
      let data = null, note = '', source = 'parser';
      const url = endpoint();
      if (url) {
        ctl = new AbortController();
        setBusy(true);
        status('Reading your resume…');
        try {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctl.signal });
          if (!res.ok) throw Object.assign(new Error('parse failed'), { status: res.status });
          const out = await res.json();
          data = normalize(out && out.data ? out.data : out);
          if (!data.experience.length && !data.summary && !data.skills.length && !data.projects.length) { data = null; note = 'The AI found little to use, so the built-in parser filled it in.'; }
          else { source = 'ai'; note = 'Built by AI from your resume. Check the details, then download or share.'; }
        } catch (e) {
          if (e && e.name === 'AbortError') { ctl = null; setBusy(false); status('Stopped.'); return; }
          const s = e && e.status;
          note = s === 429 ? 'The AI is busy right now, so the built-in parser filled it in. Try Build again in a minute.'
            : s === 413 ? 'This resume is too long for AI parsing, so the built-in parser filled it in.'
            : s === 422 ? 'The AI could not process this text, so the built-in parser filled it in.'
            : 'AI parsing is unavailable right now, so the built-in parser filled it in.';
        }
        ctl = null;
      }
      if (!data) {
        data = normalize(quickParse(text));
        if (!note) note = 'Built with the built-in parser. Check the details, then download or share.';
      }
      state.data = data;
      render();
      setBusy(false);
      status(note, 'ok');
      if (host.clientWidth < 900) $('stage').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      vp.scrollTop = 0;
      emit('portfolio-built', { data: JSON.parse(JSON.stringify(data)), html: html(), source });
    }

    async function readFile(f) {
      if (!f) return;
      const n = f.name.toLowerCase();
      let text = '';
      try {
        if (n.endsWith('.pdf') || f.type === 'application/pdf') {
          status('Reading ' + f.name + '…');
          await loadPdf();
          const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
          const pages = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const tc = await (await pdf.getPage(i)).getTextContent();
            let s = '';
            for (const it of tc.items) { s += it.str || ''; if (it.hasEOL) s += '\n'; }
            pages.push(s);
          }
          text = pages.join('\n');
        } else if (/\.(txt|md|markdown|text)$/.test(n) || (f.type || '').startsWith('text/')) {
          text = await f.text();
        } else if (/\.docx?$/.test(n)) {
          status('Word files can’t be read here. Save it as PDF, or paste the text.', 'err'); return;
        } else {
          status('Use a PDF, TXT or MD file, or paste the text.', 'err'); return;
        }
      } catch (e) {
        status('Could not read that file. Paste the text instead.', 'err'); return;
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text.length < 40) { status('No text found in that file. If it is a scanned PDF, paste the text instead.', 'err'); return; }
      resume.value = text;
      $('note').textContent = 'Loaded ' + f.name + '. Edit the text if anything came through oddly.';
      save();
      build();
    }

    async function shareUrl() {
      const base = host.getAttribute('share-url') || (SCRIPT_URL ? new URL('../view.html', SCRIPT_URL).href : 'view.html');
      return new URL(base, location.href).href.split('#')[0] + '#p=' + await pack({ d: state.data, t: state.theme, a: state.accent });
    }

    $('file').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });
    panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drag'); });
    panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('drag'); });
    panel.addEventListener('drop', e => { e.preventDefault(); panel.classList.remove('drag'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });

    buildBtn.addEventListener('click', build);
    $('stop').addEventListener('click', () => { if (ctl) ctl.abort(); });
    $('themes').addEventListener('click', e => { const b = e.target.closest('[data-theme-key]'); if (b) { state.theme = b.dataset.themeKey; render(); } });
    $('accents').addEventListener('click', e => { const b = e.target.closest('[data-accent]'); if (b) { state.accent = b.dataset.accent; render(); } });
    $('seg').addEventListener('click', e => { const b = e.target.closest('[data-device]'); if (b) { state.device = b.dataset.device; render(); vp.scrollTop = 0; } });
    resume.addEventListener('input', save);

    $('apply').addEventListener('click', () => {
      try { state.data = normalize(JSON.parse(json.value)); json.blur(); render(); status('Applied your edits.', 'ok'); }
      catch (e) { status('That JSON has a mistake: ' + (e.message || 'check commas and quotes') + '.', 'err'); }
    });
    $('reset').addEventListener('click', () => {
      resume.value = SAMPLE_TEXT;
      state.data = normalize(quickParse(SAMPLE_TEXT));
      $('note').textContent = SAMPLE_NOTE;
      json.blur(); render(); status('Sample restored.');
    });
    $('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(html()); status('HTML copied. Paste it into a file named index.html.', 'ok'); }
      catch (e) { status('Copy was blocked here. Use Download instead.', 'err'); }
    });
    $('download').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([html()], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = slug();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Saved ' + slug() + '. Rename it to index.html to host it.', 'ok');
    });
    $('share').addEventListener('click', async () => {
      let url;
      try { url = await shareUrl(); } catch (e) { status('Could not make a share link in this browser.', 'err'); return; }
      const box = $('shareUrl');
      box.value = url; box.hidden = false;
      try { await navigator.clipboard.writeText(url); status('Share link copied. Anyone with the link sees this portfolio.', 'ok'); }
      catch (e) { box.focus(); box.select(); status('Copy the link from the box below.', 'ok'); }
      emit('portfolio-shared', { url });
    });

    if (KEY) try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (typeof saved.text === 'string' && saved.text.trim()) resume.value = saved.text;
        if (hasTheme(saved.theme)) state.theme = saved.theme;
        if (validAccent(saved.accent)) state.accent = saved.accent;
        if (saved.data) state.data = normalize(saved.data);
        if (resume.value !== SAMPLE_TEXT) $('note').textContent = 'Your last resume is back. Press Use sample to start over.';
      }
    } catch (e) {}
    render();
    updateMode();

    return { state, html, build, shareUrl, updateMode, setText: t => { resume.value = t; save(); } };
  }
}

window.ResumePortfolio = {
  parse: text => normalize(quickParse(text)),
  normalize,
  toHTML: (data, theme, accent) => fullDoc(normalize(data), hasTheme(theme) ? theme : 'clean', validAccent(accent) ? accent : ACCENTS[0][0]),
  themes: Object.keys(THEMES),
  mountShared
};
if (!customElements.get('resume-portfolio')) customElements.define('resume-portfolio', ResumePortfolioElement);
})();
