/**
 * Fixtures mirror the field names verified LIVE on 2026-08-27 against:
 * boards-api.greenhouse.io (stripe), api.lever.co (leverdemo),
 * api.ashbyhq.com (openai), apply.workable.com (blueground).
 * SmartRecruiters/Recruitee fixtures follow their public docs (smoke-test flagged).
 */
export const greenhousePayload = {
  jobs: [
    {
      id: 4400001, internal_job_id: 111, requisition_id: 'R-1',
      title: 'Staff Software Engineer, Payments',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/4400001',
      location: { name: 'Remote — EMEA' },
      updated_at: '2026-08-01T10:00:00-04:00',
      first_published: '2026-07-20T09:00:00-04:00',
      company_name: 'Acme',
      language: 'en',
      departments: [{ id: 1, name: 'Engineering', child_ids: [], parent_id: null }],
      offices: [{ id: 9, name: 'London', location: 'London, UK', child_ids: [], parent_id: null }],
      metadata: [{ id: 5, name: 'Employment Type', value: 'Full-time' }],
      content: '&lt;p&gt;Build &amp;amp; scale payments infra.&lt;/p&gt;',
    },
    {
      id: 4400002, title: 'Staff Software Engineer, Payments',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/4400002',
      location: { name: 'Remote — EMEA' },
      updated_at: '2026-08-02T10:00:00-04:00', first_published: '2026-07-21T09:00:00-04:00',
      company_name: 'Acme', departments: [], offices: [], metadata: [], content: '',
    },
    {
      id: 4400003, title: 'Accountant',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/4400003',
      location: { name: 'Milan, Italy' },
      updated_at: '2025-01-05T10:00:00-04:00', first_published: '2025-01-02T09:00:00-04:00',
      company_name: 'Acme', departments: [{ id: 2, name: 'Finance' }], offices: [], metadata: [], content: '',
    },
  ],
};

export const leverPayload = [
  {
    id: 'abc-123', text: 'Senior Backend Engineer',
    country: 'GB', workplaceType: 'remote',
    hostedUrl: 'https://jobs.lever.co/acme/abc-123',
    applyUrl: 'https://jobs.lever.co/acme/abc-123/apply',
    createdAt: 1755000000000,
    description: '<p>APIs all day.</p>', descriptionPlain: 'APIs all day.',
    categories: { commitment: 'Full-time', department: 'Engineering', location: 'London', team: 'Platform', allLocations: ['London', 'Remote UK'] },
    lists: [{ text: 'Requirements', content: '<li>Node.js</li>' }],
    salaryRange: { min: 90000, max: 120000, currency: 'GBP', interval: 'per-year-salary' },
    salaryDescriptionPlain: '£90k–£120k + equity',
  },
];

export const ashbyPayload = {
  jobs: [
    {
      id: 'uuid-1', title: 'Machine Learning Engineer',
      department: 'Research', team: 'Training',
      employmentType: 'FullTime', location: 'San Francisco',
      secondaryLocations: [{ location: 'New York' }],
      publishedAt: '2026-08-10T00:00:00.000Z',
      isListed: true, isRemote: false, workplaceType: 'Hybrid',
      jobUrl: 'https://jobs.ashbyhq.com/acme/uuid-1',
      applyUrl: 'https://jobs.ashbyhq.com/acme/uuid-1/application',
      descriptionHtml: '<p>Train things.</p>', descriptionPlain: 'Train things.',
      compensation: {
        compensationTierSummary: '$200K – $300K',
        scrapeableCompensationSalarySummary: '$200K – $300K',
        summaryComponents: [{ compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 200000, maxValue: 300000 }],
      },
    },
    { id: 'uuid-2', title: 'Ghost Job', isListed: false, location: 'Nowhere', jobUrl: 'x' },
  ],
};

export const workablePayload = {
  name: 'Blueground', description: 'desc',
  jobs: [
    {
      title: 'Growth Marketing Manager', shortcode: 'GR0W1', code: 'J-77',
      employment_type: 'Full-time', telecommuting: true,
      department: 'Marketing',
      url: 'https://apply.workable.com/blueground/j/GR0W1',
      application_url: 'https://apply.workable.com/blueground/j/GR0W1/apply',
      published_on: '2026-08-15', created_at: '2026-08-14',
      country: 'Greece', city: 'Athens', state: 'Attica',
      locations: [{ country: 'Greece', countryCode: 'GR', city: 'Athens', region: 'Attica', hidden: false }],
      description: '<p>Grow.</p>',
    },
  ],
};

