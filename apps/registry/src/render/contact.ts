/** The contact form pages: GET /contact (form, with optional errors) and the thank-you page. */
import { MAX_MESSAGE, type ContactValues } from "../contact.ts";
import { crumbs, escapeHtml, layout } from "./html.ts";
import type { Page } from "./pages.ts";

export function contactPage(
  origin: string,
  token: string,
  values: ContactValues,
  errors: string[] = [],
): Page {
  const errorBlock = errors.length
    ? `<div class="note" role="alert"><strong>Your message has not been sent.</strong><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></div>`
    : "";
  const body = `${crumbs([{ name: "Contact" }])}
  <header class="page-head"><span class="eyebrow">Contact</span>
    <h1 class="display">Contact and corrections</h1>
    <p class="lead">Spotted a wrong price, a missing brand or a mistake in the registry? Tell us which page it concerns and what you saw.</p>
  </header>
  ${errorBlock}
  <form class="contact" method="post" action="/contact">
    <label>Name <span class="muted">(optional)</span><input name="name" maxlength="200" autocomplete="name" value="${escapeHtml(values.name)}"></label>
    <label>Email <span class="muted">(optional, but we can only reply if you give one)</span><input name="email" type="email" maxlength="254" autocomplete="email" value="${escapeHtml(values.email)}"></label>
    <label>Page this is about <span class="muted">(optional)</span><input name="page" maxlength="200" placeholder="/prices/omega/…" value="${escapeHtml(values.page)}"></label>
    <label>Message <span class="muted">(required, up to ${MAX_MESSAGE.toLocaleString("en-GB")} characters)</span><textarea name="message" rows="9" maxlength="${MAX_MESSAGE + 500}" required>${escapeHtml(values.message)}</textarea></label>
    <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <input type="hidden" name="t" value="${escapeHtml(token)}">
    <button type="submit">Send message</button>
  </form>
  <p class="small">Privacy: your message is stored only so that we can answer it, and deleted once it has been dealt with. We do not track you, set cookies or use an outside service for this form; your IP address is not kept, only a one-way hash used to limit each sender to five messages an hour.</p>`;
  return {
    html: layout(
      origin,
      { title: "Contact and corrections", description: "Report a correction or get in touch about the tick-ticker brand registry and list-price tracker.", canonical: "/contact", noindex: true },
      body,
    ),
  };
}

export function contactThanksPage(origin: string): Page {
  return {
    html: layout(
      origin,
      { title: "Message received", description: "Thank you for your message.", canonical: "/contact", noindex: true },
      `${crumbs([{ name: "Contact", href: "/contact" }, { name: "Thank you" }])}
  <header class="page-head"><span class="eyebrow">Contact</span>
    <h1 class="display">Thank you</h1>
    <p class="lead">Your message has been received. If you left an email address we will reply there once we have looked into it.</p>
    <p><a href="/brands">Back to the brand registry →</a></p>
  </header>`,
    ),
  };
}

export function contactMessagePage(origin: string, heading: string, text: string): Page {
  return {
    html: layout(
      origin,
      { title: heading, description: text, canonical: "/contact", noindex: true },
      `${crumbs([{ name: "Contact", href: "/contact" }, { name: heading }])}
  <header class="page-head"><span class="eyebrow">Contact</span>
    <h1 class="display">${escapeHtml(heading)}</h1>
    <p class="lead">${escapeHtml(text)}</p>
    <p><a href="/contact">Back to the form →</a></p>
  </header>`,
    ),
  };
}
