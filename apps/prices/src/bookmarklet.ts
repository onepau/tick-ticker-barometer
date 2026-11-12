// The bookmarklet and the capture page it hands over to.
//
// The bookmarklet runs only when Paul clicks it on a page he has opened himself.
// It reads the reference (from the URL or the page's product data) and the
// displayed price, lets him correct both, then opens this Worker's /capture page
// and passes it the URL, a copy of the page HTML and the two values by
// postMessage. Brand sites' Content-Security-Policy usually blocks a direct
// request to another origin, but not opening a window. The token never lives in
// the bookmarklet: the capture page asks for it once and keeps it in its own
// localStorage. If the hand-over fails (a site that severs window.opener), the
// data is copied to the clipboard for pasting into the capture page.

/** Runs in the brand page. Kept ES5-ish and dependency-free. __ORIGIN__ is replaced. */
const CLIENT = String.raw`
(function () {
  var O = "__ORIGIN__";
  var u = location.href;
  var ref = "", price = "", cur = "", tax = "";
  var m = u.match(/\/m(\d{5,6}[a-z]*)-\d{4}(?:[\/?#.]|$)/i);
  if (m) ref = m[1].toUpperCase();
  if (!ref) { m = u.match(/(pam\d{4,5})/i); if (m) ref = m[1].toUpperCase(); }
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n["@graph"]) walk(n["@graph"]);
    var t = n["@type"];
    if (t === "Product" || (Array.isArray(t) && t.indexOf("Product") >= 0)) {
      if (!ref && (n.mpn || n.sku)) ref = String(n.mpn || n.sku);
      var o = Array.isArray(n.offers) ? n.offers[0] : n.offers;
      if (o && o.price && !price) { price = String(o.price); cur = o.priceCurrency || ""; }
    }
  }
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    try { walk(JSON.parse(s.textContent)); } catch (e) {}
  });
  if (price && cur && /^\d/.test(price)) price = cur + " " + price;
  var priceRe = /^(?:[^\d]{0,12})?(CHF|EUR|GBP|USD|€|£|\$)\s?\d[\d\s  ’'.,]*(?:[.,]–)?$|^\d[\d\s  ’'.,]*\s?(CHF|EUR|€|£)$/;
  var els = document.querySelectorAll("body *");
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.children.length > 3 || e.offsetParent === null) continue;
    var t = (e.textContent || "").replace(/\s+/g, " ").trim();
    if (!price && t.length < 40 && priceRe.test(t)) price = t;
    if (!tax && t.length < 80 && /\b(VAT|TVA|V\.A\.T\.|sales tax|taxes)\b/i.test(t)) tax = t;
    if (price && tax) break;
  }
  ref = prompt("tick-ticker capture: reference code (as in the catalogue)", ref);
  if (ref === null) return;
  price = prompt("Displayed price (as shown, e.g. CHF 10,150 or Price on request)", price);
  if (price === null) return;
  var payload = {
    url: u, html: document.documentElement.outerHTML, ref: ref.trim(), price_text: price.trim(),
    tax_text: tax, title: document.title, captured_at: new Date().toISOString()
  };
  var w = window.open(O + "/capture", "ttcapture");
  var sent = false;
  function onMsg(ev) {
    if (ev.origin !== O || ev.data !== "tt-capture-ready" || sent) return;
    sent = true;
    window.removeEventListener("message", onMsg);
    ev.source.postMessage({ type: "tt-capture", payload: payload }, O);
  }
  window.addEventListener("message", onMsg);
  setTimeout(function () {
    if (sent) return;
    window.removeEventListener("message", onMsg);
    var ta = document.createElement("textarea");
    ta.value = JSON.stringify(payload);
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    alert(ok ? "Could not hand over to the capture page. The data is on the clipboard: paste it into the capture page."
             : "Could not hand over to the capture page" + (w ? "" : " (pop-up blocked?)") + ".");
    if (!w) window.open(O + "/capture", "ttcapture");
  }, 8000);
})();
`;

/** Collapses the client source into a javascript: URL for the bookmarks bar. */
export function bookmarkletHref(origin: string): string {
  const o = origin.replace(/\/+$/, "");
  if (
    !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)
  ) {
    throw new Error(
      `bookmarklet origin must be an https origin, got ${origin}`,
    );
  }
  const code = CLIENT.replace("__ORIGIN__", o)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  return `javascript:${encodeURIComponent(code)}`;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** The capture page: receives the hand-over, shows it, and posts it with the token. */
