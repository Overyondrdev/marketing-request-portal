// The request catalog: every kind of work marketing takes on, and the questions that make a complete brief for it.
// Shared by the browser (renders the form) and the Worker (validates and scores briefs), so it must stay plain,
// dependency-free JavaScript. Admins can switch types off and change approval and default assignee from
// the portal (type_settings); everything else is edited here.
//
// Field types: text, textarea, select, cards (big single-choice tiles), multi (chips), date, daterange, number,
// money, url, links (several URLs), toggle, address.
// showIf: { field, equals | in | truthy } shows a question only when it applies.
// weight: how much an optional answer adds to the brief score (required answers weigh 3).
// There is no fixed turnaround per type: whoever picks the work up estimates its delivery date (workflow.js).

/** @typedef {{ value: string, label: string, hint?: string }} Option */
/** @typedef {{ field: string, equals?: any, in?: any[], truthy?: boolean }} Cond */
/**
 * @typedef {{ id: string, label: string, type: string, required?: boolean, help?: string, placeholder?: string,
 *   options?: (string|Option)[], showIf?: Cond, min?: number, max?: number, maxLength?: number, weight?: number,
 *   width?: 'half'|'full', example?: string }} Field
 */
/**
 * @typedef {{ id: string, category: string, name: string, summary: string, icon: string, keywords: string[],
 *   requiresApproval: boolean, deliverables: string, fields: Field[], adLibrary?: boolean }} RequestType
 */

export const CATEGORIES = [
  { id: 'content', name: 'Copy & content', blurb: 'Words: copy, articles, case studies, press, internal comms', icon: 'pen' },
  { id: 'sales', name: 'Sales enablement', blurb: 'Decks, one-pagers, proposals and leave-behinds', icon: 'briefcase' },
  { id: 'design', name: 'Design & brand', blurb: 'Graphics, print, signage and brand files', icon: 'palette' },
  { id: 'digital', name: 'Digital & ads', blurb: 'Paid ads, email, web pages and social', icon: 'megaphone' },
  { id: 'events', name: 'Events & field', blurb: 'Trade shows, events, swag and webinars', icon: 'tent' },
  { id: 'video', name: 'Video & photo', blurb: 'Video, animation and photography', icon: 'camera' },
  { id: 'insights', name: 'Research & PR', blurb: 'Market research, media and awards', icon: 'compass' },
  { id: 'other', name: 'Something else', blurb: 'Not sure where it fits? Start here', icon: 'sparkle' },
];

// Who Yondr talks to (from overyondr.com's spaces), used by every request.
export const AUDIENCES = [
  'Schools (K-12)',
  'Universities',
  'Parents & families',
  'Music & live events',
  'Comedy',
  'Courts & government',
  'Workplaces',
  'Hospitality',
  'Events & weddings',
  'Camps & youth programs',
  'Productions (film & TV)',
  'Partners & distributors',
  'Press & media',
  'Policymakers',
  'Investors',
  'Yondr team (internal)',
  'Other',
];
export const REGIONS = ['United States', 'United Kingdom & Ireland', 'Europe', 'Rest of world', 'Global'];
export const DEPARTMENTS = [
  'Sales',
  'Partnerships',
  'Customer Success',
  'Operations',
  'Product',
  'Policy & Government Affairs',
  'People',
  'Finance',
  'Executive',
  'Marketing',
  'Other',
];
export const PRIORITIES = [
  { value: 'low', label: 'Low', hint: 'Nice to have, flexible timing' },
  { value: 'normal', label: 'Normal', hint: 'No particular rush' },
  { value: 'high', label: 'High', hint: 'Tied to revenue or a fixed date' },
  { value: 'urgent', label: 'Urgent', hint: 'Blocking a deal, launch or event' },
];

// Questions every request answers (step 2, "The brief"). Type questions follow in step 3.
/** @type {Field[]} */
export const BASE_FIELDS = [
  {
    id: 'objective',
    label: 'What is this for, and what should it achieve?',
    type: 'textarea',
    required: true,
    help: 'The business goal, not the format. What should people think, feel or do after seeing it?',
    placeholder:
      'e.g. Help our sales team win district-wide deals by showing superintendents the results other districts have seen in their first year.',
    maxLength: 2000,
  },
  {
    id: 'audience',
    label: 'Who is it for?',
    type: 'multi',
    required: true,
    options: AUDIENCES,
    help: 'Pick every audience that will see it.',
  },
  {
    id: 'audience_detail',
    label: 'Anything specific about the audience?',
    type: 'text',
    weight: 1,
    placeholder: 'e.g. Superintendents and principals in Texas districts already piloting Yondr',
    maxLength: 300,
  },
  { id: 'region', label: 'Where will it be used?', type: 'multi', options: REGIONS, weight: 1 },
  {
    id: 'key_message',
    label: 'The one thing they must take away',
    type: 'text',
    weight: 2,
    placeholder: 'e.g. Phone-free schools see fewer disciplinary incidents and more engaged students.',
    maxLength: 300,
  },
  {
    id: 'must_include',
    label: 'Must include or avoid',
    type: 'textarea',
    weight: 1,
    help: 'Required logos, legal lines, product names, facts that must be checked, things not to say.',
    maxLength: 2000,
  },
  {
    id: 'reference_links',
    label: 'Links to examples, drafts or shared folders',
    type: 'links',
    weight: 2,
    help: 'Google Drive, Dropbox, Figma, examples you like: anything that shows what you mean.',
  },
];

const yesNo = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const toneOptions = ['Confident', 'Warm', 'Urgent', 'Authoritative', 'Playful', 'Inspiring', 'Straightforward'];
const formats = (...o) => o;

