"""Real Docker-only mesh stand. Retains all test containers and named volumes.
Only touches sharx-mesh-docker-* and the dedicated sharx_mesh_docker database.
Requires the local candidate images and /tmp/sharx-docker-https-fixture.
"""
import base64, hashlib, hmac, http.cookiejar, json, os, secrets, subprocess, time, urllib.request, urllib.error
BASE='http://127.0.0.1:55254'
PREFIX='sharx-mesh-docker-'

def docker(*args,stdin=None,env=None,check=True):
 r=subprocess.run(['docker',*args],input=stdin,text=True,capture_output=True,env=env)
 if check and r.returncode:raise RuntimeError('Test Docker operation failed: '+r.stderr[-400:])
 return r

def sql(query):
 r=docker('exec','-i','sharx-mesh-test-db','psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','sharx_mesh_docker',stdin=query,check=False)
 if r.returncode:raise RuntimeError('Disposable-stand SQL failed: '+next((x for x in r.stderr.splitlines() if x.startswith('ERROR:')), 'details withheld'))
 return r.stdout.strip()

class Panel:
 def __init__(self):self.client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def api(self,path,body=None,allow=False):
  req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'})
  try:
   with self.client.open(req,timeout=100) as r:d=json.load(r)
  except urllib.error.HTTPError as e:
   if allow:return e.code
   raise RuntimeError('Panel API HTTP '+str(e.code)+' on '+path) from None
  if not d.get('success'):raise RuntimeError(path+': '+str(d.get('msg')))
  return d.get('obj')
 def login(self):
  for _ in range(40):
   try:self.api('/login',{'username':'admin','password':os.environ.get('MESH_TEST_ADMIN_PASSWORD','admin')});return
   except (OSError,RuntimeError):time.sleep(1)
  raise RuntimeError('Test panel login unavailable')
 def state(self):return self.api('/panel/mesh/status')
 def action(self,name,body):
  result=self.api('/panel/mesh/action/'+name,body);end=time.monotonic()+240
  while time.monotonic()<end:
   job=next((x for x in self.state().get('jobs',[]) if x['id']==result['job']),None)
   if job and job['status']!='running':
    if job['status']!='done':raise RuntimeError(name+': '+str(job.get('error')))
    print(name,'passed',flush=True);return
   time.sleep(.5)
  raise RuntimeError('Mesh action timed out: '+name)

def wait_mesh(panel,count=4,quorum=3):
 for _ in range(80):
  s=panel.state();top=s.get('topology',{}).get('nodes',[])
  healthy=sum(1 for links in s.get('overlay',{}).get('obs',{}).values() for link in links.values() if link.get('ok'))
  if len(top)==count and all(n['agent_age'] is not None and n['agent_age']<50 for n in top) and healthy==count*(count-1) and s['quorum']['healthy']==quorum and s['quorum']['size']==quorum:return s
  time.sleep(2)
 raise RuntimeError('Container mesh did not converge')

def https(source,target,port=9443):
 out=docker('exec',PREFIX+source,'wget','--no-check-certificate','-qO-','-T','8',f'https://{target}:{port}/').stdout
 return json.loads(out)

def jwt(secret):
 b64=lambda v:base64.urlsafe_b64encode(v).decode().rstrip('=')
 head=b64(b'{"alg":"HS256","typ":"JWT"}')
 claims=b64(json.dumps({'iss':'sharx-panel','aud':'sharx-node','iat':int(time.time()),'exp':int(time.time())+180}).encode())
 data=head+'.'+claims
 return data+'.'+b64(hmac.new(secret.encode(),data.encode(),hashlib.sha256).digest())

def agent_call(name,secret,operation,data=None):
 env=dict(os.environ,MESH_TEST_JWT=jwt(secret))
 out=docker('exec','-i','-e','MESH_TEST_JWT',PREFIX+name,'sh','-c','wget -qO- --header="Authorization: Bearer $MESH_TEST_JWT" --header="Content-Type: application/json" --post-file=/dev/stdin http://127.0.0.1:8080/api/v1/mesh',stdin=json.dumps({'operation':operation,'data':data}),env=env).stdout
 return json.loads(out)

def participant_args(name,secret):
 is_bal=name=='b1';ip='172.30.204.'+('21' if is_bal else str(10+int(name[1:])))
 image='sharx-balancer-mesh-embedded:local' if is_bal else 'sharx-node-mesh-embedded:local'
 args=['run','-d','--name',PREFIX+name,'--hostname','docker-mesh-'+name,'--restart','unless-stopped','--network','sharx-mesh-docker-net','--ip',ip,'--cap-add','NET_ADMIN','--cap-add','NET_RAW','--device','/dev/net/tun:/dev/net/tun','-v',PREFIX+name+'-data:/app/data','-e','SECRET_KEY']
 if name=='n3':args+=['-e','SHARX_MESH_FORCE_USERSPACE=1']
 if not is_bal:
  args+=['-v','/tmp/sharx-docker-https-fixture:/opt/test/mesh-https:ro','--entrypoint','sh']
  return args+[image,'-c','/opt/test/mesh-https & exec /app/docker-entrypoint.sh ./node-service -port 8080']
 return args+[image]