export function capturePage(origin: string): string {
  const href = bookmarkletHref(origin);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Price capture</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--accent:#0b5;--bad:#c22}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#999;--line:#333}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 16px}
label{display:block;margin:.6rem 0 .2rem;color:var(--muted)}input,select,textarea{width:100%;box-sizing:border-box;padding:.4rem;font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:4px}
textarea{height:5rem}button{margin-top:1rem;padding:.5rem 1rem;font:inherit}.row{display:flex;gap:1rem}.row>div{flex:1}
#out{white-space:pre-wrap;margin-top:1rem}.ok{color:var(--accent)}.bad{color:var(--bad)}a.bm{display:inline-block;padding:.3rem .7rem;border:1px dashed var(--muted);border-radius:4px}
</style></head><body>
<h1>Price capture</h1>
<p>Drag this to the bookmarks bar: <a class="bm" href="${esc(href)}">tick-ticker capture</a>.
Use it only on a Rolex or Panerai product page you have opened yourself. It reads the reference and price, you confirm them, and this page sends them with a copy of the page as evidence.</p>
<form id="f">
<label for="token">Capture token (kept in this browser only)</label><input id="token" type="password" autocomplete="off">
<label for="url">Page URL</label><input id="url" readonly>
<div class="row"><div><label for="ref">Reference</label><input id="ref"></div><div><label for="market">Market</label>
<select id="market"><option value="">from URL</option><option>CH</option><option>FR</option><option>UK</option><option>US</option></select></div></div>
<label for="price">Displayed price</label><input id="price">
<label for="tax">Tax wording on the page</label><input id="tax">
<p id="size"></p>
<label><input id="create" type="checkbox" style="width:auto"> Add this reference (not yet in the list)</label>
<div class="row"><div><label for="brand">Brand slug</label><input id="brand" placeholder="rolex"></div><div><label for="name">Name</label><input id="name" placeholder="Submariner Date"></div></div>
<label for="family">Family (optional)</label><input id="family" placeholder="Submariner">
<label for="paste">Or paste the data the bookmarklet copied</label><textarea id="paste"></textarea>
<button type="submit">Save capture</button>
</form>
<div id="out"></div>
<script>
(function(){
  var payload=null, $=function(id){return document.getElementById(id)};
  try{ $('token').value=localStorage.getItem('tt-capture-token')||'' }catch(e){}
  function fill(p){ payload=p; $('url').value=p.url||''; $('ref').value=p.ref||''; $('price').value=p.price_text||''; $('tax').value=p.tax_text||'';
    $('size').textContent='Page copy: '+Math.round((p.html||'').length/1024)+' KB'; }
  window.addEventListener('message',function(ev){ if(ev.source!==window.opener||!ev.data||ev.data.type!=='tt-capture')return; fill(ev.data.payload); });
  if(window.opener){ try{ window.opener.postMessage('tt-capture-ready','*') }catch(e){} }
  $('paste').addEventListener('input',function(){ try{ fill(JSON.parse($('paste').value)) }catch(e){} });
  $('f').addEventListener('submit',function(ev){ ev.preventDefault();
    if(!payload){ $('out').innerHTML='<span class="bad">No page data yet: use the bookmarklet on a brand page.</span>'; return; }
    var token=$('token').value.trim(); try{ localStorage.setItem('tt-capture-token',token) }catch(e){}
    var body=Object.assign({},payload,{ref:$('ref').value,price_text:$('price').value,tax_text:$('tax').value,market:$('market').value||null,
      create:$('create').checked?1:0,brand:$('brand').value||null,name:$('name').value||null,family:$('family').value||null});
    $('out').textContent='Sending…';
    fetch('/api/capture',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){return [r.status,j]})})
      .then(function(x){ var j=x[1]; $('out').innerHTML=j.ok?'<span class="ok">Saved.</span>':'<span class="bad">Not saved.</span>'; $('out').appendChild(document.createTextNode('\\n'+JSON.stringify(j,null,2))); })
      .catch(function(e){ $('out').textContent='Failed: '+e; });
  });
})();
</script></body></html>`;
}
