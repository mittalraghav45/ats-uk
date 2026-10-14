"""Conservative, explainable vacancy-level UK matching. Standard library only."""
import csv, hashlib, html, json, re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

STACK = {'JavaScript':r'\bjavascript\b','TypeScript':r'\btypescript\b','React':r'\breact(?:\.js)?\b','Node.js':r'\bnode(?:\.js|js)\b','PHP':r'\bphp\b','C#':r'\bc#','ASP.NET':r'\basp\.?net\b','Docker':r'\bdocker\b','Blazor':r'\bblazor\b','Python':r'\bpython\b','AI':r'\b(?:artificial intelligence|machine learning|llm|generative ai|ai engineer)\b'}
UK = r'\b(?:united kingdom|uk|great britain|england|scotland|wales|northern ireland|london|southampton|bristol|belfast|cardiff|edinburgh|glasgow|manchester|birmingham|leeds|cambridge|oxford|nottingham|newcastle|sheffield|liverpool|reading|bath|york|exeter|leicester|coventry|swansea|dundee|aberdeen|portsmouth)\b'
SENIOR = r'\b(?:senior|sr\.?|staff|principal|lead|head|director|manager|architect|III|IV|V|android|ios|mobile|intern|internship|apprentice|apprenticeship)\b'
ROLE = r'\b(?:software|developer|frontend|front.end|full.stack|backend|back.end|web engineer|ai engineer|machine learning engineer|application engineer)\b'
CLEAR = r'\b(?:security clear(?:ance|ed)|sc clear(?:ance|ed)|dv clear(?:ance|ed)|developed vetting|UK national(?:s)? only|British citizen(?:ship)? required)\b'

def clean(v):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', str(v or '')))).strip()

def sponsorship(text):
    sentences = re.split(r'(?<=[.!?])\s+|\n', text)
    evidence = [s.strip() for s in sentences if re.search(r'sponsor|skilled worker|certificate of sponsorship', s, re.I) and not re.search(r'educational sponsorship|export licen[cs]e|event sponsorship',s,re.I)]
    is_negative = lambda s: bool(re.search(r'(?:no|not|unable|cannot|can.t|do not|don.t).{0,65}(?:sponsor|skilled worker)|sponsorship.{0,35}(?:not available|unavailable|not offered)', s,re.I))
    neg = any(is_negative(s) for s in evidence)
    conditional = any(re.search(r'\b(?:may|might|subject to|eligible|eligibility|consider|considered|welcome|case.by.case|transfer|local candidates)\b',s,re.I) for s in evidence)
    pos = any(re.search(r'(?:offer|provide|available|support|welcome|sponsor).{0,70}(?:visa|sponsorship|skilled worker)|(?:visa sponsorship|skilled worker sponsorship).{0,35}(?:available|provided|offered)|(?:sponsorship|skilled worker).{0,120}(?:welcome|considered)',s,re.I) and not is_negative(s) for s in evidence)
    status = 'conflicting' if neg and pos and len(evidence)>1 else 'not_available' if neg else 'conditional' if conditional and pos else 'available' if pos else 'unknown'
    return status, evidence

def canonical(url):
    p=urlsplit(url or '')
    q=[(k,v) for k,v in parse_qsl(p.query) if not k.lower().startswith('utm_') and k not in ('source','ref','gh_src','trk')]
    return urlunsplit((p.scheme,p.netloc.lower(),p.path.rstrip('/'),urlencode(sorted(q)),''))