/** @type {RequestType[]} */
export const TYPES = [
  // ------------------------------------------------------------------ Copy & content
  {
    id: 'copywriting',
    category: 'content',
    name: 'Copywriting',
    icon: 'pen',
    requiresApproval: true,
    summary: 'Copy for a page, email, flyer, script or anything else that needs words.',
    keywords: ['copy', 'words', 'text', 'write', 'edit', 'proofread', 'messaging', 'tagline', 'headline'],
    deliverables: 'A Google Doc with the copy, ready for design or publishing.',
    fields: [
      {
        id: 'copy_for',
        label: 'What is the copy for?',
        type: 'cards',
        required: true,
        options: [
          { value: 'web', label: 'Web page', hint: 'Site or landing page' },
          { value: 'email', label: 'Email' },
          { value: 'print', label: 'Print piece', hint: 'Flyer, brochure, poster' },
          { value: 'script', label: 'Script', hint: 'Video, voice-over, talk' },
          { value: 'product', label: 'Product or packaging' },
          { value: 'other', label: 'Something else' },
        ],
      },
      {
        id: 'scope',
        label: 'New copy or editing existing copy?',
        type: 'cards',
        required: true,
        options: [
          { value: 'new', label: 'Write it new' },
          { value: 'edit', label: 'Edit or refresh what we have' },
          { value: 'proof', label: 'Proofread only' },
        ],
      },
      {
        id: 'existing_link',
        label: 'Link to the existing copy',
        type: 'url',
        required: true,
        showIf: { field: 'scope', in: ['edit', 'proof'] },
      },
      {
        id: 'length',
        label: 'Roughly how long?',
        type: 'select',
        weight: 2,
        options: ['A line or two', 'A short paragraph', 'Up to one page', 'A few pages', 'Not sure'],
      },
      { id: 'tone', label: 'Tone', type: 'multi', options: toneOptions, weight: 1 },
      { id: 'cta', label: 'What should readers do next?', type: 'text', weight: 2, placeholder: 'e.g. Book a demo, Download the guide' },
    ],
  },
  {
    id: 'blog_article',
    category: 'content',
    name: 'Blog post or article',
    icon: 'doc',
    requiresApproval: true,
    summary: 'A post for the Yondr blog, a guest article or a thought-leadership piece.',
    keywords: ['blog', 'article', 'post', 'thought leadership', 'op-ed', 'byline', 'guest post', 'seo'],
    deliverables: 'A drafted article with title, meta description and suggested images.',
    fields: [
      {
        id: 'publish_where',
        label: 'Where will it be published?',
        type: 'cards',
        required: true,
        options: [
          { value: 'yondr_blog', label: 'Yondr blog' },
          { value: 'guest', label: 'Another publication' },
          { value: 'linkedin', label: 'LinkedIn article' },
        ],
      },
      { id: 'publication', label: 'Which publication?', type: 'text', required: true, showIf: { field: 'publish_where', equals: 'guest' } },
      { id: 'topic', label: 'Topic or working title', type: 'text', required: true, maxLength: 200 },
      { id: 'byline', label: 'Whose name goes on it?', type: 'text', weight: 2, placeholder: 'e.g. Graham Dugoni, Founder & CEO' },
      {
        id: 'sources',
        label: 'Sources, data or people to interview',
        type: 'textarea',
        weight: 2,
        help: 'Every fact and quote needs a source we can cite.',
      },
      {
        id: 'word_count',
        label: 'Length',
        type: 'select',
        weight: 1,
        options: ['Short (400-700 words)', 'Standard (700-1,200 words)', 'Long-form (1,200+ words)'],
      },
      {
        id: 'seo_keywords',
        label: 'Search terms to target',
        type: 'text',
        weight: 1,
        placeholder: 'e.g. phone-free schools, cell phone ban research',
      },
    ],
  },
  {
    id: 'case_study',
    category: 'content',
    name: 'Case study or customer story',
    icon: 'star',
    requiresApproval: true,
    summary: 'A customer success story with results, quotes and photos.',
    keywords: ['case study', 'customer story', 'testimonial', 'success story', 'results', 'reference'],
    deliverables: 'A written case study (doc and designed PDF), plus pull quotes for social and sales.',
    fields: [
      { id: 'customer', label: 'Customer or partner', type: 'text', required: true, placeholder: 'e.g. Example Unified School District' },
      {
        id: 'customer_contact',
        label: 'Customer contact we can interview',
        type: 'text',
        required: true,
        placeholder: 'Name, role, email',
      },
      {
        id: 'approved_to_share',
        label: 'Has the customer agreed to be featured?',
        type: 'cards',
        required: true,
        options: [
          { value: 'yes', label: 'Yes, in writing' },
          { value: 'verbal', label: 'Verbally' },
          { value: 'no', label: 'Not yet' },
        ],
        help: 'We need written approval before anything is published.',
      },
      {
        id: 'results',
        label: 'Results or numbers to highlight',
        type: 'textarea',
        weight: 3,
        help: 'Where do they come from? Survey, district data, news coverage…',
      },
      {
        id: 'formats',
        label: 'Formats needed',
        type: 'multi',
        required: true,
        options: formats('Web page', 'Designed PDF', 'Slide for decks', 'Social posts', 'Video'),
      },
      {
        id: 'photos_available',
        label: 'Do we have photos or video from them?',
        type: 'select',
        weight: 1,
        options: ['Yes', 'No, we need a shoot', 'Not sure'],
      },
    ],
  },
  {
    id: 'press_release',
    category: 'content',
    name: 'Press release or announcement',
    icon: 'news',
    requiresApproval: true,
    summary: 'News for the media: partnerships, launches, milestones, research.',
    keywords: ['press', 'press release', 'pr', 'announcement', 'news', 'media', 'launch', 'newswire'],
    deliverables: 'A press release, media list recommendation and social copy.',
    fields: [
      { id: 'news', label: 'What is the news?', type: 'textarea', required: true, help: 'One or two sentences a reporter would repeat.' },
      { id: 'embargo', label: 'Announcement date and time', type: 'date', required: true },
      { id: 'partners', label: 'Partners involved (and do they need to approve it?)', type: 'textarea', weight: 2 },
      { id: 'spokesperson', label: 'Yondr spokesperson for quotes', type: 'text', required: true },
      {
        id: 'distribution',
        label: 'Distribution',
        type: 'multi',
        weight: 2,
        options: ['Newswire', 'Targeted pitching', 'Yondr website', 'Social', 'Email to customers'],
      },
      { id: 'legal_review', label: 'Needs legal review?', type: 'cards', weight: 1, options: yesNo },
    ],
  },
  {
    id: 'internal_comms',
    category: 'content',
    name: 'Internal communication',
    icon: 'chat',
    requiresApproval: false,
    summary: 'An all-hands slide, company announcement, internal newsletter item or update.',
    keywords: ['internal', 'all hands', 'announcement', 'company update', 'newsletter', 'slack', 'memo', 'employee'],
    deliverables: 'The message in the format you need, ready to send.',
    fields: [
      {
        id: 'channel',
        label: 'How will it go out?',
        type: 'multi',
        required: true,
        options: ['Email', 'Slack', 'All-hands slide', 'Intranet', 'Printed notice'],
      },
      { id: 'sender', label: 'Who is it from?', type: 'text', required: true },
      { id: 'send_date', label: 'Send date', type: 'date', weight: 2 },
      { id: 'draft', label: 'Your draft or notes', type: 'textarea', weight: 3 },
    ],
  },

  // ------------------------------------------------------------------ Sales enablement
  {
    id: 'presentation',
    category: 'sales',
    name: 'Presentation or deck',
    icon: 'slides',
    requiresApproval: true,
    summary: 'A new deck, or design and story help on an existing one: sales, conference, board, training.',
    keywords: ['deck', 'presentation', 'slides', 'powerpoint', 'ppt', 'keynote', 'google slides', 'pitch', 'webinar slides', 'board deck'],
    deliverables: 'A branded deck in the format you choose, with speaker notes if asked.',
    fields: [
      {
        id: 'purpose',
        label: 'What kind of presentation?',
        type: 'cards',
        required: true,
        options: [
          { value: 'sales', label: 'Sales pitch', hint: 'For prospects or customers' },
          { value: 'conference', label: 'Conference talk' },
          { value: 'board', label: 'Board or investors' },
          { value: 'training', label: 'Training or onboarding' },
          { value: 'partner', label: 'Partner or policymaker' },
          { value: 'internal', label: 'Internal meeting' },
        ],
      },
      {
        id: 'starting_point',
        label: 'Starting point',
        type: 'cards',
        required: true,
        options: [
          { value: 'new', label: 'Build it new' },
          { value: 'refresh', label: 'Redesign an existing deck' },
          { value: 'polish', label: 'Polish a few slides' },
        ],
      },
      {
        id: 'existing_deck',
        label: 'Link to the current deck',
        type: 'url',
        required: true,
        showIf: { field: 'starting_point', in: ['refresh', 'polish'] },
      },
      {
        id: 'slide_count',
        label: 'About how many slides?',
        type: 'select',
        weight: 1,
        options: ['1-5', '6-15', '16-30', '30+', 'Not sure'],
      },
      { id: 'presenter', label: 'Presenter', type: 'text', weight: 2, placeholder: 'Name and role' },
      {
        id: 'event_name',
        label: 'Event or meeting',
        type: 'text',
        weight: 1,
        showIf: { field: 'purpose', in: ['conference', 'board', 'partner'] },
      },
      { id: 'presentation_date', label: 'Presentation date', type: 'date', weight: 2 },
      { id: 'talk_length', label: 'Talk length (minutes)', type: 'number', min: 1, max: 480, weight: 1 },
      { id: 'file_format', label: 'Format', type: 'select', required: true, options: ['Google Slides', 'PowerPoint', 'Keynote', 'PDF'] },
      { id: 'speaker_notes', label: 'Need speaker notes written?', type: 'toggle', weight: 0 },
      {
        id: 'outline',
        label: 'Outline, story or must-have slides',
        type: 'textarea',
        weight: 3,
        help: 'A rough list is perfect. Note any data or proof points you want in.',
      },
    ],
  },
  {
    id: 'collateral',
    category: 'sales',
    name: 'One-pager, brochure or sell sheet',
    icon: 'page',
    requiresApproval: true,
    summary: 'A leave-behind or downloadable: one-pager, brochure, flyer, FAQ or product sheet.',
    keywords: [
      'one pager',
      'one-pager',
      'brochure',
      'flyer',
      'sell sheet',
      'leave behind',
      'fact sheet',
      'product sheet',
      'faq',
      'pdf',
      'handout',
    ],
    deliverables: 'A designed PDF (and print files if it will be printed).',
    fields: [
      {
        id: 'piece',
        label: 'What piece?',
        type: 'cards',
        required: true,
        options: [
          { value: 'one_pager', label: 'One-pager' },
          { value: 'brochure', label: 'Brochure' },
          { value: 'flyer', label: 'Flyer' },
          { value: 'faq', label: 'FAQ' },
          { value: 'product_sheet', label: 'Product sheet' },
          { value: 'other', label: 'Other' },
        ],
      },
      {
        id: 'usage',
        label: 'How will it be used?',
        type: 'multi',
        required: true,
        options: ['Emailed as PDF', 'Printed', 'Website download', 'Shown on screen'],
      },
      {
        id: 'print_qty',
        label: 'How many printed copies?',
        type: 'number',
        min: 1,
        required: true,
        showIf: { field: 'usage', in: ['Printed'] },
      },
      {
        id: 'print_size',
        label: 'Print size',
        type: 'select',
        weight: 1,
        options: ['US Letter', 'A4', 'Tri-fold', 'Postcard', 'Other'],
        showIf: { field: 'usage', in: ['Printed'] },
      },
      {
        id: 'content_ready',
        label: 'Is the content written?',
        type: 'cards',
        required: true,
        options: [
          { value: 'ready', label: 'Yes, it is attached' },
          { value: 'partial', label: 'Partly, needs work' },
          { value: 'none', label: 'No, please write it' },
        ],
      },
      { id: 'sections', label: 'What should it cover?', type: 'textarea', weight: 3 },
    ],
  },
  {
    id: 'sales_kit',
    category: 'sales',
    name: 'Sales kit',
    icon: 'briefcase',
    requiresApproval: true,
    summary: 'A set of sales materials for a segment, launch, campaign or new reps: deck, one-pagers, emails, battlecards and more.',
    keywords: [
      'sales kit',
      'kit',
      'enablement',
      'playbook',
      'toolkit',
      'battlecard',
      'talk track',
      'pitch kit',
      'launch kit',
      'onboarding',
    ],
    deliverables: 'Every piece listed, branded and organized in one shared folder, with a short guide on when to use each.',
    fields: [
      {
        id: 'kit_purpose',
        label: 'What is the kit for?',
        type: 'cards',
        required: true,
        options: [
          { value: 'segment', label: 'Selling into a segment', hint: 'e.g. districts, courts, venues' },
          { value: 'launch', label: 'A product or offer launch' },
          { value: 'campaign', label: 'A campaign or event push' },
          { value: 'onboarding', label: 'New sales reps' },
          { value: 'partner', label: 'Partners or distributors' },
          { value: 'refresh', label: 'Refreshing an existing kit' },
        ],
      },
      {
        id: 'existing_kit',
        label: 'Link to the current kit or folder',
        type: 'url',
        required: true,
        showIf: { field: 'kit_purpose', equals: 'refresh' },
      },
      {
        id: 'kit_items',
        label: 'What should be in it?',
        type: 'multi',
        required: true,
        options: [
          'Pitch deck',
          'One-pager or sell sheet',
          'Case studies or customer stories',
          'Email templates or sequences',
          'Call script or talk track',
          'Objection handling guide',
          'Competitive battlecard',
          'Pricing or proposal template',
          'FAQ',
          'Demo or product video',
          'Social posts for reps',
          'Printed leave-behinds',
          'Product images',
        ],
      },
      {
        id: 'print_qty',
        label: 'How many printed leave-behinds?',
        type: 'number',
        min: 1,
        weight: 1,
        showIf: { field: 'kit_items', in: ['Printed leave-behinds'] },
      },
      {
        id: 'kit_users',
        label: 'Who will use the kit?',
        type: 'text',
        required: true,
        placeholder: 'e.g. The K-12 sales team, 12 reps across the US',
      },
      { id: 'kit_launch', label: 'When will reps start using it?', type: 'date', weight: 2 },
      {
        id: 'kit_home',
        label: 'Where should it live?',
        type: 'select',
        weight: 1,
        options: ['Shared Google Drive folder', 'HubSpot', 'Both', 'Not sure, recommend'],
      },
      {
        id: 'kit_messages',
        label: 'Pain points, proof points and objections to cover',
        type: 'textarea',
        weight: 3,
        help: 'What do buyers worry about, what convinces them, and what do reps hear most? Every claim needs a source.',
      },
      { id: 'kit_existing', label: 'Existing materials to reuse', type: 'links', weight: 2 },
    ],
  },
  {
    id: 'proposal',
    category: 'sales',
    name: 'Proposal or RFP support',
    icon: 'clipboard',
    requiresApproval: true,
    summary: 'Help with an RFP response, proposal, grant application or pricing document.',
    keywords: ['rfp', 'proposal', 'bid', 'tender', 'grant', 'quote', 'response', 'procurement', 'rfq'],
    deliverables: 'A branded, edited proposal document ready to submit.',
    fields: [
      { id: 'organization', label: 'Organization it is for', type: 'text', required: true },
      { id: 'submission_deadline', label: 'Submission deadline', type: 'date', required: true },
      { id: 'deal_value', label: 'Estimated deal value', type: 'money', weight: 2 },
      { id: 'crm_link', label: 'Link to the deal in the CRM', type: 'url', weight: 2 },
      {
        id: 'help_needed',
        label: 'What help do you need?',
        type: 'multi',
        required: true,
        options: ['Writing', 'Editing', 'Design and layout', 'Case studies or references', 'Data and research', 'Pricing pages'],
      },
      { id: 'rfp_docs', label: 'RFP or requirements (link)', type: 'url', weight: 2, help: 'Or attach the documents in the next step.' },
      {
        id: 'submission_format',
        label: 'How is it submitted?',
        type: 'select',
        weight: 1,
        options: ['Online portal', 'Email', 'Printed and mailed', 'In person', 'Not sure'],
      },
    ],
  },

  // ------------------------------------------------------------------ Design & brand
  {
    id: 'graphic_design',
    category: 'design',
    name: 'Graphic design',
    icon: 'palette',
    requiresApproval: true,
    summary: 'Infographics, illustrations, report layouts, certificates and other one-off graphics.',
    keywords: ['graphic', 'design', 'infographic', 'illustration', 'icon', 'layout', 'image', 'visual', 'certificate', 'chart', 'diagram'],
    deliverables: 'Final files in the sizes and formats you list, plus editable source.',
    fields: [
      {
        id: 'graphic_kind',
        label: 'What do you need designed?',
        type: 'cards',
        required: true,
        options: [
          { value: 'infographic', label: 'Infographic' },
          { value: 'illustration', label: 'Illustration or icon' },
          { value: 'report', label: 'Report or guide layout' },
          { value: 'chart', label: 'Chart or diagram' },
          { value: 'other', label: 'Something else' },
        ],
      },
      {
        id: 'where_used',
        label: 'Where will it be used?',
        type: 'multi',
        required: true,
        options: ['Website', 'Social', 'Email', 'Print', 'Presentation', 'Video'],
      },
      { id: 'sizes', label: 'Sizes or dimensions', type: 'text', weight: 2, placeholder: 'e.g. 1080×1080, US Letter, 16:9' },
      {
        id: 'file_types',
        label: 'File types',
        type: 'multi',
        weight: 1,
        options: ['PNG', 'JPG', 'PDF', 'SVG', 'Print-ready PDF', 'Editable source (Figma, Canva…)'],
      },
      { id: 'content', label: 'Text, data or content to include', type: 'textarea', weight: 3 },
      { id: 'inspiration', label: 'Examples you like', type: 'links', weight: 1 },
    ],
  },
  {
    id: 'print_signage',
    category: 'design',
    name: 'Print, signage or packaging',
    icon: 'sign',
    requiresApproval: true,
    summary: 'Posters, banners, school and venue signage, stickers, packaging and printed pieces.',
    keywords: ['print', 'signage', 'sign', 'poster', 'banner', 'sticker', 'decal', 'packaging', 'pouch', 'label', 'school sign', 'venue'],
    deliverables: 'Print-ready files, and the printed items delivered if you ask us to order them.',
    fields: [
      {
        id: 'items',
        label: 'Items',
        type: 'multi',
        required: true,
        options: [
          'Posters',
          'Banners',
          'Pull-up / retractable',
          'Stickers or decals',
          'Signs for entrances',
          'Packaging or labels',
          'Postcards',
          'Other',
        ],
      },
      {
        id: 'quantities',
        label: 'Quantities and sizes',
        type: 'textarea',
        required: true,
        placeholder: 'e.g. 20 posters 18×24", 2 banners 3×6\'',
      },
      {
        id: 'production',
        label: 'Who handles printing?',
        type: 'cards',
        required: true,
        options: [
          { value: 'marketing', label: 'Marketing orders it' },
          { value: 'me', label: 'I just need the files' },
        ],
      },
      { id: 'ship_to', label: 'Ship to', type: 'address', required: true, showIf: { field: 'production', equals: 'marketing' } },
      { id: 'in_hand', label: 'Needed in hand by', type: 'date', required: true, showIf: { field: 'production', equals: 'marketing' } },
      { id: 'budget', label: 'Printing budget', type: 'money', weight: 2, showIf: { field: 'production', equals: 'marketing' } },
      {
        id: 'cost_center',
        label: 'Cost center or budget owner',
        type: 'text',
        weight: 2,
        showIf: { field: 'production', equals: 'marketing' },
      },
    ],
  },
  {
    id: 'brand_assets',
    category: 'design',
    name: 'Brand files or templates',
    icon: 'shapes',
    requiresApproval: false,
    summary: 'Logos, co-branded lockups, brand guidelines, templates, email signatures, photos from our library.',
    keywords: [
      'logo',
      'brand',
      'brand guidelines',
      'template',
      'font',
      'colors',
      'co-brand',
      'lockup',
      'signature',
      'headshot',
      'photo library',
      'assets',
    ],
    deliverables: 'The files, sent through the portal.',
    fields: [
      {
        id: 'assets_needed',
        label: 'What do you need?',
        type: 'multi',
        required: true,
        options: [
          'Yondr logo files',
          'Co-branded logo (with a partner)',
          'Brand guidelines',
          'Slide or document template',
          'Email signature',
          'Photos from our library',
          'Product images',
          'Other',
        ],
      },
      {
        id: 'partner_logo',
        label: 'Partner name (attach their logo next)',
        type: 'text',
        required: true,
        showIf: { field: 'assets_needed', in: ['Co-branded logo (with a partner)'] },
      },
      {
        id: 'who_uses',
        label: 'Who will use them, and where?',
        type: 'text',
        required: true,
        help: 'If an outside party will use our logo, tell us who.',
      },
      { id: 'file_types', label: 'File types', type: 'multi', weight: 1, options: ['PNG', 'SVG', 'PDF', 'EPS', 'Any'] },
    ],
  },

  // ------------------------------------------------------------------ Digital & ads
  {
    id: 'paid_ads',
    category: 'digital',
    name: 'Paid ads',
    icon: 'megaphone',
    requiresApproval: true,
    adLibrary: true,
    summary: 'Search, social, display, video or audio ads. Creative is reviewed in the ad library.',
    keywords: [
      'ads',
      'ad',
      'advertising',
      'paid',
      'linkedin ads',
      'meta',
      'facebook',
      'instagram',
      'google ads',
      'display',
      'banner ads',
      'ppc',
      'campaign',
      'retargeting',
      'programmatic',
      'spotify',
    ],
    deliverables: 'Ad creative in every size and channel listed, reviewed and approved in the ad library, then launched.',
    fields: [
      {
        id: 'channels',
        label: 'Channels',
        type: 'multi',
        required: true,
        options: [
          'LinkedIn',
          'Meta (Facebook & Instagram)',
          'Google Search',
          'Google Display',
          'YouTube',
          'Programmatic display',
          'Audio (Spotify, podcasts)',
          'Print or out-of-home',
          'Not sure, recommend',
        ],
      },
      {
        id: 'ad_goal',
        label: 'Campaign goal',
        type: 'cards',
        required: true,
        options: [
          { value: 'awareness', label: 'Awareness' },
          { value: 'leads', label: 'Leads or demos' },
          { value: 'event', label: 'Event sign-ups' },
          { value: 'retarget', label: 'Retarget visitors' },
          { value: 'hiring', label: 'Hiring' },
        ],
      },
      { id: 'flight', label: 'Flight dates', type: 'daterange', required: true },
      { id: 'budget', label: 'Media budget', type: 'money', required: true },
      { id: 'cost_center', label: 'Cost center or budget owner', type: 'text', weight: 2 },
      {
        id: 'targeting',
        label: 'Targeting',
        type: 'textarea',
        weight: 3,
        placeholder: 'Job titles, regions, industries, lists, lookalikes…',
      },
      { id: 'landing_url', label: 'Where should the ads send people?', type: 'url', weight: 3 },
      {
        id: 'creative_ready',
        label: 'Creative',
        type: 'cards',
        required: true,
        options: [
          { value: 'new', label: 'Create new ads' },
          { value: 'resize', label: 'Adapt existing ads' },
          { value: 'have', label: 'I have creative, just run it' },
        ],
      },
      {
        id: 'tracking',
        label: 'Tracking needed',
        type: 'multi',
        weight: 1,
        options: ['UTM links', 'HubSpot campaign', 'Conversion pixel', 'Call tracking'],
      },
    ],
  },
  {
    id: 'email_campaign',
    category: 'digital',
    name: 'Email campaign or newsletter',
    icon: 'mail',
    requiresApproval: true,
    summary: 'A marketing email, nurture sequence, customer newsletter or event invitation.',
    keywords: ['email', 'newsletter', 'nurture', 'sequence', 'drip', 'invite', 'invitation', 'hubspot', 'eblast', 'mailing'],
    deliverables: 'Built and tested email(s) in HubSpot, scheduled after your sign-off.',
    fields: [
      {
        id: 'email_kind',
        label: 'Type of email',
        type: 'cards',
        required: true,
        options: [
          { value: 'single', label: 'One-off send' },
          { value: 'sequence', label: 'Sequence or nurture' },
          { value: 'newsletter', label: 'Newsletter' },
          { value: 'invite', label: 'Event invitation' },
        ],
      },
      {
        id: 'email_count',
        label: 'How many emails in the sequence?',
        type: 'number',
        min: 2,
        max: 20,
        required: true,
        showIf: { field: 'email_kind', equals: 'sequence' },
      },
      {
        id: 'list',
        label: 'Who gets it? (list or segment)',
        type: 'text',
        required: true,
        placeholder: 'e.g. Active K-12 customers in CA, or HubSpot list name',
      },
      { id: 'send_date', label: 'Send date', type: 'date', required: true },
      { id: 'sender_name', label: 'From name', type: 'text', weight: 2, placeholder: 'e.g. The Yondr Team, or a person' },
      { id: 'cta', label: 'Call to action and link', type: 'text', weight: 3 },
      {
        id: 'copy_ready',
        label: 'Is the copy written?',
        type: 'cards',
        weight: 1,
        options: [
          { value: 'yes', label: 'Yes, attached' },
          { value: 'no', label: 'No, please write it' },
        ],
      },
    ],
  },
  {
    id: 'web_page',
    category: 'digital',
    name: 'Website page or update',
    icon: 'browser',
    requiresApproval: true,
    summary: 'A new landing page or site page, or changes to an existing page on overyondr.com.',
    keywords: ['website', 'web', 'landing page', 'page', 'site', 'overyondr.com', 'update', 'fix', 'seo', 'form', 'url'],
    deliverables: 'The page live on overyondr.com (or a preview link for review first).',
    fields: [
      {
        id: 'web_kind',
        label: 'What do you need?',
        type: 'cards',
        required: true,
        options: [
          { value: 'landing', label: 'New landing page', hint: 'For a campaign or event' },
          { value: 'page', label: 'New site page' },
          { value: 'update', label: 'Change an existing page' },
          { value: 'fix', label: 'Fix something broken' },
        ],
      },
      { id: 'page_url', label: 'Page URL', type: 'url', required: true, showIf: { field: 'web_kind', in: ['update', 'fix'] } },
      {
        id: 'changes',
        label: 'What should change?',
        type: 'textarea',
        required: true,
        showIf: { field: 'web_kind', in: ['update', 'fix'] },
      },
      {
        id: 'page_goal',
        label: 'Main action visitors should take',
        type: 'select',
        weight: 2,
        showIf: { field: 'web_kind', in: ['landing', 'page'] },
        options: ['Book a demo / contact sales', 'Fill in a form', 'Download something', 'Register for an event', 'Learn more'],
      },
      { id: 'form_needed', label: 'Needs a form?', type: 'toggle', weight: 0, showIf: { field: 'web_kind', in: ['landing', 'page'] } },
      {
        id: 'form_fields',
        label: 'Form fields and where leads should go',
        type: 'textarea',
        weight: 2,
        showIf: { field: 'form_needed', truthy: true },
      },
      { id: 'live_date', label: 'Go-live date', type: 'date', weight: 2 },
    ],
  },
  {
    id: 'social_media',
    category: 'digital',
    name: 'Social media post or campaign',
    icon: 'share',
    requiresApproval: true,
    summary: 'Organic posts for Yondr channels, or content for you to share.',
    keywords: ['social', 'linkedin', 'instagram', 'twitter', 'x', 'facebook', 'tiktok', 'post', 'organic', 'social media'],
    deliverables: 'Post copy and graphics or video, scheduled or sent to you to post.',
    fields: [
      {
        id: 'platforms',
        label: 'Platforms',
        type: 'multi',
        required: true,
        options: ['LinkedIn', 'Instagram', 'Facebook', 'X', 'TikTok', 'YouTube'],
      },
      {
        id: 'account',
        label: 'Whose account?',
        type: 'cards',
        required: true,
        options: [
          { value: 'yondr', label: 'Yondr company channels' },
          { value: 'personal', label: 'My or a leader’s profile' },
        ],
      },
      { id: 'post_count', label: 'How many posts?', type: 'number', min: 1, max: 50, weight: 1 },
      { id: 'post_date', label: 'Post date', type: 'date', weight: 2 },
      { id: 'tags', label: 'Accounts to tag, hashtags', type: 'text', weight: 1 },
      { id: 'content_idea', label: 'What should the posts say or show?', type: 'textarea', weight: 3 },
    ],
  },

  // ------------------------------------------------------------------ Events & field
  {
    id: 'trade_show',
    category: 'events',
    name: 'Trade show or conference kit',
    icon: 'tent',
    requiresApproval: true,
    summary: 'Everything for a booth: backdrop, table, banners, handouts, swag, demo pouches and lead capture.',
    keywords: [
      'trade show',
      'tradeshow',
      'conference',
      'booth',
      'exhibit',
      'expo',
      'kit',
      'table throw',
      'backdrop',
      'banner stand',
      'convention',
    ],
    deliverables: 'A booth kit designed, produced and shipped to the venue, plus a pre-show checklist.',
    fields: [
      { id: 'event_name', label: 'Event name', type: 'text', required: true, placeholder: 'e.g. ASCD Annual Conference' },
      { id: 'event_url', label: 'Event website', type: 'url', weight: 1 },
      { id: 'event_dates', label: 'Event dates', type: 'daterange', required: true },
      { id: 'location', label: 'City and venue', type: 'text', required: true },
      {
        id: 'booth_size',
        label: 'Booth size',
        type: 'cards',
        required: true,
        options: [
          { value: 'table', label: 'Tabletop' },
          { value: '10x10', label: '10×10 ft' },
          { value: '10x20', label: '10×20 ft' },
          { value: '20x20', label: '20×20 ft or island' },
          { value: 'unknown', label: 'Not sure yet' },
        ],
      },
      { id: 'booth_number', label: 'Booth number', type: 'text', weight: 1, width: 'half' },
      { id: 'attendance', label: 'Expected attendance', type: 'number', min: 0, weight: 1, width: 'half' },
      {
        id: 'kit_items',
        label: 'What do you need?',
        type: 'multi',
        required: true,
        options: [
          'Backdrop or booth graphics',
          'Table throw',
          'Banner stands',
          'Handouts or one-pagers',
          'Swag / giveaways',
          'Demo pouches and unlocking base',
          'Screen or video loop',
          'Lead capture (badge scanner or form)',
          'Booth staff shirts',
          'Signage for a talk',
          'Shipping cases',
        ],
      },
      {
        id: 'handout_qty',
        label: 'How many handouts?',
        type: 'number',
        min: 1,
        weight: 1,
        showIf: { field: 'kit_items', in: ['Handouts or one-pagers'] },
      },
      {
        id: 'swag_qty',
        label: 'How many giveaways?',
        type: 'number',
        min: 1,
        weight: 1,
        showIf: { field: 'kit_items', in: ['Swag / giveaways'] },
      },
      { id: 'ship_to', label: 'Ship to (venue or advance warehouse)', type: 'address', required: true },
      {
        id: 'ship_by',
        label: 'Must arrive by',
        type: 'date',
        required: true,
        help: 'Check the exhibitor manual for the advance-warehouse deadline.',
      },
      { id: 'exhibitor_manual', label: 'Exhibitor manual or booth specs', type: 'url', weight: 2 },
      { id: 'staff', label: 'Who is staffing the booth?', type: 'text', weight: 1 },
      { id: 'budget', label: 'Budget for the kit', type: 'money', weight: 2 },
      { id: 'cost_center', label: 'Cost center or budget owner', type: 'text', weight: 2 },
      { id: 'return_shipping', label: 'Need return shipping?', type: 'toggle', weight: 0 },
    ],
  },
  {
    id: 'event_support',
    category: 'events',
    name: 'Event or sponsorship support',
    icon: 'calendar',
    requiresApproval: true,
    summary: 'Hosting an event, a speaking slot, a sponsorship, or a customer or partner gathering.',
    keywords: [
      'event',
      'sponsorship',
      'sponsor',
      'speaking',
      'dinner',
      'roundtable',
      'meetup',
      'happy hour',
      'summit',
      'invite',
      'registration',
    ],
    deliverables: 'Event plan and the materials agreed: invitations, registration, signage, follow-up.',
    fields: [
      {
        id: 'event_kind',
        label: 'What kind of event?',
        type: 'cards',
        required: true,
        options: [
          { value: 'hosted', label: 'We are hosting' },
          { value: 'sponsor', label: 'We are sponsoring' },
          { value: 'speaking', label: 'Someone is speaking' },
          { value: 'customer', label: 'Customer or partner visit' },
        ],
      },
      { id: 'event_name', label: 'Event name', type: 'text', required: true },
      { id: 'event_dates', label: 'Event dates', type: 'daterange', required: true },
      { id: 'location', label: 'Location (or virtual)', type: 'text', required: true },
      { id: 'guests', label: 'Expected guests', type: 'number', min: 0, weight: 1 },
      {
        id: 'support_needed',
        label: 'What support do you need?',
        type: 'multi',
        required: true,
        options: [
          'Invitations',
          'Registration page',
          'Signage',
          'Presentation',
          'Swag',
          'Venue and catering',
          'Photography',
          'Social promotion',
          'Follow-up email',
        ],
      },
      {
        id: 'sponsorship_level',
        label: 'Sponsorship package and cost',
        type: 'text',
        required: true,
        showIf: { field: 'event_kind', equals: 'sponsor' },
      },
      { id: 'budget', label: 'Budget', type: 'money', weight: 2 },
      { id: 'cost_center', label: 'Cost center or budget owner', type: 'text', weight: 2 },
    ],
  },
  {
    id: 'swag',
    category: 'events',
    name: 'Swag and merchandise',
    icon: 'gift',
    requiresApproval: true,
    summary: 'Branded giveaways, apparel, customer gifts and kits.',
    keywords: ['swag', 'merch', 'merchandise', 'shirts', 't-shirts', 'apparel', 'giveaway', 'gift', 'stickers', 'promo', 'branded'],
    deliverables: 'Designed, ordered and shipped merchandise.',
    fields: [
      {
        id: 'swag_items',
        label: 'Items',
        type: 'multi',
        required: true,
        options: ['T-shirts', 'Hoodies or jackets', 'Hats', 'Stickers', 'Tote bags', 'Water bottles', 'Notebooks', 'Gift boxes', 'Other'],
      },
      {
        id: 'quantities',
        label: 'Quantities and sizes',
        type: 'textarea',
        required: true,
        placeholder: 'e.g. 50 tees: 10 S, 20 M, 15 L, 5 XL',
      },
      { id: 'recipients', label: 'Who is it for?', type: 'text', weight: 2 },
      { id: 'ship_to', label: 'Ship to', type: 'address', required: true },
      { id: 'budget', label: 'Budget', type: 'money', required: true },
      { id: 'cost_center', label: 'Cost center or budget owner', type: 'text', weight: 2 },
    ],
  },
  {
    id: 'webinar',
    category: 'events',
    name: 'Webinar or virtual event',
    icon: 'video',
    requiresApproval: true,
    summary: 'A webinar, virtual panel or online training: registration, promotion, slides and follow-up.',
    keywords: ['webinar', 'virtual', 'online event', 'zoom', 'panel', 'livestream', 'training', 'registration'],
    deliverables: 'Registration page, invitations, reminders, slides and the recording follow-up.',
    fields: [
      { id: 'webinar_title', label: 'Working title', type: 'text', required: true },
      { id: 'webinar_date', label: 'Date and time', type: 'text', required: true, placeholder: 'e.g. 12 March, 2pm ET' },
      { id: 'speakers', label: 'Speakers and moderator', type: 'textarea', required: true },
      {
        id: 'platform',
        label: 'Platform',
        type: 'select',
        weight: 1,
        options: ['Zoom Webinar', 'Google Meet', 'LinkedIn Live', 'Not sure'],
      },
      {
        id: 'webinar_support',
        label: 'What do you need?',
        type: 'multi',
        required: true,
        options: [
          'Registration page',
          'Invitation emails',
          'Social promotion',
          'Slides',
          'Run of show and moderation',
          'Recording and follow-up',
          'Paid promotion',
        ],
      },
      { id: 'registration_goal', label: 'Registration goal', type: 'number', min: 0, weight: 1 },
    ],
  },

  // ------------------------------------------------------------------ Video & photo
  {
    id: 'video',
    category: 'video',
    name: 'Video or animation',
    icon: 'film',
    requiresApproval: true,
    summary: 'Testimonials, explainers, event recaps, social clips, animation and edits of existing footage.',
    keywords: [
      'video',
      'film',
      'animation',
      'motion',
      'explainer',
      'testimonial',
      'recap',
      'reel',
      'edit',
      'youtube',
      'clip',
      'b-roll',
      'gif',
    ],
    deliverables: 'Edited video in the lengths and aspect ratios listed, with captions.',
    fields: [
      {
        id: 'video_kind',
        label: 'What kind of video?',
        type: 'cards',
        required: true,
        options: [
          { value: 'testimonial', label: 'Testimonial' },
          { value: 'explainer', label: 'Explainer or how-to' },
          { value: 'recap', label: 'Event recap' },
          { value: 'social', label: 'Short social clip' },
          { value: 'animation', label: 'Animation or motion graphics' },
          { value: 'edit', label: 'Edit footage we have' },
        ],
      },
      {
        id: 'length',
        label: 'Length',
        type: 'select',
        required: true,
        options: ['Under 15 seconds', '15-30 seconds', '30-60 seconds', '1-3 minutes', '3+ minutes'],
      },
      {
        id: 'aspect',
        label: 'Aspect ratios',
        type: 'multi',
        weight: 2,
        options: ['16:9 (landscape)', '9:16 (vertical)', '1:1 (square)', '4:5'],
      },
      {
        id: 'shoot_needed',
        label: 'Do we need to film?',
        type: 'cards',
        required: true,
        options: [
          { value: 'yes', label: 'Yes, a shoot is needed' },
          { value: 'no', label: 'No, footage exists' },
        ],
        showIf: { field: 'video_kind', in: ['testimonial', 'explainer', 'recap', 'social'] },
      },
      {
        id: 'shoot_details',
        label: 'Shoot location, date and people on camera',
        type: 'textarea',
        required: true,
        showIf: { field: 'shoot_needed', equals: 'yes' },
        help: 'Anyone filmed must sign a release; filming in schools needs the school’s permission.',
      },
      { id: 'footage_link', label: 'Link to footage', type: 'url', required: true, showIf: { field: 'shoot_needed', equals: 'no' } },
      {
        id: 'where_shown',
        label: 'Where will it be shown?',
        type: 'multi',
        required: true,
        options: ['Website', 'Social', 'Paid ads', 'Sales meetings', 'Events', 'Internal'],
      },
      { id: 'script', label: 'Script, story or key moments', type: 'textarea', weight: 3 },
      { id: 'budget', label: 'Budget (crew, music, travel)', type: 'money', weight: 1 },
    ],
  },
  {
    id: 'photography',
    category: 'video',
    name: 'Photography',
    icon: 'camera',
    requiresApproval: true,
    summary: 'A photo shoot at a school, venue or event, headshots or product photography.',
    keywords: ['photo', 'photography', 'photoshoot', 'shoot', 'headshot', 'pictures', 'images', 'product photos', 'event photos'],
    deliverables: 'Edited photos in a shared folder, released for the uses listed.',
    fields: [
      {
        id: 'photo_kind',
        label: 'What kind of shoot?',
        type: 'cards',
        required: true,
        options: [
          { value: 'onsite', label: 'At a customer site' },
          { value: 'event', label: 'Event coverage' },
          { value: 'headshots', label: 'Headshots' },
          { value: 'product', label: 'Product' },
        ],
      },
      { id: 'location', label: 'Location', type: 'text', required: true },
      { id: 'shoot_date', label: 'Shoot date', type: 'date', required: true },
      {
        id: 'site_permission',
        label: 'Do we have permission to shoot there?',
        type: 'cards',
        required: true,
        showIf: { field: 'photo_kind', in: ['onsite', 'event'] },
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'pending', label: 'Asked, waiting' },
          { value: 'no', label: 'Not yet' },
        ],
        help: 'Photos of students need the school’s and families’ permission.',
      },
      { id: 'shot_list', label: 'Shot list', type: 'textarea', weight: 3 },
      { id: 'photo_count', label: 'Number of edited photos needed', type: 'number', min: 1, weight: 1 },
    ],
  },

  // ------------------------------------------------------------------ Research & PR
  {
    id: 'research',
    category: 'insights',
    name: 'Market or competitive research',
    icon: 'compass',
    requiresApproval: true,
    summary: 'Competitor analysis, market sizing, legislation tracking, customer surveys or research summaries.',
    keywords: ['research', 'competitor', 'competitive', 'market', 'survey', 'data', 'analysis', 'insights', 'legislation', 'tam', 'study'],
    deliverables: 'A short report or slides with sources.',
    fields: [
      { id: 'question', label: 'The question you need answered', type: 'textarea', required: true },
      { id: 'decision', label: 'What decision will it inform?', type: 'textarea', required: true },
      {
        id: 'research_kind',
        label: 'Type of research',
        type: 'multi',
        weight: 2,
        options: ['Competitors', 'Market size', 'Legislation and policy', 'Customer survey', 'Academic research summary', 'Other'],
      },
      { id: 'output', label: 'Preferred output', type: 'select', weight: 1, options: ['Short summary', 'Slides', 'Spreadsheet', 'Report'] },
    ],
  },
  {
    id: 'media_pr',
    category: 'insights',
    name: 'Media, PR or award submission',
    icon: 'award',
    requiresApproval: true,
    summary: 'A press opportunity, interview prep, media pitch, or an award or speaking submission.',
    keywords: [
      'media',
      'pr',
      'interview',
      'reporter',
      'journalist',
      'award',
      'nomination',
      'submission',
      'speaking',
      'call for papers',
      'pitch',
    ],
    deliverables: 'Talking points, pitch or submission, ready to send.',
    fields: [
      {
        id: 'pr_kind',
        label: 'What is it?',
        type: 'cards',
        required: true,
        options: [
          { value: 'interview', label: 'Interview or media request' },
          { value: 'pitch', label: 'Pitch a story' },
          { value: 'award', label: 'Award submission' },
          { value: 'speaking', label: 'Speaking submission' },
        ],
      },
      { id: 'outlet', label: 'Outlet, award or event', type: 'text', required: true },
      { id: 'deadline', label: 'Their deadline', type: 'date', required: true },
      {
        id: 'contact',
        label: 'Reporter or organizer contact',
        type: 'text',
        weight: 1,
        showIf: { field: 'pr_kind', in: ['interview', 'speaking'] },
      },
      { id: 'angle', label: 'Angle or story', type: 'textarea', weight: 3 },
      { id: 'spokesperson', label: 'Spokesperson', type: 'text', weight: 2 },
    ],
  },

  // ------------------------------------------------------------------ Other
  {
    id: 'other',
    category: 'other',
    name: 'Something else',
    icon: 'sparkle',
    requiresApproval: true,
    summary: 'Not on the list? Describe it and marketing will route it.',
    keywords: ['other', 'help', 'idea', 'question', 'misc', 'not sure', 'something else'],
    deliverables: 'Agreed with you once marketing has reviewed the request.',
    fields: [
      { id: 'description', label: 'Describe what you need', type: 'textarea', required: true },
      { id: 'format', label: 'What format do you picture?', type: 'text', weight: 2 },
      { id: 'budget', label: 'Budget, if any', type: 'money', weight: 1 },
    ],
  },
];

