import unittest,tempfile
from policy import evaluate,sponsorship,save
class PolicyTests(unittest.TestCase):
    def job(self,**kw):
        return dict(title='Software Developer',employer='Example',location='London, UK',description='React TypeScript Node.js',application_url='https://example.org/jobs/1',**kw)
    def test_positive(self):self.assertEqual(sponsorship('We offer visa sponsorship.')[0],'available')
    def test_negative(self):self.assertEqual(sponsorship('We cannot provide visa sponsorship.')[0],'not_available')
    def test_conditional(self):self.assertEqual(sponsorship('We may offer visa sponsorship subject to eligibility.')[0],'conditional')
    def test_register_not_evidence(self):self.assertEqual(sponsorship('We are a licensed sponsor.')[0],'unknown')
    def test_education(self):self.assertEqual(sponsorship('Educational Sponsorship subject to a qualifying period.')[0],'unknown')
    def test_transfer(self):self.assertEqual(sponsorship('For local candidates we support transfer of visa sponsorship.')[0],'conditional')
    def test_explicit_denial(self):self.assertEqual(sponsorship('Visa sponsorship is not available for this role. You must have another visa route.')[0],'not_available')
    def test_portfolio_and_learning(self):
        j=self.job();j['description']='C# ASP.NET Blazor Docker Python machine learning';r,_=evaluate(j);self.assertIn('Blazor',r['matched_skills']);self.assertEqual(r['skill_experience_notes']['Python'],'basic knowledge')
    def test_shortlist_evidence_required(self):
        j=self.job()
        with tempfile.TemporaryDirectory() as d:
            result=save([j],d);self.assertEqual(result['kept_count'],0);self.assertEqual(result['matched_count'],1)
    def test_shortlist_positive(self):
        j=self.job();j['description']='React. We offer visa sponsorship.'
        with tempfile.TemporaryDirectory() as d:self.assertEqual(save([j],d)['kept_count'],1)
    def test_nhs_wording(self):self.assertEqual(sponsorship('Applications from job seekers who require current Skilled Worker sponsorship to work in the UK are welcome and will be considered alongside all other applications.')[0],'conditional')
    def test_missing(self):self.assertEqual(sponsorship('')[0],'unknown')
    def test_senior(self):
        j=self.job();j['title']='Senior Software Engineer';self.assertIsNotNone(evaluate(j)[1])
    def test_intern(self):
        j=self.job();j['title']='Software Engineer Intern';self.assertIsNotNone(evaluate(j)[1])
    def test_clearance(self):
        j=self.job();j['description']='Must obtain SC clearance';self.assertIsNotNone(evaluate(j)[1])
    def test_non_uk(self):
        j=self.job();j['location']='New York';self.assertIsNotNone(evaluate(j)[1])
    def test_match(self):self.assertEqual(evaluate(self.job())[0]['matched_skills'],['TypeScript','React','Node.js'])
    def test_dedupe(self):
        a=self.job();b=self.job();b['application_url']+='?utm_source=test'
        with tempfile.TemporaryDirectory() as d:self.assertEqual(save([a,b],d)['duplicate_count'],1)
    def test_empty(self):
        with tempfile.TemporaryDirectory() as d:self.assertEqual(save([],d)['kept_count'],0)
if __name__=='__main__':unittest.main()