def evaluate(j):
    title=clean(j.get('title')); desc=clean(j.get('description')); loc=clean(j.get('location'))
    body=title+' '+desc
    reason = None
    if re.search(r'\b(?:New York|USA|United States|Canada|Australia|India|Singapore)\b',loc,re.I) and not re.search(r'\b(?:UK|United Kingdom)\b',loc,re.I): reason='non-UK location'
    elif not re.search(UK,loc,re.I): reason='UK location not evidenced'
    elif re.search(SENIOR,title,re.I): reason='excluded seniority or training role'
    elif not re.search(ROLE,title,re.I): reason='not a software role'
    elif re.search(CLEAR,desc,re.I): reason='clearance/nationality restriction mentioned; conservative exclusion'
    elif re.search(r'\b(?:[5-9]|1[0-9])\+?\s*years?\s+(?:of\s+)?(?:commercial|professional|relevant|software|development|industry)?\s*experience',desc,re.I): reason='experience requirement exceeds target'
    skills=[k for k,p in STACK.items() if re.search(p,body,re.I)]
    status,evidence=sponsorship(desc)
    # Score is a ranking heuristic, never a probability of hire or visa eligibility.
    score=min(100,35+sum(2 if k in ('Python','AI') else 4 if k in ('C#','ASP.NET','Blazor','Docker') else 7 for k in skills)+(10 if re.search(r'junior|associate|graduate',title,re.I) else 0)+(10 if status=='available' else 5 if status=='conditional' else 0))
    employer=clean(j.get('employer'))
    j['employer_sector']='university' if re.search(r'university|universities',employer,re.I) else 'NHS' if re.search(r'\bNHS\b|health board|healthcare trust|hospital.*trust',employer,re.I) else 'council' if re.search(r'council|borough|combined authority',employer,re.I) else 'DWP' if re.search(r'\bDWP\b|Department for Work',employer,re.I) else 'other'
    j['skill_experience_notes']={'C#':'portfolio/project','ASP.NET':'portfolio/project','Blazor':'portfolio/project','Docker':'portfolio/project','Python':'basic knowledge','AI':'learning'}
    j.update(title=title,location=loc,matching_score=score,matched_skills=skills,sponsorship_status=status,sponsorship_evidence=evidence,evidence_url=j.get('vacancy_url') or j.get('application_url'),description_available=bool(desc),review_required=True)
    j['id']=hashlib.sha256(canonical(j.get('application_url')).encode()).hexdigest()[:20]
    return j,reason

def save(rows,out,errors=None):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    kept=[];rejected=[];seen_url=set();seen_job=set();duplicates=0
    for row in rows:
        j,reason=evaluate(row)
        if reason: rejected.append({'title':j['title'],'reason':reason,'url':j.get('application_url')});continue
        url=canonical(j.get('application_url')); key=(clean(j.get('title')).lower(),clean(j.get('employer')).lower(),re.sub(r'[,;].*|\s+-\s+.*','',clean(j.get('location'))).lower())
        if not url: rejected.append({'title':j['title'],'reason':'missing application URL'});continue
        if url in seen_url or key in seen_job: duplicates+=1;continue
        seen_url.add(url);seen_job.add(key);kept.append(j)
    kept.sort(key=lambda j:(j['employer_sector']!='other',j['matching_score']),reverse=True)
    matched=kept
    kept=[j for j in matched if j['sponsorship_status'] in ('available','conditional')]
    review=[j for j in matched if j['sponsorship_status'] not in ('available','conditional')]
    now=datetime.now(timezone.utc).isoformat()
    summary={'timestamp':now,'raw_count':len(rows),'kept_count':len(kept),'matched_count':len(matched),'sponsorship_filtered_count':len(review),'rejected_count':len(rejected),'duplicate_count':duplicates,'errors':errors or [],'sponsorship_counts':{s:sum(j['sponsorship_status']==s for j in matched) for s in ('available','conditional','not_available','unknown','conflicting')}}
    for name,data in [('jobs.json',kept),('review.json',review),('summary.json',summary),('rejected.json',rejected)]:
        tmp=out/(name+'.tmp');tmp.write_text(json.dumps(data,indent=2,ensure_ascii=False,default=str));tmp.replace(out/name)
    fields=['title','employer','location','salary','posting_date','application_url','matching_score','sponsorship_status','sponsorship_evidence','evidence_url','matched_skills','source']
    with (out/'jobs.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader()
        for j in kept:
            vals={k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in j.items()}
            vals={k:("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for k,v in vals.items()};w.writerow(vals)
    return summary
