#!/usr/bin/env node
// Fill a LOCAL portal with sample people and requests in every state, through the real API.
// Needs `npm run dev` running with DEV_EMAIL set in .dev.vars (local only; never in production).
//   npm run seed:local                 # http://localhost:8787
//   BASE=http://localhost:8788 npm run seed:local
// The people below are fictional test identities.

const BASE = process.env.BASE || 'http://localhost:8787';
const P = {
  owner: 'alex.owner@overyondr.com', // set OWNER_EMAILS="alex.owner@overyondr.com" in .dev.vars
  lead: 'lee.lead@overyondr.com',
  dana: 'dana.designer@overyondr.com',
  casey: 'casey.copy@overyondr.com',
  morgan: 'morgan.manager@overyondr.com',
  riley: 'riley.director@overyondr.com',
  sam: 'sam.requester@overyondr.com',
  jo: 'jo.sales@overyondr.com',
  kai: 'kai.partnerships@overyondr.com',
};

async function call(who, method, path, body, file) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-dev-email': who, 'x-requested-with': 'mrp', 'content-type': file ? file.type : 'application/json' },
    body: file ? file.data : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} as ${who}: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const png = {
  type: 'image/png',
  data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
};

async function people() {
  for (const e of Object.values(P)) await call(e, 'GET', '/api/me');
  const set = (e, b) => call(P.owner, 'PUT', `/api/admin/people/${encodeURIComponent(e)}`, b);
  await set(P.lead, { role: 'lead', name: 'Lee Lead', title: 'Head of Marketing', department: 'Marketing', is_approver: true });
  await set(P.dana, { role: 'marketing', name: 'Dana Designer', title: 'Senior Designer', department: 'Marketing' });
  await set(P.casey, { role: 'marketing', name: 'Casey Copy', title: 'Content Lead', department: 'Marketing' });
  await set(P.morgan, { name: 'Morgan Manager', title: 'VP Sales', department: 'Sales', is_approver: true });
  await set(P.riley, { name: 'Riley Director', title: 'Director of Partnerships', department: 'Partnerships', is_approver: true });
  await set(P.sam, { name: 'Sam Requester', title: 'Account Executive', department: 'Sales', manager_email: P.morgan });
  await set(P.jo, { name: 'Jo Sales', title: 'Sales Manager', department: 'Sales', manager_email: P.morgan });
  await set(P.kai, { name: 'Kai Partnerships', title: 'Partnerships Manager', department: 'Partnerships', manager_email: P.riley });
  await call(P.owner, 'PUT', '/api/admin/types/presentation', { default_assignee: P.dana });
  await call(P.owner, 'PUT', '/api/admin/types/copywriting', { default_assignee: P.casey });
  await call(P.owner, 'PUT', '/api/admin/types/blog_article', { default_assignee: P.casey });
}

