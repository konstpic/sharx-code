"""Destructive network fault tests confined to the retained disposable stand.
Run: python3 mesh/test/e2e.py. Restores injected packet loss and etcd pause.
"""
import json,time,subprocess
import client as h
h.api('/login',{'username':'admin','password':'admin'})
def action(name,body,fail=False):
 result=h.api('/panel/mesh/action/'+name,body);end=time.monotonic()+150
 while time.monotonic()<end:
  job=next((x for x in h.state().get('jobs',[]) if x['id']==result['job']),None)
  if job and job['status']!='running':
   assert job['status']==('failed' if fail else 'done'),job
   print(name,job['status'],job.get('error',''),flush=True);return job
  time.sleep(.5)
 raise RuntimeError('job timed out')
def curl(node,ip,port=9443):
 return json.loads(h.dex(node,f'curl -ksS --max-time 6 --resolve mesh.test:{port}:{ip} https://mesh.test:{port}/'))
# Real HTTPS payload through direct overlay, then loss of one underlay pair.
for i in (1,2,4):assert curl(i,'10.203.0.3')['node']=='mesh-test-n3'
print('HTTPS payload through native overlay passed',flush=True)
for i,j in ((2,3),(3,2)):
 h.dex(i,f'iptables -I OUTPUT 1 -d 172.30.203.{10+j} -p udp --dport {53000+i} -j DROP')
try:
 for _ in range(40):
  status=json.loads(h.dex(2,'cat /run/sharx-mesh/status.json'))
  if status['via'].get('n3'):break
  time.sleep(2)
 else:raise RuntimeError('agent did not choose transit')
 assert curl(2,'10.203.0.3')['node']=='mesh-test-n3'
 print('broken n2/n3 direct link → transit '+status['via']['n3']+'; HTTPS payload passed',flush=True)
finally:
 for i,j in ((2,3),(3,2)):h.dex(i,f'iptables -D OUTPUT -d 172.30.203.{10+j} -p udp --dport {53000+i} -j DROP')
for _ in range(30):
 status=json.loads(h.dex(2,'cat /run/sharx-mesh/status.json'))
 if 'n3' not in status['via']:break
 time.sleep(2)
else:raise RuntimeError('direct path did not recover')
print('direct path recovery passed',flush=True)
# Enable relay: durable host rewrite plus real forwarded HTTPS.
action('relay',{'exit':'n2','mode':'relay'})
rows=h.sql('SELECT address,port,customized FROM hosts WHERE id=2;');assert '172.30.203.11' in rows and '55000' in rows,rows
assert curl(4,'172.30.203.11',55000)['node']=='mesh-test-n2'
print('relay DNAT and placement-host rewrite passed',flush=True)
# A manual edit must block restoration and retain the journal; repair then retry.
h.sql("UPDATE hosts SET address='manual.invalid' WHERE id=2;")
action('relay',{'exit':'n2','mode':'direct'},fail=True)
assert 'manual.invalid' in h.sql('SELECT address FROM hosts WHERE id=2;')
assert h.state()['relays']['n2']['pending']
h.sql("UPDATE hosts SET address='172.30.203.11',enable=false WHERE id=2;")
action('relay',{'exit':'n2','mode':'direct'})
rows=h.sql('SELECT address,port,customized,enable FROM hosts WHERE id=2;');assert '172.30.203.12' in rows,rows
assert '|    0 | f' in rows,rows
assert not h.state()['relays']['n2']['on'] and not h.state()['relays']['n2']['pending']
h.sql('UPDATE hosts SET enable=true WHERE id=2;')
print('manual conflict retained; disabled host restored with inherited port and customization',flush=True)
# Quorum loss: cached graph + direct measurement must keep traffic working.
for i in (1,2,3):h.dex(i,'docker pause sharx-mesh-etcd >/dev/null')
try:
 time.sleep(10)
 assert curl(2,'10.203.0.3')['node']=='mesh-test-n3'
 print('HTTPS works during etcd outage',flush=True)
finally:
 for i in (1,2,3):h.dex(i,'docker unpause sharx-mesh-etcd >/dev/null')
print('native network/relay/recovery suite passed',flush=True)