export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

// ------------------------------------------------------------------ helpers (shared by browser and Worker)

const isEmpty = (v) =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x === '' || x == null));

/** Does a condition hold for these answers? */
export function holds(cond, answers) {
  if (!cond) return true;
  const v = answers[cond.field];
  if (cond.truthy) return !!v && !isEmpty(v);
  if ('equals' in cond) return v === cond.equals;
  if (cond.in) return Array.isArray(v) ? v.some((x) => cond.in.includes(x)) : cond.in.includes(v);
  return true;
}

/** All questions for a type (base + type-specific) that apply to these answers. */
export function visibleFields(type, answers) {
  return [...BASE_FIELDS, ...type.fields].filter((f) => holds(f.showIf, answers));
}

const optValues = (f) => (f.options || []).map((o) => (typeof o === 'string' ? o : o.value));
const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Check one answer. Returns an error message or ''. */
export function fieldError(f, v) {
  if (isEmpty(v)) return f.required ? 'This one is needed.' : '';
  switch (f.type) {
    case 'text':
    case 'textarea':
      if (typeof v !== 'string') return 'Enter text.';
      if (f.maxLength && v.length > f.maxLength) return `Keep it under ${f.maxLength} characters.`;
      return '';
    case 'select':
    case 'cards':
      return optValues(f).includes(v) ? '' : 'Choose one of the options.';
    case 'multi':
      return Array.isArray(v) && v.every((x) => optValues(f).includes(x)) ? '' : 'Choose from the options.';
    case 'date':
      return DATE_RE.test(v) ? '' : 'Enter a date.';
    case 'daterange':
      if (!v || !DATE_RE.test(v.start || '') || !DATE_RE.test(v.end || '')) return 'Enter a start and end date.';
      return v.end < v.start ? 'The end date is before the start.' : '';
    case 'number':
    case 'money': {
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Enter a number.';
      if (f.min !== undefined && n < f.min) return `At least ${f.min}.`;
      if (f.max !== undefined && n > f.max) return `At most ${f.max}.`;
      return '';
    }
    case 'url':
      return URL_RE.test(String(v).trim()) ? '' : 'Enter a full link starting with https://';
    case 'links':
      return Array.isArray(v) && v.every((x) => URL_RE.test(String(x).trim())) ? '' : 'Each link should start with https://';
    case 'toggle':
      return typeof v === 'boolean' ? '' : 'Choose yes or no.';
    case 'address':
      if (typeof v !== 'object') return 'Enter an address.';
      return v.line1 && v.city && v.country ? '' : 'Add at least the street, city and country.';
    default:
      return '';
  }
}

