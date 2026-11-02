import importlib.util
import json
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('bridge',Path(__file__).resolve().parents[1]/'douk_bridge.py')
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
class BridgeTest(unittest.TestCase):
    def item(self):
        return {'aweme_id':'123','create_time':1793563200,'desc':'游戏CG','statistics':{'digg_count':0,'collect_count':0,'comment_count':20,'share_count':-1,'play_count':0},'author':{'uid':'456','nickname':'作者','sec_uid':'MS4wAAAB','cookie':'SECRET_NOT_FOR_OUTPUT'},'duration':1800}
    def test_zero_missing_and_unsupported_are_distinct(self):
        r=bridge.normalize_item(self.item())
        self.assertEqual(r['likes'],0)
        self.assertEqual(r['metrics']['favorites'],0)
        self.assertIsNone(r['metrics']['shares'])
        self.assertEqual(r['metricAvailability']['shares'],'missing')
        self.assertEqual(r['metricAvailability']['views'],'unsupported')
        self.assertEqual(r['durationSeconds'],1.8)
        self.assertEqual(r['author']['id'],'456')
        self.assertNotIn('SECRET_NOT_FOR_OUTPUT',json.dumps(r))
    def test_invalid_or_boolean_counts_are_not_zero(self):
        item=self.item();item['statistics']['digg_count']=True
        self.assertIsNone(bridge.normalize_item(item))
        item=self.item();item['statistics']['collect_count']=None
        self.assertIsNone(bridge.normalize_item(item)['metrics']['favorites'])
    def test_missing_author_is_not_an_invented_account(self):
        item=self.item();item['author']={}
        self.assertIsNone(bridge.normalize_item(item)['author'])
if __name__=='__main__':unittest.main()
