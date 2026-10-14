import argparse,json,subprocess,sys
from pathlib import Path
from policy import save
p=argparse.ArgumentParser();p.add_argument('--config',default='uk/config.json');p.add_argument('--out',default='results');a=p.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
try:
    with (out/'run.log').open('w') as log:
        proc=subprocess.run(['node','uk/fetch.mjs',a.config,a.out],stderr=log,timeout=600)
    raw=json.loads((out/'raw.json').read_text());boards=json.loads((out/'boards.json').read_text())
except Exception as e:
    print(json.dumps(save([],out,[str(e)])));sys.exit(2)
rows=[{'title':j.get('title'),'employer':j.get('companyName') or j.get('company'),'location':j.get('location'),'salary':j.get('compensation'),'posting_date':j.get('publishedAt'),'application_url':j.get('applyUrl') or j.get('url'),'vacancy_url':j.get('url'),'description':j.get('descriptionText'),'source':j.get('source')} for j in raw]
summary=save(rows,out,[b for b in boards['boards'] if not b['ok']]);print(json.dumps(summary,indent=2));sys.exit(proc.returncode)
