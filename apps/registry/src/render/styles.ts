/** Stylesheet, inlined into every page. Tokens and type are those of the GPHG Index. */
export const CSS = `
:root{--paper:#FCFBF8;--paper-hi:#F3F0E7;--paper-line:#E7E1D3;--paper-line-strong:#D8CFB8;--ink:#211C15;--ink-soft:#6B6252;--ink-faint:#948A76;--accent:#1B4F8C;--accent-fill:#3B7DC4;--amber:#B4650C;--ruby:#9E3B3F;--forest:#3F6B45;--steel:#48627A;--serif:"Fraunces",Georgia,serif;--serif-brand:"Domine",Georgia,serif;--sans:"IBM Plex Sans",system-ui,sans-serif;--label:"Archivo",Arial,sans-serif;--maxw:1120px}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 20px}
a{color:inherit;text-decoration:none}
main a{color:var(--accent)}main a:hover{text-decoration:underline}
h1,h2,h3{margin:0;font-family:var(--serif);font-weight:500;text-wrap:balance;letter-spacing:-.01em}
.muted{color:var(--ink-soft)}
.mono{font-family:var(--label);font-variant-numeric:tabular-nums}
.eyebrow{font-family:var(--label);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--paper-hi);padding:8px 12px;z-index:10}
:focus-visible{outline:2px solid var(--accent-fill);outline-offset:3px}
.mast{border-bottom:1px solid var(--paper-line);background:var(--paper)}
.mast-in{display:flex;align-items:center;justify-content:space-between;gap:12px 24px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brandmark{display:flex;align-items:center;gap:10px}.brandmark .logo{width:24px;height:24px}.brandmark b{font-family:var(--serif);font-weight:600;font-size:18px}
.navrow{display:flex;gap:20px;flex-wrap:wrap;font-family:var(--label);font-size:13px}
.navrow a{color:var(--ink-soft)}.navrow a[aria-current]{color:var(--ink);font-weight:600}
main.wrap{padding-top:8px;padding-bottom:48px}
.crumbs{font-family:var(--label);font-size:11px;letter-spacing:.05em;color:var(--ink-soft);padding:22px 0 6px;display:flex;gap:8px;flex-wrap:wrap}
main .crumbs a{color:var(--ink-soft)}.crumbs span[aria-current]{color:var(--ink)}
.page-head{padding:14px 0 22px}
.page-head h1{font-size:clamp(30px,4.4vw,52px);line-height:1.05;margin:12px 0 0}
.lead{font-size:17px;color:var(--ink-soft);max-width:62ch;margin:16px 0 0}
.block{padding:32px 0;border-top:1px solid var(--paper-line)}
.block h2{font-size:clamp(20px,2.6vw,28px);margin-bottom:16px}
.chip{font-family:var(--label);font-size:11px;letter-spacing:.1em;text-transform:uppercase;display:inline-flex;align-items:center;gap:7px}
.chip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ink-faint)}
.chip.active{color:var(--forest)}.chip.active::before{background:var(--forest)}
.chip.dormant{color:var(--amber)}.chip.dormant::before{background:var(--amber)}
.chip.dead{color:var(--ruby)}.chip.dead::before{background:var(--ruby)}
.chip.revived{color:var(--accent)}.chip.revived::before{background:var(--accent-fill)}
.layout{display:grid;gap:28px;grid-template-columns:1fr}
@media(min-width:820px){.layout{grid-template-columns:minmax(0,1fr) 320px;align-items:start}}
.facts{border:1px solid var(--paper-line);background:#fff;padding:6px 20px}
.facts h2{font-family:var(--label);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);font-weight:500;padding:14px 0 4px}
.facts dl{margin:0}
.facts .row{padding:11px 0;border-top:1px solid var(--paper-line)}
.facts .row:first-of-type{border-top:0}
.facts dt{font-family:var(--label);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.facts dd{margin:2px 0 0;font-size:15.5px;overflow-wrap:anywhere}
.facts ul{list-style:none;margin:2px 0 0;padding:0}
.facts li{font-size:15px}
.facts .yrs{color:var(--ink-faint);font-size:13px}
.note{border:1px dashed var(--paper-line-strong);background:var(--paper-hi);padding:14px 18px;color:var(--ink-soft);font-size:15px;max-width:62ch}
.linkcards{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:620px){.linkcards{grid-template-columns:1fr 1fr}}
.linkcard{display:block;border:1px solid var(--paper-line-strong);background:#fff;padding:16px 18px}
.linkcard:hover{border-color:var(--accent);text-decoration:none!important}
.linkcard .k{font-family:var(--label);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.linkcard .h{font-family:var(--serif);font-size:19px;line-height:1.25;margin-top:4px;color:var(--ink)}
.linkcard .s{font-size:14px;color:var(--ink-soft);margin-top:2px}
.filters{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:6px 0 0;padding:14px 0 4px}
.filters label{display:flex;flex-direction:column;gap:4px;font-family:var(--label);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft)}
.filters select{font-family:var(--sans);font-size:14px;padding:7px 10px;border:1px solid var(--paper-line-strong);background:var(--paper-hi);color:var(--ink);min-width:170px;border-radius:2px}
.filters button{font-family:var(--label);font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:9px 16px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:2px;cursor:pointer}
.filters .clear{font-size:13px;padding-bottom:8px}
.az{display:flex;flex-wrap:wrap;gap:4px 10px;font-family:var(--label);font-size:13px;margin:18px 0 0}
.az a{padding:1px 4px}.az .off{color:var(--paper-line-strong)}
.letter{padding:22px 0 6px;border-top:1px solid var(--paper-line);margin-top:18px}
.letter h2{font-size:26px;margin-bottom:10px}
.brandlist{list-style:none;margin:0;padding:0;columns:1;column-gap:32px}
@media(min-width:620px){.brandlist{columns:2}}
@media(min-width:960px){.brandlist{columns:3}}
.brandlist li{break-inside:avoid;padding:5px 0;border-bottom:1px solid var(--paper-line);display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.brandlist .nm{font-family:var(--serif-brand);font-weight:600;font-size:17px}
.brandlist .meta{font-size:12.5px;color:var(--ink-faint)}
.count{font-family:var(--label);font-size:12px;color:var(--ink-soft);margin:14px 0 0}
.site-footer{border-top:1px solid var(--paper-line);background:var(--paper-hi);color:var(--ink-soft);font-size:13px}
.foot-in{display:flex;flex-direction:column;gap:6px;padding-top:22px;padding-bottom:26px}
.site-footer a{color:var(--accent)}
`;
