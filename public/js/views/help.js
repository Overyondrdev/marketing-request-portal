// Help: how requests move, what each role does, how timing works and FAQs.

import { store, loadSettings } from '../lib/store.js';
import { html, icon, setTitle } from '../lib/ui.js';
import { CATEGORIES, TYPES } from '../shared/catalog.js';
import { STATUSES } from '../shared/workflow.js';

const FAQ = [
  [
    'Who approves my request?',
    'Your manager, by default (set them in Settings). You can choose another approver on any request: type their name and pick them from the Yondr directory. Some quick requests, like brand files and internal communications, don’t need approval.',
  ],
  [
    'How do I know when my request will be ready?',
    'When someone in marketing starts your request, they estimate the date it will be ready. You see that date on the request and get a notification, and again if the estimate changes. If it is later than the date you asked for, it is flagged so you can talk it through in the request.',
  ],
  [
    'Marketing asked me a question. What happens to my request?',
    'If the question pauses work, the request shows “Question for requester” and waits on you. Answer it in the request (reply to the question) and work carries on automatically.',
  ],
  [
    'How do I see where my request is?',
    'Open it. The progress bar shows each stage with dates, and “Waiting on” shows exactly who has the next move. You also get a notification at every step.',
  ],
  [
    'Where are ads reviewed?',
    'Ad creative is reviewed in the ad library (ads.overyondrdev.com). The ad request here links to it; once you’re happy, accept the request here to close it.',
  ],
  [
    'Can I change my request after submitting it?',
    'Yes, until marketing starts work: edit the brief from the request page. After that, add a comment so the person working on it sees the change.',
  ],
  [
    'Can other people follow a request?',
    'Yes. Under “Following” on the request, type their name and pick them from the Yondr directory. They see it and get updates.',
  ],
  ['Who can see my request?', 'You, your approver, anyone following it, and the marketing team. Nobody else at Yondr sees it.'],
  ['How do I cancel?', 'Open the request and choose Cancel request, with a short reason. You can duplicate it later if it comes back.'],
];

export default async function help(main) {
  setTitle('Help');
  const settings = await loadSettings().catch(() => ({}));
  const byCat = CATEGORIES.map((c) => ({ c, types: TYPES.filter((t) => t.category === c.id && settings[t.id]?.enabled !== false) })).filter(
    (g) => g.types.length,
  );

  main.innerHTML = String(
    html`<div class="page narrow prose">
      <p class="eyebrow">Help</p>
      <h1>How marketing requests work</h1>
      <p class="lede muted" style="margin-top:10px">
        One place to ask marketing for anything, from a line of copy to a full trade show kit, and to see exactly where it is.
      </p>
      <ol class="flow-steps">
        <li><b>Brief</b>Choose what you need and answer the questions for it. Attach examples.</li>
        <li><b>Approve</b>Your manager approves, declines or asks a question.</li>
        <li><b>Queue</b>Marketing routes it to the right person, who is alerted straight away.</li>
        <li><b>Produce</b>Questions and drafts happen in the request, visible to everyone involved.</li>
        <li><b>Review</b>You accept the work or ask for changes, then rate it.</li>
      </ol>

      <h2>Statuses</h2>
      <dl class="kv">
        ${Object.entries(STATUSES).map(
          ([k, s]) =>
            html`<dt><span class="badge t-${s.tone}">${s.label}</span></dt>
              <dd>${DESCRIBE[k]}</dd>`,
        )}
      </dl>

      <h2>Who does what</h2>
      <ul>
        <li><strong>Everyone at Yondr</strong> can request work, follow requests, answer questions and review deliverables.</li>
        <li><strong>Approvers</strong> (usually managers) approve or decline requests from their team, or ask questions first.</li>
        <li><strong>Marketing team</strong> members pick up work, ask questions, keep internal notes and deliver.</li>
        <li><strong>Marketing leads</strong> also assign work, set who receives each type of request, and see every report.</li>
        <li><strong>Admins</strong> manage people and roles.</li>
      </ul>
      ${store.me && store.me.role === 'requester' ? '' : html`<p class="small muted">You can manage people and routing under <a href="/admin" data-link>People &amp; routing</a> if you’re a lead or admin.</p>`}

      <h2>How timing works</h2>
      <p>
        Tell us the date you need the work by, and set a priority. There is no fixed turnaround per request type: the person who picks up
        your request estimates when it will be ready, based on the brief and what else the team is working on. You see the estimate on the
        request, with a flag if it’s later than your date, and you’re notified whenever it changes.
      </p>
      <h2>What you can ask for</h2>
      ${byCat.map(
        (g) =>
          html`<h3>${g.c.name}</h3>
            <dl class="kv">
              ${g.types.map(
                (t) =>
                  html`<dt>${t.name}</dt>
                    <dd>${t.summary}${(settings[t.id]?.requiresApproval ?? t.requiresApproval) ? '' : ' No approval needed.'}</dd>`,
              )}
            </dl>`,
      )}

      <h2>Questions</h2>
      ${FAQ.map(
        ([q, a]) =>
          html`<details class="faq">
            <summary>${q}</summary>
            <p>${a}</p>
          </details>`,
      )}

      <h2>Still stuck?</h2>
      <p>
        Start a request with <a href="/new/other" data-link>Something else</a> and describe what you need, or ask in a comment on any
        request. ${icon('message', 16)}
      </p>
    </div>`,
  );
}

const DESCRIBE = {
  draft: 'You’re still writing it. Only you can see it.',
  pending_approval: 'Sent to your approver.',
  needs_info: 'Someone asked you a question and work is paused until you answer.',
  rejected: 'Not approved yet. Revise and resubmit, or cancel it.',
  approved: 'Approved and in the marketing queue, waiting to start.',
  in_progress: 'Marketing is working on it.',
  in_review: 'Work is ready. Accept it or ask for changes.',
  on_hold: 'Paused by marketing, with a reason.',
  completed: 'Delivered and closed.',
  cancelled: 'Cancelled, with a reason.',
};