export const smartrecruitersPayload = {
  totalFound: 1,
  content: [
    {
      id: '744000001', uuid: 'u-1', name: 'Solution Architect',
      releasedDate: '2026-08-05T08:00:00.000Z',
      location: { city: 'Berlin', region: 'BE', country: 'de', remote: false },
      department: { label: 'Professional Services' }, function: { label: 'Consulting' },
      typeOfEmployment: { label: 'Full-time' },
      company: { name: 'Acme GmbH' }, ref: 'https://api.smartrecruiters.com/v1/companies/acme/postings/744000001',
    },
  ],
};

// Shape live-verified 2026-08-27 against greenchoice.recruitee.com/api/offers/
export const recruiteePayload = {
  offers: [
    {
      id: 9001, slug: 'frontend-dev', title: 'Frontend Developer',
      department: 'Engineering', city: 'Amsterdam', country: 'Netherlands',
      location: 'Amsterdam, Netherlands',
      locations: [{ id: 1, name: 'Amsterdam', city: 'Amsterdam', country: 'Netherlands' }],
      remote: true, hybrid: false, on_site: false, employment_type_code: 'fulltime',
      salary: { min: '4426', max: '6323', period: 'month', currency: 'EUR' },
      careers_url: 'https://acme.recruitee.com/o/frontend-dev',
      careers_apply_url: 'https://acme.recruitee.com/o/frontend-dev/c/new',
      published_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-15 08:00:00 UTC',
      description: '<p>React.</p>',
    },
    {
      id: 9002, slug: 'ops-manager', title: 'Operations Manager',
      department: 'Operations', city: 'Rotterdam', country: 'Netherlands',
      location: 'Rotterdam, Zuid-Holland, Netherlands',
      remote: false, hybrid: true, on_site: false, employment_type_code: 'fulltime',
      salary: {},
      careers_url: 'https://acme.recruitee.com/o/ops-manager',
      careers_apply_url: 'https://acme.recruitee.com/o/ops-manager/c/new',
      published_at: '2026-08-02T00:00:00.000Z',
      description: '<p>Ops.</p>',
    },
  ],
};

// ---- sources added in 1.1 (shapes live-verified 2026-08-27) -----------------

// nvidia.wd5.myworkdayjobs.com — list view is intentionally thin
export const workdayPayload = {
  total: 2,
  jobPostings: [
    { title: 'Senior AI Tools Engineer', externalPath: '/job/US-CA-Remote/Senior-AI-Tools-Engineer_JR2023138', locationsText: '2 Locations', postedOn: 'Posted Today', bulletFields: ['JR2023138'] },
    { title: 'Safety Engineer', externalPath: '/job/India-Bengaluru/Safety-Engineer_JR2023363', locationsText: 'India, Bengaluru', postedOn: 'Posted 5 Days Ago', bulletFields: ['JR2023363'] },
  ],
};

// personio.jobs.personio.de/xml
export const personioXml = `<?xml version="1.0" encoding="utf-8"?>
<workzag-jobs>
  <position>
    <id>1834171</id>
    <subcompany>Personio SE &amp; Co. KG</subcompany>
    <office>Munich</office>
    <additionalOffices>
      <office>Berlin</office>
    </additionalOffices>
    <department>Product and Tech</department>
    <recruitingCategory>Engineering</recruitingCategory>
    <name>Staff Software Engineer, Data Platform</name>
    <jobDescriptions>
      <jobDescription><name><![CDATA[Your role]]></name><value><![CDATA[<p>Build &amp; scale.</p>]]></value></jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>experienced</seniority>
    <schedule>full-time</schedule>
    <createdAt>2024-11-13T14:10:41+00:00</createdAt>
  </position>
</workzag-jobs>`;

// breezy.breezy.hr/json
export const breezyPayload = [
  {
    id: '98323abf2296', friendly_id: '98323abf2296-employee-12', name: 'Senior Engineer',
    url: 'https://acme.breezy.hr/p/98323abf2296-senior-engineer',
    published_date: '2026-02-15T14:37:22.684Z',
    type: { id: 'full_time', name: 'Full-Time' },
    location: { country: { name: 'United States', id: 'US' }, state: { id: 'FL', name: 'Florida' }, city: 'Miami', is_remote: true, name: 'Miami, FL' },
    locations: [{ name: 'Miami, FL' }, { name: 'Remote, US' }],
    department: 'Engineering',
    salary: '$120,000 – $150,000 / year',
    company: { name: 'Acme Inc', friendly_id: 'acme' },
  },
];

// api.rippling.com/platform/api/ats/v1/board/{slug}/jobs
export const ripplingPayload = [
  {
    uuid: '2f0674e6-f01f-4ecd-b459-e947241c211f',
    name: 'Account Executive - Remote',
    department: { id: 'Sales', label: 'Sales' },
    url: 'https://ats.rippling.com/acme/jobs/2f0674e6',
    workLocation: { label: 'New York, NY', id: 'New York, NY' },
  },
];

// ---- sources added in 1.3 (shapes live-verified 2026-08-27) ----------------

