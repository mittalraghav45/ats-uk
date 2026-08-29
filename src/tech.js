/**
 * Technology extraction from job text.
 *
 * Why this exists: "which of my stack does this role actually use" is the
 * question every technical recruiter and every job-seeker asks of a board, and
 * no ATS answers it — the information is prose. A curated dictionary turns that
 * prose into a comparable, filterable array.
 *
 * The whole design is defensive, because a false positive here is expensive: a
 * "Go-to-market Manager" tagged `Go` poisons every downstream filter, and the
 * buyer has no way to see that it happened. So:
 *
 *  - **word boundaries always**. Without them "Rust" matches "trusted",
 *    "Java" matches "Javanese", "SQL" matches "MySQL".
 *  - **case-sensitivity where the lowercase word is English**. `SAP` is an ERP,
 *    "sap" is not; `SAS` is a language, "SaaS" is a delivery model.
 *  - **negative lookaheads for the known collisions**, each with the phrase it
 *    is defending against written next to it.
 *  - **omissions are a feature**. `R` and plain `C` are deliberately NOT in
 *    this dictionary: a single letter cannot be disambiguated from "R&D",
 *    "Plan R", "C-level", "C-suite" or a bullet marker with any rule that is
 *    still worth trusting, and a dictionary that is right 80% of the time is
 *    worse than one that is quiet. `C++`, `C#` and `Objective-C` are all here,
 *    so C-family work is still visible. Same reasoning for `Chef` (kitchens)
 *    and `Less` (the English word).
 *
 * Matching runs against the job *text* only (title + description), never
 * against our own metadata — so the `oracle` source name can never produce an
 * `Oracle Database` tag.
 *
 * Pure module: no I/O, no clock, no SDK, no dependencies.
 */

/**
 * [canonical name, pattern]. Patterns carry their own flags: `i` for anything
 * whose casing varies freely in prose, no `i` where the case *is* the signal.
 * Order is irrelevant — every entry is tested, and the output is sorted.
 */
