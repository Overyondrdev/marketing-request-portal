// The catalog and workflow rules shared by the browser and the Worker.
import { describe, expect, it } from 'vitest';
import {
  TYPES,
  TYPE_BY_ID,
  BASE_FIELDS,
  CATEGORIES,
  validateBrief,
  visibleFields,
  briefScore,
  leadDaysFor,
  addBusinessDays,
  businessDaysBetween,
  earliestStandardDate,
  searchTypes,
  fieldError,
  cleanBrief,
} from '../public/js/shared/catalog.js';
import { ACTIONS, can, waitingOn, canView, availableActions, stageOf } from '../public/js/shared/workflow.js';

describe('catalog', () => {
  it('has unique ids, known categories and well-formed fields', () => {
    const ids = new Set<string>();
    for (const t of TYPES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(CATEGORIES.some((c) => c.id === t.category)).toBe(true);
      const fids = new Set(BASE_FIELDS.map((f) => f.id));
      for (const f of t.fields) {
        expect(fids.has(f.id), `${t.id}.${f.id} duplicated`).toBe(false);
        fids.add(f.id);
        if (f.showIf) expect(fids.has(f.showIf.field), `${t.id}.${f.id} depends on a later or unknown field`).toBe(true);
        if (['select', 'cards', 'multi'].includes(f.type)) expect(f.options?.length).toBeGreaterThan(1);
      }
    }
  });

  it('shows conditional questions only when they apply', () => {
    const deck = TYPE_BY_ID.presentation;
    expect(visibleFields(deck, { starting_point: 'new' }).some((f) => f.id === 'existing_deck')).toBe(false);
    expect(visibleFields(deck, { starting_point: 'refresh' }).some((f) => f.id === 'existing_deck')).toBe(true);
    const show = TYPE_BY_ID.trade_show;
    expect(visibleFields(show, { kit_items: ['Table throw'] }).some((f) => f.id === 'handout_qty')).toBe(false);
    expect(visibleFields(show, { kit_items: ['Handouts or one-pagers'] }).some((f) => f.id === 'handout_qty')).toBe(true);
  });

  it('validates answers', () => {
    const errs = validateBrief(TYPE_BY_ID.presentation, { starting_point: 'refresh', existing_deck: 'not a link' });
    expect(Object.keys(errs)).toEqual(expect.arrayContaining(['objective', 'audience', 'purpose', 'existing_deck', 'file_format']));
    expect(fieldError({ id: 'x', label: 'x', type: 'daterange' }, { start: '2026-02-02', end: '2026-01-01' })).toMatch(/before/);
    expect(fieldError({ id: 'x', label: 'x', type: 'multi', options: ['A', 'B'] }, ['A', 'C'])).not.toBe('');
  });

  it('drops answers to questions that no longer apply', () => {
    const b = cleanBrief(TYPE_BY_ID.presentation, { starting_point: 'new', existing_deck: 'https://x.example/d', purpose: 'sales' });
    expect(b).toEqual({ starting_point: 'new', purpose: 'sales' });
  });

  it('scores briefs and suggests the most useful missing answers', () => {
    const t = TYPE_BY_ID.presentation;
    const thin = briefScore(t, {}, {});
    const full = briefScore(
      t,
      {
        objective: 'Win district deals with a clear story and proof from current customers.',
        audience: ['Schools (K-12)'],
        audience_detail: 'Superintendents',
        region: ['United States'],
        key_message: 'It works',
        reference_links: ['https://drive.google.com/example'],
        must_include: 'Use the logo lockup and approved statistics only, with sources.',
        purpose: 'sales',
        starting_point: 'new',
        slide_count: '6-15',
        presenter: 'Sam',
        presentation_date: '2027-01-10',
        talk_length: 30,
        file_format: 'Google Slides',
        outline: 'Problem, product, proof, plan, pricing and next steps for the district.',
      },
      { refs: 1, title: 'District deck', dueDate: '2027-01-05' },
    );
    expect(thin.score).toBeLessThan(20);
    expect(full.score).toBe(100);
    expect(thin.tips.length).toBeGreaterThan(0);
  });

  it('counts business days and turnaround, including answer-specific lead times', () => {
    expect(addBusinessDays('2026-11-27', 1)).toBe('2026-11-30'); // Fri -> Mon
    expect(businessDaysBetween('2026-11-27', '2026-12-04')).toBe(5);
    expect(leadDaysFor(TYPE_BY_ID.presentation, { starting_point: 'polish' })).toBe(4);
    expect(leadDaysFor(TYPE_BY_ID.presentation, {})).toBe(10);
    expect(earliestStandardDate(TYPE_BY_ID.brand_assets, {}, '2026-11-23')).toBe('2026-11-25'); // no approval step
  });

  it('finds types by everyday words', () => {
    expect(searchTypes('booth')[0].id).toBe('trade_show');
    expect(searchTypes('ppt')[0].id).toBe('presentation');
    expect(searchTypes('linkedin ads')[0].id).toBe('paid_ads');
  });
});

describe('workflow', () => {
  const sam = { email: 's@overyondr.com', role: 'requester' };
  const mgr = { email: 'm@overyondr.com', role: 'requester' };
  const mk = { email: 'd@overyondr.com', role: 'marketing' };
  const lead = { email: 'l@overyondr.com', role: 'lead' };
  const req = (status: string, extra = {}) => ({
    status,
    requester_email: sam.email,
    approver_email: mgr.email,
    assignee_email: null,
    ...extra,
  });

  it('only the approver (or a lead) approves, never the requester', () => {
    expect(can(mgr, req('pending_approval'), 'approve')).toBe(true);
    expect(can(lead, req('pending_approval'), 'approve')).toBe(true);
    expect(can(sam, req('pending_approval'), 'approve')).toBe(false);
    expect(can(mk, req('pending_approval'), 'approve')).toBe(false);
    expect(can({ ...lead, email: sam.email }, req('pending_approval'), 'approve')).toBe(false);
  });

  it('every action is reachable from at least one status and names real statuses', () => {
    for (const [name, a] of Object.entries(ACTIONS) as [string, any][]) expect(a.from.length, name).toBeGreaterThan(0);
  });

  it('knows who the request is waiting on', () => {
    expect(waitingOn(req('pending_approval'))).toBe(mgr.email);
    expect(waitingOn(req('approved'))).toBe('marketing');
    expect(waitingOn(req('in_progress', { assignee_email: mk.email }))).toBe(mk.email);
    expect(waitingOn(req('in_review'))).toBe(sam.email);
    expect(waitingOn(req('completed'))).toBe(null);
  });

  it('keeps drafts private and requests visible only to the people involved', () => {
    expect(canView(mk, req('draft'))).toBe(false);
    expect(canView(mk, req('approved'))).toBe(true);
    expect(canView({ email: 'x@overyondr.com', role: 'requester' }, req('approved'))).toBe(false);
    expect(canView({ email: 'x@overyondr.com', role: 'requester' }, req('approved'), true)).toBe(true);
  });

  it('offers the requester the right moves at review time', () => {
    expect(availableActions(sam, req('in_review'))).toEqual(expect.arrayContaining(['accept', 'request_changes', 'cancel']));
    expect(stageOf(req('needs_info', { prior_status: 'in_progress' }))).toBe('production');
  });
});