const base = (objective, audience) => ({ objective, audience, region: ['United States'] });
const SAMPLES = [
  {
    by: 'sam',
    type: 'presentation',
    title: 'District superintendent pitch deck',
    due: 18,
    to: 'completed',
    rating: 5,
    brief: {
      ...base(
        'Give the sales team a deck that walks superintendents through the first year of a phone-free school, with results from current districts.',
        ['Schools (K-12)'],
      ),
      purpose: 'sales',
      starting_point: 'refresh',
      existing_deck: 'https://docs.google.com/presentation/d/example',
      file_format: 'Google Slides',
      slide_count: '16-30',
      outline: 'Problem, how the pouch works, rollout timeline, results, pricing, next steps.',
    },
  },
  {
    by: 'jo',
    type: 'trade_show',
    title: 'ASCD Annual booth kit',
    due: 40,
    to: 'in_progress',
    brief: {
      ...base('Book demos with district leaders at the booth and collect qualified leads.', ['Schools (K-12)']),
      event_name: 'ASCD Annual Conference',
      event_dates: { start: day(45), end: day(47) },
      location: 'Convention center',
      booth_size: '10x20',
      kit_items: [
        'Backdrop or booth graphics',
        'Table throw',
        'Handouts or one-pagers',
        'Demo pouches and unlocking base',
        'Lead capture (badge scanner or form)',
      ],
      handout_qty: 500,
      ship_to: {
        name: 'Advance warehouse',
        line1: '100 Example Way',
        city: 'Example City',
        region: 'TX',
        postal: '75001',
        country: 'United States',
      },
      ship_by: day(38),
      budget: 12000,
    },
  },
  {
    by: 'kai',
    type: 'paid_ads',
    title: 'Live music venue awareness campaign',
    due: 25,
    to: 'in_review',
    brief: {
      ...base('Reach venue owners and promoters ahead of festival season and drive demo requests.', ['Music & live events', 'Comedy']),
      channels: ['LinkedIn', 'Meta (Facebook & Instagram)'],
      ad_goal: 'leads',
      flight: { start: day(30), end: day(75) },
      budget: 15000,
      creative_ready: 'new',
      landing_url: 'https://www.overyondr.com/spaces/music',
    },
    links: [{ label: 'Ads in the ad library', url: 'https://ads.overyondrdev.com/' }],
  },
  {
    by: 'sam',
    type: 'case_study',
    title: 'Case study: first-year results at a pilot district',
    due: 30,
    to: 'pending_approval',
    brief: {
      ...base('Turn a pilot district’s first-year results into a story sales can share with similar districts.', [
        'Schools (K-12)',
        'Parents & families',
      ]),
      customer: 'Example Unified School District',
      customer_contact: 'Principal, by email',
      approved_to_share: 'verbal',
      formats: ['Web page', 'Designed PDF', 'Slide for decks'],
    },
  },
  {
    by: 'jo',
    type: 'collateral',
    title: 'Courts one-pager refresh',
    due: 12,
    to: 'needs_info',
    brief: {
      ...base('A one-pager court administrators can share internally to get budget approval.', ['Courts & government']),
      piece: 'one_pager',
      usage: ['Emailed as PDF', 'Printed'],
      print_qty: 200,
      content_ready: 'partial',
    },
  },
  {
    by: 'kai',
    type: 'event_support',
    title: 'Partner summit dinner',
    due: 35,
    to: 'approved',
    brief: {
      ...base('Thank our top partners and preview next year’s product updates.', ['Partners & distributors']),
      event_kind: 'hosted',
      event_name: 'Partner summit dinner',
      event_dates: { start: day(50), end: day(50) },
      location: 'New York',
      guests: 40,
      support_needed: ['Invitations', 'Signage', 'Presentation', 'Swag'],
    },
  },
  {
    by: 'sam',
    type: 'copywriting',
    title: 'Email copy for the back-to-school nurture',
    due: 6,
    to: 'in_progress',
    priority: 'high',
    brief: {
      ...base('Re-engage districts that asked for pricing last spring.', ['Schools (K-12)']),
      copy_for: 'email',
      scope: 'new',
      length: 'A short paragraph',
      tone: ['Warm', 'Confident'],
      cta: 'Book a call',
    },
  },
  {
    by: 'jo',
    type: 'swag',
    title: 'Branded tees for the field team',
    due: 9,
    to: 'rejected',
    rush: 'Needed before the regional kickoff.',
    brief: {
      ...base('Make the field team recognizable at school visits.', ['Yondr team (internal)']),
      swag_items: ['T-shirts'],
      quantities: '60 tees: 15 S, 25 M, 15 L, 5 XL',
      ship_to: { line1: '1 Example St', city: 'Example', country: 'United States' },
      budget: 1500,
    },
  },
  {
    by: 'kai',
    type: 'web_page',
    title: 'Fix the broken form on the universities page',
    due: 4,
    to: 'completed',
    rating: 4,
    brief: {
      ...base('Leads from the universities page are not reaching the CRM.', ['Universities']),
      web_kind: 'fix',
      page_url: 'https://www.overyondr.com/spaces/universities',
      changes: 'The contact form shows an error on submit.',
    },
  },
  {
    by: 'sam',
    type: 'blog_article',
    title: 'What teachers notice in the first month phone-free',
    due: 20,
    to: 'approved',
    brief: {
      ...base('Answer the question parents ask most: does it actually change the classroom?', ['Parents & families', 'Schools (K-12)']),
      publish_where: 'yondr_blog',
      topic: 'What teachers notice in the first month',
      word_count: 'Standard (700-1,200 words)',
    },
  },
  {
    by: 'jo',
    type: 'video',
    title: 'Testimonial video from a high school principal',
    due: -3,
    to: 'in_progress',
    priority: 'urgent',
    brief: {
      ...base('A short testimonial for the website and social, from a principal at a current customer school.', ['Schools (K-12)']),
      video_kind: 'testimonial',
      length: '30-60 seconds',
      shoot_needed: 'no',
      footage_link: 'https://drive.google.com/example',
      where_shown: ['Website', 'Social'],
    },
  },
  {
    by: 'kai',
    type: 'press_release',
    title: 'Announce the new distribution partnership',
    due: 14,
    to: 'draft',
    brief: { ...base('Announce the partnership to trade press.', ['Press & media', 'Partners & distributors']) },
  },
  {
    by: 'sam',
    type: 'brand_assets',
    title: 'Co-branded logo for a district newsletter',
    due: 3,
    to: 'completed',
    rating: 5,
    brief: {
      ...base('The district wants to mention Yondr in its parent newsletter.', ['Parents & families']),
      assets_needed: ['Yondr logo files'],
      who_uses: 'District communications office, parent newsletter',
    },
  },
  {
    by: 'jo',
    type: 'research',
    title: 'State legislation tracker for Q1 planning',
    due: 15,
    to: 'on_hold',
    brief: {
      ...base('Prioritize states for outreach next quarter.', ['Policymakers', 'Yondr team (internal)']),
      question: 'Which states have phone-free school bills moving this session?',
      decision: 'Where we send policy outreach and sales resources.',
    },
  },
];

