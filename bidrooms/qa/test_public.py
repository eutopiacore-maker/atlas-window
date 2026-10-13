import json
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class PublicIntegrity(unittest.TestCase):
    def test_three_separate_real_case_profiles(self):
        cases=[json.loads((ROOT/'data/rooms'/f'{x}.json').read_text()) for x in ['acp-215004','panama-mupa-268','unops-61896']]
        self.assertEqual({x['regime'] for x in cases},{'acp','panama-ley22','unops'})
        self.assertEqual(len({x['id'] for x in cases}),3)
        self.assertTrue(all(x['analysis']['corpus_complete'] is False for x in cases))
    def test_no_false_full_validation(self):
        for path in (ROOT/'data/rooms').glob('*.json'):
            case=json.loads(path.read_text())
            if 'analysis' in case:self.assertGreater(case['analysis']['documents_expected'],case['analysis']['documents_processed'])
    def test_sources_and_recorded_hashes(self):
        for path in (ROOT/'data/rooms').glob('*.json'):
            for doc in json.loads(path.read_text())['documents']:
                if doc.get('url'):self.assertTrue(doc['url'].startswith('https://'))
                if doc.get('sha256'):self.assertRegex(doc['sha256'],r'^[a-f0-9]{64}$')
    def test_identity_not_collected_or_transmitted(self):
        for path in ROOT.rglob('index.html'):self.assertNotIn('name="id"',path.read_text())
        self.assertNotIn('government_id',(ROOT/'assets/app.js').read_text())
        self.assertNotIn('Cédula/ID:',(ROOT/'assets/app.js').read_text())
    def test_legacy_data_and_route_preserved(self):
        self.assertTrue((ROOT/'acp-215164/index.html').exists())
        case=json.loads((ROOT/'data/rooms/acp-215164.json').read_text())
        self.assertEqual(case['item']['quantity'],216)
if __name__=='__main__':unittest.main()
