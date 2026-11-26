// Home: what needs you, your requests, and a fast way to ask for something new.

import { api } from '../lib/api.js';
import { store, isMarketing } from '../lib/store.js';
import { html, icon, requestRow, empty, setTitle, plural, toast } from '../lib/ui.js';
import { TYPE_BY_ID } from '../shared/catalog.js';

const QUICK = ['presentation', 'collateral', 'paid_ads', 'trade_show'];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default async function home(main, ctx) {
  setTitle('');
  const me = store.me;
  const first = (me.name || '').split(' ')[0];
  main.innerHTML = String(
    html`<div class="page">
      <section class="hero panel-dark rise" aria-labelledby="hero-h">
        <div>
          <p class="eyebrow">Marketing requests</p>
          <h1 id="hero-h">${greeting()}${first ? `, ${first}` : ''}. What do you need from marketing?</h1>
          <p>Brief it once, get it approved, and follow it all the way to delivery. Everyone sees where it stands.</p>
          <form class="hero-search" data-hero-search role="search">
            <label class="visually-hidden" for="need">What do you need?</label>
            <input id="need" name="q" class="input" placeholder="e.g. a sales deck, a trade show booth, LinkedIn ads" autocomplete="off" />
            <button class="btn lime" type="submit">${icon('arrowRight')}<span>Start</span></button>
          </form>
        </div>
        <nav class="quick" aria-label="Popular requests">
          ${QUICK.map((id) => {
            const t = TYPE_BY_ID[id];
            return html`<a href="/new/${id}" data-link><span class="ico">${icon(t.icon)}</span>${t.name}</a>`;
          })}
          <a href="/new" data-link><span class="ico">${icon('sparkle')}</span>Browse everything</a>
          <a href="/requests" data-link><span class="ico">${icon('inbox')}</span>My requests</a>
        </nav>
      </section>
      <div data-body>
        <div class="stat-row">${[0, 1, 2, 3].map(() => html`<div class="card stat skel" style="height:96px"></div>`)}</div>
      </div>
    </div>`,
  );

  main.querySelector('[data-hero-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    ctx.navigate(q ? `/new?q=${encodeURIComponent(q)}` : '/new');
  });

  const d = await api.get('/api/home');
  const names = d.names;
  const body = main.querySelector('[data-body]');
  const openMine = d.mine.filter((r) => !['completed', 'cancelled', 'draft'].includes(r.status));
  const drafts = d.mine.filter((r) => r.status === 'draft');
  const recentDone = d.mine.filter((r) => r.status === 'completed');
  const t = d.team;

  const stats = t
    ? [
        { n: t.unassigned || 0, l: 'Unassigned in queue', href: '/queue', alert: t.unassigned > 0 },
        { n: t.active || 0, l: 'In production', href: '/queue' },
        { n: t.overdue || 0, l: 'Overdue', href: '/requests?scope=all&overdue=1', alert: t.overdue > 0 },
        { n: t.due_this_week || 0, l: 'Due in the next 7 days', href: '/queue' },
      ]
    : [
        { n: d.waiting.length, l: 'Waiting on you', href: '#waiting', alert: d.waiting.length > 0 },
        { n: openMine.length, l: 'Open requests', href: '/requests' },
        { n: openMine.filter((r) => r.status === 'in_review').length, l: 'Ready for your review', href: '/requests?status=in_review' },
        { n: recentDone.length, l: 'Delivered (last 2 weeks)', href: '/requests?status=completed' },
      ];

  const welcome = !me.tour_done_at
    ? html`<section class="card pad welcome rise" aria-labelledby="welcome-h">
        <div class="spread">
          <h2 id="welcome-h">How it works</h2>
          <button type="button" class="icon-btn" data-dismiss-welcome aria-label="Hide how it works">${icon('x')}</button>
        </div>
        <ol class="flow-steps">
          <li><b>Brief it</b>Pick what you need. The form asks only the questions that matter for it.</li>
          <li><b>Approval</b>Your manager approves by email or here. Questions stay in the request.</li>
          <li><b>Production</b>The right marketing person is alerted and gets to work.</li>
          <li><b>Review</b>You see drafts, ask for changes, and accept the final work.</li>
        </ol>
        <p class="small muted">
          Everyone involved sees the same status, so nobody has to chase. <a href="/help" data-link>More in Help</a>.
        </p>
      </section>`
    : '';
  const nudge =
    !me.manager_email && !isMarketing()
      ? html`<div class="callout rise">
          ${icon('route')}
          <div>
            <strong>Set your manager</strong>
            <p class="small">Your requests will route to them for approval automatically.</p>
          </div>
          <a class="btn sm" href="/settings" data-link>Set manager</a>
        </div>`
      : '';

  body.innerHTML = String(
    html` ${nudge}
      <div class="stat-row">
        ${stats.map((s, i) => html`<a class="card stat rise ${s.alert ? 'alert' : ''}" style="--i:${i}" href="${s.href}" ${s.href.startsWith('#') ? '' : html`data-link`}><span class="n">${s.n}</span><span class="l">${s.l}</span></a>`)}
      </div>
      ${welcome}
      <div class="home-grid">
        <div class="stack" style="gap:20px">
          <section class="card" id="waiting" aria-labelledby="w-h">
            <div class="card-head">
              <h2 id="w-h">Waiting on you</h2>
              ${d.waiting.length ? html`<span class="badge plain t-wait">${d.waiting.length}</span>` : ''}
            </div>
            ${
              d.waiting.length
                ? html`<div class="req-list">
                    ${d.waiting.map((r, i) => requestRow(r, { me, names, showRequester: r.requester_email !== me.email, i }))}
                  </div>`
                : empty('Nothing needs you right now', 'Approvals, questions and work to review will show up here.', { art: 'checkCircle' })
            }
          </section>
          <section class="card" aria-labelledby="m-h">
            <div class="card-head">
              <h2 id="m-h">Your requests</h2>
              <a class="small" href="/requests" data-link>See all</a>
            </div>
            ${
              d.mine.length
                ? html`<div class="req-list">
                    ${[...openMine, ...drafts, ...recentDone].slice(0, 12).map((r, i) => requestRow(r, { me, names, i }))}
                  </div>`
                : empty('No requests yet', 'When you need something from marketing, start here.', {
                    art: 'sparkle',
                    action: html`<a class="btn primary" href="/new" data-link>${icon('plus')}New request</a>`,
                  })
            }
          </section>
        </div>
        <div class="stack" style="gap:20px">
          ${
            d.watching.length
              ? html`<section class="card" aria-labelledby="f-h">
                  <div class="card-head"><h2 id="f-h">Following</h2></div>
                  <div class="req-list">${d.watching.slice(0, 8).map((r, i) => requestRow(r, { me, names, showRequester: true, i }))}</div>
                </section>`
              : ''
          }
          <section class="card pad tips" aria-labelledby="t-h">
            <h2 id="t-h" class="h3">Get it faster</h2>
            <ul class="ticks">
              <li>
                ${icon('check', 18)}<span
                  ><strong>Ask early.</strong> Each request type shows its usual turnaround; earlier dates are marked rush.</span
                >
              </li>
              <li>
                ${icon('check', 18)}<span
                  ><strong>Attach examples.</strong> Drafts, links and “like this” references save a round of questions.</span
                >
              </li>
              <li>
                ${icon('check', 18)}<span
                  ><strong>Watch the brief strength meter.</strong> A strong brief goes straight into production.</span
                >
              </li>
              <li>
                ${icon('check', 18)}<span><strong>Answer questions here,</strong> not in email, so everyone sees the same thing.</span>
              </li>
            </ul>
            ${drafts.length ? html`<p class="small" style="margin-top:12px">You have ${plural(drafts.length, 'draft')} in progress. <a href="/requests?status=draft" data-link>Pick up where you left off</a>.</p>` : ''}
          </section>
        </div>
      </div>`,
  );

  body.querySelector('[data-dismiss-welcome]')?.addEventListener('click', async (e) => {
    e.currentTarget.closest('.welcome').remove();
    try {
      await api.patch('/api/me', { tour_done: true });
      store.me.tour_done_at = new Date().toISOString();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}