async function advance(s) {
  const who = P[s.by];
  const { request } = await call(who, 'POST', '/api/requests', { type_id: s.type });
  const ref = request.ref;
  await call(who, 'PATCH', `/api/requests/${ref}`, {
    title: s.title,
    brief: s.brief,
    due_date: day(Math.max(s.due, 2)),
    priority: s.priority || 'normal',
    rush_reason: s.rush || 'Tied to a fixed date.',
  });
  if (s.to === 'draft') return ref;
  if (Math.random() > 0.4) await call(who, 'PUT', `/api/requests/${ref}/files?kind=reference&name=reference.png`, null, png);
  await call(who, 'POST', `/api/requests/${ref}/actions/submit`, {});
  const approver = (await call(who, 'GET', `/api/requests/${ref}`)).request.approver_email || P.lead;
  if (s.to === 'pending_approval') return ref;
  if (s.to === 'rejected')
    return void (await call(approver, 'POST', `/api/requests/${ref}/actions/reject`, {
      note: 'Let’s use the existing stock first. Check with ops on sizes.',
    }));
  await call(approver, 'POST', `/api/requests/${ref}/actions/approve`, { note: 'Approved.' }).catch(() => {});
  if (s.to === 'approved') return ref;
  let d = await call(P.lead, 'GET', `/api/requests/${ref}`);
  const maker = d.request.assignee_email || P.dana;
  if (!d.request.assignee_email) await call(P.lead, 'POST', `/api/requests/${ref}/actions/assign`, { assignee: maker });
  await call(maker, 'POST', `/api/requests/${ref}/actions/start`, {});
  await call(maker, 'POST', `/api/requests/${ref}/comments`, { body: 'Got it — I’ll share a first draft early next week.' });
  if (s.to === 'needs_info')
    return void (await call(maker, 'POST', `/api/requests/${ref}/comments`, {
      kind: 'question',
      body: 'Which court systems is this for, and do you have the latest pricing sheet?',
      blocking: true,
    }));
  if (s.to === 'on_hold')
    return void (await call(P.lead, 'POST', `/api/requests/${ref}/actions/hold`, { note: 'Waiting on the policy team’s list.' }));
  if (s.to === 'in_progress') return ref;
  if (s.links) await call(maker, 'PATCH', `/api/requests/${ref}`, { links: s.links });
  else await call(maker, 'PUT', `/api/requests/${ref}/files?kind=deliverable&name=draft-v1.png`, null, png);
  await call(maker, 'POST', `/api/requests/${ref}/actions/deliver`, { note: 'First draft is attached. Let me know what you think.' });
  if (s.to === 'in_review') return ref;
  await call(who, 'POST', `/api/requests/${ref}/actions/accept`, { rating: s.rating || 5, rating_comment: 'Thank you!' });
  return ref;
}

await people();
for (const s of SAMPLES) {
  const ref = await advance(s);
  console.log(`${s.to.padEnd(17)} ${s.title}${ref ? ` (${ref})` : ''}`);
}
console.log(`\nSeeded ${SAMPLES.length} requests. Try X-Dev-Email (or DEV_EMAIL) as any of:\n  ${Object.values(P).join('\n  ')}`);