/** Validate a whole brief. Returns { field: message } for every problem. */
export function validateBrief(type, answers) {
  /** @type {Record<string,string>} */
  const errors = {};
  for (const f of visibleFields(type, answers)) {
    const e = fieldError(f, answers[f.id]);
    if (e) errors[f.id] = e;
  }
  return errors;
}

/** Keep only answers to questions that apply, so hidden answers don't linger in a brief. */
export function cleanBrief(type, answers) {
  const out = {};
  for (const f of visibleFields(type, answers)) if (!isEmpty(answers[f.id])) out[f.id] = answers[f.id];
  return out;
}

/**
 * How complete the brief is, 0-100, plus tips for the most valuable missing answers.
 * Required answers weigh 3, optional ones their weight; reference files or links add a little.
 */
export function briefScore(type, answers, { refs = 0, title = '', dueDate = '' } = {}) {
  let total = 0,
    got = 0;
  const tips = [];
  for (const f of visibleFields(type, answers)) {
    const w = f.required ? 3 : (f.weight ?? 1);
    if (!w) continue;
    total += w;
    const v = answers[f.id];
    if (!isEmpty(v) && !fieldError(f, v)) {
      // Very short answers to open questions count half.
      const thin = f.type === 'textarea' && typeof v === 'string' && v.trim().length < 40;
      got += thin ? w / 2 : w;
      if (thin && w >= 2) tips.push({ field: f.id, weight: w / 2, text: `Add a little more detail to “${f.label}”.` });
    } else if (!f.required && w >= 2) {
      tips.push({ field: f.id, weight: w, text: `Answer “${f.label}” to save a round of questions.` });
    }
  }
  total += 4;
  if (title.trim().length >= 6) got += 1;
  if (dueDate) got += 1;
  if (refs > 0) got += 2;
  else
    tips.push({
      field: 'references',
      weight: 2,
      text: 'Attach examples, drafts or links: they are the fastest way to show what you mean.',
    });
  tips.sort((a, b) => b.weight - a.weight);
  return { score: Math.round((got / total) * 100), tips: tips.slice(0, 3) };
}