const TECHNOLOGIES = [
  // ---- languages ------------------------------------------------------------
  ['Python', /\bpython\b/i],
  ['JavaScript', /\bjavascript\b|\becmascript\b/i], // bare "JS" is skipped: it also lives inside "Node.js", "Vue.js"
  ['TypeScript', /\btypescript\b/i],
  ['Java', /\bjava\b(?!\s*script)/i],               // "Java Script" written out; "JavaScript" is already blocked by \b
  ['C++', /\bc\+\+|\bcpp\b/i],
  ['C#', /\bc#|\bc\s?sharp\b/i],
  ['Objective-C', /\bobjective[-\s]?c\b/i],
  // Case-sensitive on purpose, and it still needs the lookahead: "Go-to-market",
  // "go live" and "Go Getter" all carry a capital G in a title.
  ['Go', /\b[Gg]olang\b|\bGo\b(?![-\s]*(?:to|live|beyond|getter|forward|big|deep|green|public)\b)/],
  ['Rust', /\brust\b/i],
  ['Ruby', /\bruby\b/i],
  ['PHP', /\bphp\b/i],
  ['Swift', /\bswift\b(?!\s*(?:code|payments?|network|messag|transfer|bic))/i], // SWIFT the banking network
  ['Kotlin', /\bkotlin\b/i],
  ['Scala', /\bscala\b/i],
  ['MATLAB', /\bmatlab\b/i],
  ['Perl', /\bperl\b/i],
  ['Elixir', /\belixir\b/i],
  ['Erlang', /\berlang\b/i],
  ['Haskell', /\bhaskell\b/i],
  ['Clojure', /\bclojure\b/i],
  ['Lua', /\blua\b/i],
  ['Groovy', /\bgroovy\b/i],
  ['Julia', /\bJulia\b(?!\s+[A-Z])/],               // case-sensitive; a capitalised follower means a person named Julia
  ['Dart', /\bdart\b/i],
  ['Fortran', /\bfortran\b/i],
  ['COBOL', /\bcobol\b/i],
  ['Assembly', /\bassembly\s+language\b|\bx86\s+assembly\b/i], // never bare "assembly" (manufacturing)
  ['VBA', /\bvba\b/i],
  ['Visual Basic', /\bvisual\s+basic\b/i],
  ['SAS', /\bSAS\b/],                                // case-sensitive: "SaaS" is a different word
  ['SPSS', /\bspss\b/i],
  ['Stata', /\bstata\b/i],
  ['Solidity', /\bsolidity\b/i],
  ['Verilog', /\bverilog\b|\bsystemverilog\b/i],
  ['VHDL', /\bvhdl\b/i],
  ['ABAP', /\babap\b/i],
  ['Apex', /\bapex\b/i],
  ['Shell', /\bshell\s+script/i],
  ['Bash', /\bbash\b|\bzsh\b/i],
  ['PowerShell', /\bpowershell\b/i],
  ['SQL', /\bsql\b/i],                               // \b keeps MySQL/NoSQL/PL-SQL out
  ['PL/SQL', /\bpl\/?sql\b/i],
  ['T-SQL', /\bt-sql\b|\btransact-sql\b/i],
  ['Regex', /\bregular\s+expressions?\b|\bregexe?s?\b/i],

  // ---- frontend frameworks / web -------------------------------------------
  ['React', /\breact(?:\.js)?\b(?!\s*native)/i],
  ['React Native', /\breact\s*native\b/i],
  ['Angular', /\bangular(?:js)?\b/i],
  ['Vue', /\bvue(?:\.js)?\b/i],
  ['Svelte', /\bsvelte(?:kit)?\b/i],
  ['Next.js', /\bnext\.?js\b/i],
  ['Nuxt', /\bnuxt(?:\.?js)?\b/i],
  ['Remix', /\bremix\s*(?:\.run|framework)\b/i],     // "remix" alone is a music/product word
  ['Ember.js', /\bember(?:\.?js)?\b/i],
  ['Backbone.js', /\bbackbone\.?js\b/i],
  ['jQuery', /\bjquery\b/i],
  ['Redux', /\bredux\b/i],
  ['HTML', /\bhtml5?\b/i],
  ['CSS', /\bcss3?\b/i],
  ['Sass', /\bsass\b|\bscss\b/i],
  ['Tailwind CSS', /\btailwind\b/i],
  ['Bootstrap', /\bbootstrap\b/i],
  ['Webpack', /\bwebpack\b/i],
  ['Vite', /\bvite\b/i],
  ['Babel', /\bbabel\b/i],
  ['Storybook', /\bstorybook\b/i],
  ['WebAssembly', /\bwebassembly\b|\bwasm\b/i],
  ['Three.js', /\bthree\.js\b/i],
  ['D3.js', /\bd3\.js\b/i],
  ['Electron', /\belectron\b(?!ic)/i],

  // ---- backend frameworks / runtimes ---------------------------------------
  ['Node.js', /\bnode\.?js\b/i],
  ['Deno', /\bdeno\b/i],
  ['Bun', /\bbun\.?js\b|\bbun\s+runtime\b/i],        // never bare "bun"
  ['Express', /\bexpress\.?js\b|\bexpress\s+framework\b/i], // never bare "express" (the English verb)
  ['NestJS', /\bnest\.?js\b/i],
  ['Django', /\bdjango\b/i],
  ['Flask', /\bflask\b/i],
  ['FastAPI', /\bfastapi\b/i],
  ['Ruby on Rails', /\bruby\s+on\s+rails\b|\brails\b/i],
  ['Spring', /\bspring\s*boot\b|\bspring\s+framework\b|\bspring\b(?=\s*(?:mvc|cloud|security|data))/i],
  ['.NET', /\.net\b|\bdotnet\b/i],
  ['ASP.NET', /\basp\.net\b/i],
  ['Laravel', /\blaravel\b/i],
  ['Symfony', /\bsymfony\b/i],
  ['Phoenix', /\bphoenix\s+framework\b|\bphoenix\/liveview\b/i], // "Phoenix" is also a city
  ['Gin', /\bgin\s+(?:framework|gonic)\b/i],
  ['GraphQL', /\bgraphql\b/i],
  ['gRPC', /\bgrpc\b/i],
  ['REST API', /\brest(?:ful)?\s*apis?\b/i],
  ['WebSockets', /\bwebsockets?\b/i],
  ['OpenAPI', /\bopenapi\b|\bswagger\b/i],
  ['OAuth', /\boauth2?\b/i],

  // ---- mobile ---------------------------------------------------------------
  ['iOS', /\bios\b/i],
  ['Android', /\bandroid\b/i],
  ['SwiftUI', /\bswiftui\b/i],
  ['Flutter', /\bflutter\b/i],
  ['Xamarin', /\bxamarin\b/i],
  ['Ionic', /\bionic\s+framework\b/i],
  ['Unity', /\bunity\s*3d\b|\bunity\s+(?:engine|developer|games?)\b/i], // never bare "unity" (the English noun)
  ['Unreal Engine', /\bunreal\s+engine\b|\bunreal\b(?=\s*\d)/i],

  // ---- data / AI ------------------------------------------------------------
  ['PyTorch', /\bpytorch\b/i],
  ['TensorFlow', /\btensorflow\b/i],
  ['Keras', /\bkeras\b/i],
  ['scikit-learn', /\bscikit[-\s]?learn\b|\bsklearn\b/i],
  ['Pandas', /\bpandas\b/i],
  ['NumPy', /\bnumpy\b/i],
  ['SciPy', /\bscipy\b/i],
  ['Matplotlib', /\bmatplotlib\b/i],
  ['XGBoost', /\bxgboost\b|\blightgbm\b/i],
  ['Hugging Face', /\bhugging\s*face\b/i],
  ['LangChain', /\blangchain\b/i],
  ['LlamaIndex', /\bllamaindex\b/i],
  ['LLM', /\bllms?\b|\blarge\s+language\s+models?\b/i],
  ['RAG', /\bretrieval[-\s]augmented\s+generation\b|\bRAG\b(?!\s*(?:status|rating|report))/], // "RAG status" is project-management red/amber/green
  ['NLP', /\bnlp\b|\bnatural\s+language\s+processing\b/i],
  ['Computer Vision', /\bcomputer\s+vision\b/i],
  ['Machine Learning', /\bmachine\s+learning\b|\bml\s+(?:models?|engineer|pipelines?)\b/i],
  ['Deep Learning', /\bdeep\s+learning\b/i],
  ['MLOps', /\bmlops\b/i],
  ['MLflow', /\bmlflow\b/i],
  ['Spark', /\bapache\s+spark\b|\bpyspark\b|\bspark\b(?=\s*(?:sql|streaming|jobs?|clusters?))/i],
  ['Hadoop', /\bhadoop\b/i],
  ['Hive', /\bapache\s+hive\b|\bhive\b(?=\s*(?:ql|metastore|tables?))/i],
  ['Flink', /\bflink\b/i],
  ['Kafka', /\bkafka\b/i],
  ['Airflow', /\bairflow\b/i],
  ['dbt', /\bdbt\b/i],
  ['Dagster', /\bdagster\b/i],
  ['Prefect', /\bprefect\b/i],
  ['Snowflake', /\bsnowflake\b/i],
  ['Databricks', /\bdatabricks\b/i],
  ['BigQuery', /\bbigquery\b/i],
  ['Redshift', /\bredshift\b/i],
  ['Athena', /\baws\s+athena\b|\bathena\b(?=\s*(?:queries|sql))/i],
  ['Looker', /\blooker\b/i],
  ['Tableau', /\btableau\b/i],
  ['Power BI', /\bpower\s*bi\b/i],
  ['Qlik', /\bqlik(?:view|sense)?\b/i],
  ['Metabase', /\bmetabase\b/i],
  ['Superset', /\bapache\s+superset\b/i],
  ['ETL', /\betl\b|\belt\s+pipelines?\b/i],
  ['Data Warehouse', /\bdata\s+warehous(?:e|ing)\b/i],

  // ---- databases ------------------------------------------------------------
  ['PostgreSQL', /\bpostgre(?:s|sql)?\b|\bpsql\b/i],
  ['MySQL', /\bmysql\b/i],
  ['MariaDB', /\bmariadb\b/i],
  ['MongoDB', /\bmongo(?:db)?\b/i],
  ['Redis', /\bredis\b/i],
  ['Elasticsearch', /\belastic\s*search\b|\belasticsearch\b|\bELK\b/i],
  ['OpenSearch', /\bopensearch\b/i],
  ['Cassandra', /\bcassandra\b/i],
  ['DynamoDB', /\bdynamodb\b/i],
  ['SQLite', /\bsqlite\b/i],
  ['Oracle Database', /\boracle\s*(?:database|db|rdbms|sql|exadata|1[129][a-z]?)\b/i], // never bare "Oracle" (the company / our own source name)
  ['SQL Server', /\bsql\s+server\b|\bmssql\b/i],
  ['Neo4j', /\bneo4j\b/i],
  ['ClickHouse', /\bclickhouse\b/i],
  ['DuckDB', /\bduckdb\b/i],
  ['InfluxDB', /\binfluxdb\b/i],
  ['CouchDB', /\bcouchdb\b/i],
  ['Firebase', /\bfirebase\b|\bfirestore\b/i],
  ['Supabase', /\bsupabase\b/i],
  ['Pinecone', /\bpinecone\b/i],

  // ---- cloud / infra --------------------------------------------------------
  ['AWS', /\baws\b|\bamazon\s+web\s+services\b/i],
  ['Azure', /\bazure\b/i],
  ['GCP', /\bgcp\b|\bgoogle\s+cloud\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['Docker', /\bdocker\b/i],
  ['OpenShift', /\bopenshift\b/i],
  ['Helm', /\bhelm\b(?!\s+of\b)/i],                  // "at the helm of"
  ['Terraform', /\bterraform\b/i],
  ['Pulumi', /\bpulumi\b/i],
  ['Ansible', /\bansible\b/i],
  ['Puppet', /\bpuppet\b/i],
  ['Vagrant', /\bvagrant\b/i],
  ['Jenkins', /\bjenkins\b/i],
  ['GitHub Actions', /\bgithub\s+actions\b/i],
  ['GitLab CI', /\bgitlab\s*ci(?:\/cd)?\b/i],
  ['CircleCI', /\bcircleci\b/i],
  ['Travis CI', /\btravis\s*ci\b/i],
  ['ArgoCD', /\bargo\s*cd\b/i],
  ['Nginx', /\bnginx\b/i],
  ['Apache', /\bapache\s+(?:http|web\s+server|tomcat)\b/i],
  ['Tomcat', /\btomcat\b/i],
  ['RabbitMQ', /\brabbitmq\b/i],
  ['Serverless', /\bserverless\b|\baws\s+lambda\b/i],
  ['Prometheus', /\bprometheus\b/i],
  ['Grafana', /\bgrafana\b/i],
  ['Datadog', /\bdatadog\b/i],
  ['Splunk', /\bsplunk\b/i],
  ['New Relic', /\bnew\s+relic\b/i],
  ['Sentry', /\bsentry\b/i],
  ['Linux', /\blinux\b|\bubuntu\b|\bdebian\b|\bcentos\b/i],
  ['Unix', /\bunix\b/i],
  ['CI/CD', /\bci\/cd\b|\bcontinuous\s+(?:integration|delivery|deployment)\b/i],
  ['Microservices', /\bmicro\s?services?\b/i],
  ['SRE', /\bsre\b|\bsite\s+reliability\b/i],
  ['DevOps', /\bdevops\b/i],
  ['DevSecOps', /\bdevsecops\b/i],
  ['Cloudflare', /\bcloudflare\b/i],
  ['Vercel', /\bvercel\b/i],
  ['Heroku', /\bheroku\b/i],

  // ---- testing / quality ----------------------------------------------------
  ['Selenium', /\bselenium\b/i],
  ['Cypress', /\bcypress\b/i],
  ['Playwright', /\bplaywright\b/i],
  ['Jest', /\bjest\b/i],
  ['JUnit', /\bjunit\b/i],
  ['pytest', /\bpytest\b/i],
  ['Cucumber', /\bcucumber\b/i],
  ['Postman', /\bpostman\b/i],
  ['TDD', /\btdd\b|\btest[-\s]driven\s+development\b/i],
  ['BDD', /\bbdd\b|\bbehaviou?r[-\s]driven\b/i],

  // ---- design ---------------------------------------------------------------
  ['Figma', /\bfigma\b/i],
  ['Sketch', /\bsketch\b(?=\s*(?:app|file|,|\/|\)))/i], // "sketch" the verb is everywhere
  ['Adobe XD', /\badobe\s*xd\b/i],
  ['Photoshop', /\bphotoshop\b/i],
  ['Illustrator', /\billustrator\b/i],
  ['InDesign', /\bindesign\b/i],
  ['After Effects', /\bafter\s+effects\b/i],
  ['Canva', /\bcanva\b/i],
  ['Miro', /\bmiro\b/i],
  ['Framer', /\bframer\b/i],

  // ---- business / ops tools -------------------------------------------------
  ['Git', /\bgit\b/i],
  ['GitHub', /\bgithub\b/i],
  ['GitLab', /\bgitlab\b/i],
  ['Bitbucket', /\bbitbucket\b/i],
  ['Jira', /\bjira\b/i],
  ['Confluence', /\bconfluence\b/i],
  ['Notion', /\bnotion\b(?!\s+of\b)/i],              // "notion of"
  ['Asana', /\basana\b/i],
  ['Trello', /\btrello\b/i],
  ['Slack', /\bslack\b(?!\s+(?:in|off)\b)/i],
  ['Salesforce', /\bsalesforce\b|\bsfdc\b/i],
  ['HubSpot', /\bhubspot\b/i],
  ['SAP', /\bSAP\b/],                                // case-sensitive: "sap" is an English word
  ['NetSuite', /\bnetsuite\b/i],
  ['ServiceNow', /\bservicenow\b/i],
  ['Zendesk', /\bzendesk\b/i],
  ['Workday', /\bworkday\s*(?:hcm|adaptive|financials|payroll|prism|extend)\b/i], // never bare "workday" ("during the workday")
  ['Shopify', /\bshopify\b/i],
  ['Magento', /\bmagento\b/i],
  ['WordPress', /\bwordpress\b/i],
  ['Drupal', /\bdrupal\b/i],
  ['Contentful', /\bcontentful\b/i],
  ['Webflow', /\bwebflow\b/i],
  ['Marketo', /\bmarketo\b/i],
  ['Google Analytics', /\bgoogle\s+analytics\b|\bga4\b/i],
  ['Google Ads', /\bgoogle\s+ads\b|\badwords\b/i],
  ['Mixpanel', /\bmixpanel\b/i],
  ['Amplitude', /\bamplitude\b/i],
  ['Braze', /\bbraze\b/i],
  ['Klaviyo', /\bklaviyo\b/i],
  ['Segment', /\bsegment\.com\b|\btwilio\s+segment\b/i], // "segment" alone is marketing prose
  ['Twilio', /\btwilio\b/i],
  ['Stripe', /\bstripe\b(?!\s*(?:pattern|of\b))/i],
  ['Excel', /\b(?:microsoft|ms)\s+excel\b|\bexcel\b(?!\s+(?:at|in|as|with)\b)/i], // "excel at", "excel in"
  ['PowerPoint', /\bpowerpoint\b/i],
  ['Google Sheets', /\bgoogle\s+sheets\b/i],
  ['Airtable', /\bairtable\b/i],
  ['Zapier', /\bzapier\b/i],
  ['QuickBooks', /\bquickbooks\b/i],
  ['Xero', /\bxero\b/i],
  ['AutoCAD', /\bautocad\b/i],
  ['SolidWorks', /\bsolidworks\b/i],
  ['Revit', /\brevit\b/i],

  // ---- practices ------------------------------------------------------------
  ['Agile', /\bagile\b/i],
  ['Scrum', /\bscrum\b/i],
  ['Kanban', /\bkanban\b/i],
  ['SAFe', /\bSAFe\b/],                              // case-sensitive: "safe" is an English word
  ['Lean', /\blean\s+(?:manufacturing|six\s+sigma|methodology|startup)\b/i],
  ['Six Sigma', /\bsix\s+sigma\b/i],
  ['ITIL', /\bitil\b/i],
  ['GDPR', /\bgdpr\b/i],
  ['SOC 2', /\bsoc\s*2\b/i],
  ['ISO 27001', /\biso\s*27001\b/i],
  ['Accessibility', /\bwcag\b|\ba11y\b/i],
  ['SEO', /\bseo\b/i],
  ['SEM', /\bsem\b/i],
  ['Blockchain', /\bblockchain\b|\bweb3\b/i],
  ['Embedded', /\bembedded\s+(?:systems?|software|linux|c\b)/i],
  ['IoT', /\biot\b|\binternet\s+of\s+things\b/i],
  ['CAD', /\bCAD\b/],
  ['Cybersecurity', /\bcyber\s?security\b|\binfosec\b|\bpenetration\s+testing\b|\bpentest/i],
];

/**
 * @param {string|null|undefined} text  job title, description, or both joined
 * @returns {string[]} canonical names, deduplicated, sorted case-insensitively.
 *   Always an array — `[]` means "nothing recognised", never "not looked at".
 */
export function extractTechnologies(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const found = new Set();
  for (const [name, re] of TECHNOLOGIES) if (re.test(text)) found.add(name);
  // Sorted case-insensitively so the array is stable across runs and reads
  // naturally in a dataset cell ('.NET' before 'Airflow' before 'AWS').
  return [...found].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** How many entries the dictionary carries — used by the tests as a guard. */
export const TECHNOLOGY_COUNT = TECHNOLOGIES.length;