def main():
 secret=secrets.token_hex(64) # Test credential remains in memory, Docker env and test DB only.
 p=Panel();p.login()
 if not sql("SELECT count(*) FROM nodes;").strip() or sql("SELECT count(*) FROM nodes;")=='0':
  assert p.api('/panel/mesh/status',allow=True)==409,'Standalone panel unexpectedly accepts mesh'
  docker('exec',PREFIX+'panel','test','!','-d','/etc/x-ui/mesh')
 fields=['ca_cert_pem','ca_key_pem','node_cert_pem','node_key_pem','panel_client_cert_pem','panel_client_key_pem','jwt_private_key_pem','jwt_public_key_pem']
 sql("INSERT INTO panel_pairing(id,secret_key,auth_secret,"+','.join(fields)+",created_at,updated_at) VALUES (1,'"+secret+"','"+secret+"',"+','.join("''" for _ in fields)+",0,0) ON CONFLICT(id) DO UPDATE SET secret_key=excluded.secret_key,auth_secret=excluded.auth_secret; INSERT INTO settings(key,value) VALUES ('multiNodeMode','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value;")
 docker('restart',PREFIX+'panel');p.login()
 env=dict(os.environ,SECRET_KEY=secret)
 for name in ('n1','n2','n3','b1'):
  docker('rm','-f',PREFIX+name,check=False) # Named volumes preserve enrollment and etcd across recreation.
  docker(*participant_args(name,secret),env=env)
  for _ in range(120):
   r=docker('exec',PREFIX+name,'wget','-qO-','http://127.0.0.1:8080/health',check=False)
   if r.returncode==0 and json.loads(r.stdout).get('meshEmbedded'):break
   time.sleep(1)
  else:raise RuntimeError('Embedded API unavailable: '+name)
  unauthorized=docker('exec',PREFIX+name,'wget','-S','-O-','--post-data={"operation":"status"}','http://127.0.0.1:8080/api/v1/mesh',check=False)
  assert unauthorized.returncode and '401' in unauthorized.stderr,'Mesh API lacks auth'
  if not agent_call(name,secret,'status')['enabled']:docker('exec',PREFIX+name,'test','!','-d','/app/data/mesh')
 print('Images start with mesh disabled; authenticated APIs and no host services verified',flush=True)
 nodes=p.api('/panel/node/list') or []
 for i in (1,2,3):
  if not any(n['id']==i for n in nodes):p.api('/panel/node/add',{'name':'Docker node '+str(i),'address':f'http://172.30.204.{10+i}:8080','enable':True})
 if not p.api('/panel/balancer/list'):p.api('/panel/balancer/add',{'name':'Docker balancer','address':'172.30.204.21','apiAddress':'http://172.30.204.21:8080','engine':'haproxy','enable':True})
 p.api('/panel/mesh/settings',{'enabled':True,'relay_address':'172.30.204.11','probe_ports':[9443],'sni':'mesh.test','balancer_uuid':'','interval':15})
 for _ in range(30):
  if p.state().get('running'):break
  time.sleep(1)
 for i in (1,2,3):p.action('enroll',{'nodeId':i,'kind':'node','role':'entry' if i==1 else 'exit','transport':'embedded'})
 p.action('enroll',{'nodeId':1,'kind':'balancer','role':'entry','transport':'embedded'})
 s=p.state()
 if s.get('bootstrap_pending') or not s.get('quorum',{}).get('size'):p.action('bootstrap',{'names':['n1','n2','n3']})
 wait_mesh(p)
 print('Four embedded agents and three in-process mTLS etcd members healthy',flush=True)
 time.sleep(1)
 for source in ('n1','b1','n3'):assert https(source,'10.203.0.2')['node']=='docker-mesh-n2'
 assert docker('exec',PREFIX+'n3','pgrep','-x','wireguard-go').stdout.strip(),'Userspace fallback did not run'
 print('Real HTTPS passes through kernel/userspace WireGuard and balancer networking',flush=True)
 # IPv6 loopback inbound keeps the real worker Xray separate from the IPv4 HTTPS fixture.
 inbound=sql("INSERT INTO inbounds(user_id,remark,enable,listen,port,protocol,settings,stream_settings,tag,sniffing) VALUES (1,'Docker mesh HTTPS fixture',true,'::1',9443,'vless','{\"clients\":[],\"decryption\":\"none\"}','{\"network\":\"tcp\",\"security\":\"none\"}','docker-mesh-fixture','{\"enabled\":false}') ON CONFLICT(tag) DO UPDATE SET enable=true RETURNING id;")
 for i in (1,2,3):sql(f"INSERT INTO inbound_node_mappings(inbound_id,node_id,include_in_subscription) VALUES ({inbound},{i},true) ON CONFLICT(inbound_id,node_id) DO NOTHING;")
 sql(f"INSERT INTO hosts(user_id,name,address,port,enable,customized,kind,node_id,inbound_id) SELECT 1, 'Docker mesh n2','172.30.204.12',0,true,false,'placement',2,{inbound} WHERE NOT EXISTS(SELECT 1 FROM hosts WHERE node_id=2 AND inbound_id={inbound} AND kind='placement');")
 pool=sql(f"INSERT INTO balancer_pools(balancer_id,inbound_id,listen_port,auto_members,enable) VALUES (1,{inbound},9444,false,true) ON CONFLICT(balancer_id,inbound_id) DO UPDATE SET listen_port=9444 RETURNING id;")
 sql(f"INSERT INTO balancer_pool_members(pool_id,node_id,enable) VALUES ({pool},2,true) ON CONFLICT(pool_id,node_id) DO NOTHING;")
 p.api('/panel/balancer/apply/1',{})
 assert https('n1','172.30.204.21',9444)['node']=='docker-mesh-n2'
 saved=json.loads(docker('exec',PREFIX+'b1','cat','/app/data/spec.json').stdout)
 assert '10.203.0.2' in json.dumps(saved),'Balancer backend did not use overlay'
 print('Real HAProxy forwards HTTPS to the worker overlay address',flush=True)
 # Real packet loss: both directions of b1/n2's direct underlay are blocked.
 pairs=(('b1','172.30.204.12','53004'),('n2','172.30.204.21','53002'))
 for name,target,port in pairs:docker('exec',PREFIX+name,'iptables','-I','OUTPUT','1','-d',target,'-p','udp','--dport',port,'-j','DROP')
 try:
  for _ in range(45):
   report=json.loads(docker('exec',PREFIX+'b1','cat','/app/data/mesh/status.json').stdout)
   if report.get('via',{}).get('n2'):break
   time.sleep(2)
  else:raise RuntimeError('Balancer did not select transit')
  for _ in range(15):
   try:
    assert https('n1','172.30.204.21',9444)['node']=='docker-mesh-n2'
    break
   except RuntimeError:time.sleep(1)
  else:raise RuntimeError('HAProxy backend did not recover after mesh transit selection')
  print('HAProxy traffic recovers through transit after direct link failure and health-check convergence',flush=True)
 finally:
  for name,target,port in pairs:docker('exec',PREFIX+name,'iptables','-D','OUTPUT','-d',target,'-p','udp','--dport',port,'-j','DROP')
 wait_mesh(p)
 p.action('relay',{'exit':'n2','mode':'relay'})
 assert https('n3','172.30.204.11',55000)['node']=='docker-mesh-n2'
 p.action('relay',{'exit':'n2','mode':'direct'})
 print('Embedded forwarding and subscription-host restoration passed',flush=True)
 p.action('etcd',{'name':'b1','member':True});wait_mesh(p,quorum=4)
 p.action('etcd',{'name':'b1','member':False});wait_mesh(p)
 print('Balancer learner promotion and removal preserve the original three-member quorum',flush=True)
 for name in ('n1','n2','n3'):docker('exec',PREFIX+name,'pkill','-STOP','-x','etcd')
 try:
  time.sleep(10);assert https('n1','172.30.204.21',9444)['node']=='docker-mesh-n2'
  print('HAProxy HTTPS survives loss of all etcd processes while agents keep running',flush=True)
 finally:
  for name in ('n1','n2','n3'):docker('exec',PREFIX+name,'pkill','-CONT','-x','etcd')
 wait_mesh(p)
 before=json.loads(docker('exec',PREFIX+'n2','cat','/app/data/mesh/nodes.json').stdout)['n2']['pubkey']
 docker('rm','-f',PREFIX+'n2');docker(*participant_args('n2',secret),env=env)
 time.sleep(2)
 wait_mesh(p)
 after=json.loads(docker('exec',PREFIX+'n2','cat','/app/data/mesh/nodes.json').stdout)['n2']['pubkey']
 assert before==after;assert https('n1','172.30.204.21',9444)['node']=='docker-mesh-n2'
 print('Worker container recreation preserves mesh identity and etcd data without reinstall',flush=True)
 docker('stop',PREFIX+'panel')
 try:assert https('n3','172.30.204.21',9444)['node']=='docker-mesh-n2'
 finally:docker('start',PREFIX+'panel')
 p.login();wait_mesh(p)
 print('Panel outage does not interrupt mesh/HAProxy traffic',flush=True)
 print('PASS: fully Docker stand retained at '+BASE+'/panel/nodes/mesh/',flush=True)

if __name__=='__main__':main()