/** Add business days (Mon-Fri) to a YYYY-MM-DD date. */
export function addBusinessDays(fromYmd, days) {
  const d = new Date(fromYmd + 'T12:00:00Z');
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Business days between two YYYY-MM-DD dates (positive when `to` is later). */
export function businessDaysBetween(fromYmd, toYmd) {
  const a = new Date(fromYmd + 'T12:00:00Z'),
    b = new Date(toYmd + 'T12:00:00Z');
  const sign = b >= a ? 1 : -1;
  const [lo, hi] = sign > 0 ? [a, b] : [b, a];
  let n = 0;
  const d = new Date(lo);
  while (d < hi) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n * sign;
}

/** Simple search over the catalog: name, summary and keywords; best matches first. */
export function searchTypes(q, types = TYPES) {
  const words = String(q || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return types;
  return types
    .map((t) => {
      const hay = [t.name, t.summary, ...t.keywords].join(' ').toLowerCase();
      let s = 0;
      for (const w of words) {
        if (t.keywords.some((k) => k === w)) s += 5;
        else if (t.keywords.some((k) => k.startsWith(w))) s += 3;
        else if (t.name.toLowerCase().includes(w)) s += 3;
        else if (hay.includes(w)) s += 1;
        else return { t, s: -1 };
      }
      return { t, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

/** A readable version of an answer, for summaries, emails and exports. */
export function formatAnswer(f, v) {
  if (isEmpty(v)) return '';
  const label = (x) => {
    const o = (f.options || []).find((o) => (typeof o === 'string' ? o : o.value) === x);
    return o ? (typeof o === 'string' ? o : o.label) : String(x);
  };
  switch (f.type) {
    case 'select':
    case 'cards':
      return label(v);
    case 'multi':
      return v.map(label).join(', ');
    case 'toggle':
      return v ? 'Yes' : 'No';
    case 'daterange':
      return `${v.start} to ${v.end}`;
    case 'money':
      return '$' + Number(v).toLocaleString('en-US');
    case 'links':
      return v.join('\n');
    case 'address':
      return [v.name, v.line1, v.line2, [v.city, v.region, v.postal].filter(Boolean).join(' '), v.country, v.phone]
        .filter(Boolean)
        .join('\n');
    default:
      return String(v);
  }
}
