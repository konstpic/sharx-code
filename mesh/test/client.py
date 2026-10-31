"""Stdlib-only helpers; targets are fixed to the disposable local stand."""
import json,time,subprocess,http.cookiejar,urllib.request,urllib.error,sys
BASE='http://127.0.0.1:55253'
cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
def api(path,body=None):
 data=json.dumps(body).encode() if body is not None else None
 req=urllib.request.Request(BASE+path,data=data,headers={'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'})
 try:
  with client.open(req,timeout=25) as response:
   result=json.load(response)
 except urllib.error.HTTPError as e:
  result=json.load(e)
 if not result.get('success'):raise RuntimeError(result.get('msg','local test API failed'))
 return result.get('obj')
def sql(text):
 r=subprocess.run(['docker','exec','-i','sharx-mesh-test-db','psql','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','sharx_mesh_app'],input=text,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout

def dex(i,command,stdin=None,timeout=30):
 r=subprocess.run(['docker','exec','-i',f'sharx-mesh-test-n{i}','bash','-c',command],input=stdin,text=True,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError('test node command failed: '+r.stderr[-300:])
 return r.stdout

def state():return api('/panel/mesh/status')
def wait_job(result,timeout=240,expected_failure=False):
 job_id=result['job'];end=time.monotonic()+timeout
 while time.monotonic()<end:
  s=state();job=next((j for j in s.get('jobs',[]) if j['id']==job_id),None)
  if job and job['status']!='running':
   if expected_failure:
    assert job['status']=='failed',job
   elif job['status']!='done':raise RuntimeError('test job failed: '+str(job.get('error'))+'; steps '+str(job['steps']))
   print(job['title'],job['status'],flush=True);return job
  time.sleep(1)
 raise RuntimeError('test job timed out')
def action(name,body,**kwargs):return wait_job(api('/panel/mesh/action/'+name,body),**kwargs)
