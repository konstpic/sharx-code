"""Verify nine real nodes in the retained, loopback-only Docker stand.
Restarts n9 after clearing only its mesh routes to exercise joining an existing etcd.
Never point these helpers at production; host/container targets are fixed in client.py.
"""
import json,time
import client as h
h.api('/login',{'username':'admin','password':'admin'})
assert len(h.state().get('enrolled',{}))==9,'Expected the retained nine-node stand'
previous=json.loads(h.dex(9,'cat /run/sharx-mesh/status.json'))['ts']
h.dex(9,'systemctl stop sharx-mesh-agent')
try:
 for i in range(1,9):h.dex(9,f'ip route del 10.203.0.{i}/32 metric 50 2>/dev/null || true')
finally:h.dex(9,'systemctl start sharx-mesh-agent')
for _ in range(45):
 report=json.loads(h.dex(9,'cat /run/sharx-mesh/status.json'))
 if report['ts']>previous and len(report['links'])==8:break
 time.sleep(1)
else:raise RuntimeError('n9 did not establish routes and publish after cold join')
print('Cold join to existing etcd passed: direct routes seeded before discovery',flush=True)
def https(i,target):
 result=json.loads(h.dex(i,f'curl -ksS --max-time 8 --resolve mesh.test:9443:10.203.0.{target} https://mesh.test:9443/'))
 assert result['node']==f'mesh-test-n{target}',result
for i in range(5,10):https(i,3)
for target in (5,6,7,8,9):https(1,target)
https(5,9)
print('Real HTTPS from and to all five added nodes passed',flush=True)
for _ in range(40):
 s=h.state();top=s.get('topology',{}).get('nodes',[])
 good=sum(1 for links in s['overlay']['obs'].values() for link in links.values() if link.get('ok'))
 if len(top)==9 and all(n['agent_age'] is not None and n['agent_age']<45 for n in top) and good==72:break
 time.sleep(2)
else:raise RuntimeError('Nine fresh agents / 36 bidirectional links did not converge')
assert s['quorum']['healthy']==3 and s['quorum']['size']==3
assert sum(n['role']=='entry' for n in s['enrolled'].values())==2
print('9/9 agents, 36/36 bidirectional links, 2 entries / 7 exits, etcd 3/3',flush=True)