// {slug}.pinpointhq.com/postings.json — one posting with published pay, one
// with pay hidden by the employer (compensation_visible: false).
export const pinpointPayload = {
  data: [
    {
      id: '531872', title: 'Marketing Manager',
      url: 'https://acme.pinpointhq.com/en/postings/178aabc4-04c0-4582-973e-5033838c1002',
      path: '/en/postings/178aabc4-04c0-4582-973e-5033838c1002',
      employment_type: 'full_time', employment_type_text: 'Full Time',
      workplace_type: 'onsite', workplace_type_text: 'Onsite',
      compensation: '£48,000 - £75,000 / year',
      compensation_minimum: 48000, compensation_maximum: 75000,
      compensation_currency: 'GBP', compensation_frequency: 'year', compensation_visible: true,
      deadline_at: null, reporting_to: 'Chief Marketing Officer',
      description: '<div><!--block-->Grow &amp; scale the brand.</div>',
      benefits: '<div>Good coffee.</div>', benefits_header: 'What We Offer: ',
      key_responsibilities: '<ul><li>Own the funnel</li></ul>', key_responsibilities_header: 'About the Role:',
      skills_knowledge_expertise: '<ul><li>5+ years</li></ul>', skills_knowledge_expertise_header: 'About you',
      job: { id: '536861', requisition_id: '0002', department: { id: '78605', name: 'Operations' }, division: { id: '17373', name: 'Hooli' }, structure_custom_group_one: null },
      location: { id: '88971', city: null, name: 'Paris', postal_code: null, province: null, street_address: null },
    },
    {
      id: '559663', title: 'Founding Legal Counsel',
      url: 'https://acme.pinpointhq.com/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04',
      path: '/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04',
      employment_type: 'full_time', employment_type_text: 'Full Time',
      workplace_type: 'remote', workplace_type_text: 'Fully remote',
      compensation: null, compensation_minimum: null, compensation_maximum: null,
      compensation_currency: null, compensation_frequency: null, compensation_visible: false,
      deadline_at: null, reporting_to: 'Chief Operating Officer',
      description: '<div><!--block-->Own commercial contracting.</div>',
      job: { id: '562609', requisition_id: 'PIN-0407', department: { id: '1788', name: 'Operations' }, division: null, structure_custom_group_one: null },
      location: { id: '283', city: 'London', name: 'Remote', postal_code: null, province: 'London', street_address: null },
    },
  ],
};

// {slug}.teamtailor.com/jobs.rss — descriptions arrive entity-escaped
export const teamtailorRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations">
  <channel>
    <title>Acme</title>
    <description>Current job openings</description>
    <link>https://acme.teamtailor.com/jobs</link>
    <item>
      <title>Partnership Manager - APAC</title>
      <description>&lt;p&gt;Build &amp;amp; scale partnerships.&lt;/p&gt;</description>
      <pubDate>Wed, 29 Jul 2026 15:03:12 +0200</pubDate>
      <link>https://acme.teamtailor.com/jobs/8144170-partnership-manager-apac</link>
      <remoteStatus>none</remoteStatus>
      <guid>36d9bbe6-6cf5-4c10-b12b-d4bf739777ce</guid>
      <tt:locations>
        <tt:location>
          <tt:name>Sydney</tt:name>
          <tt:address>WeWork - Office Space &amp; Coworking</tt:address>
          <tt:zip>2000</tt:zip>
          <tt:city>Sydney</tt:city>
          <tt:country>Australia</tt:country>
        </tt:location>
        <tt:location>
          <tt:name>Melbourne</tt:name>
          <tt:address/>
          <tt:zip/>
          <tt:city>Melbourne</tt:city>
          <tt:country>Australia</tt:country>
        </tt:location>
      </tt:locations>
      <tt:department>Partnerships</tt:department>
      <tt:role>Partnerships Manager</tt:role>
      <tt:division/>
    </item>
    <item>
      <title>Group Financial Controller</title>
      <description>&lt;p&gt;Close the books.&lt;/p&gt;</description>
      <pubDate>Fri, 24 Jul 2026 13:57:16 +0200</pubDate>
      <link>https://acme.teamtailor.com/jobs/8124573-group-financial-controller</link>
      <remoteStatus>hybrid</remoteStatus>
      <guid>0d0a2d1e-3a2c-4f0e-9a3c-2a1b7c5d9e41</guid>
      <tt:locations>
        <tt:location>
          <tt:name></tt:name>
          <tt:address>Tryckerigatan 4</tt:address>
          <tt:zip>111 28</tt:zip>
          <tt:city>Stockholm</tt:city>
          <tt:country>Sweden</tt:country>
        </tt:location>
      </tt:locations>
      <tt:department>Finance</tt:department>
      <tt:division/>
    </item>
  </channel>
</rss>`;
