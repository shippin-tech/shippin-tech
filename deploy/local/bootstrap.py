"""Initialize the disposable local mail installation; keep credentials out of git."""
import base64
import json
import pathlib
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
env = dict(line.split('=', 1) for line in (HERE / '.env').read_text().splitlines() if '=' in line)
auth = 'Basic ' + base64.b64encode(env['LOCAL_RECOVERY_ADMIN'].encode()).decode()

def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request('http://127.0.0.1:28080' + path, data=data,
        headers={'Authorization': auth, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)

session = request('/jmap/session')
account = next(iter(session['accounts']))
result = request('/jmap', {'using': ['urn:ietf:params:jmap:core'],
    'methodCalls': [['x:Bootstrap/get', {'accountId': account}, 'b']]})
payload = result['methodResponses'][0][1]
if not payload.get('list'):
    raise SystemExit('Server is not in initial setup mode.')
patch = payload['list'][0]
patch.pop('id', None)
patch.update({
    'requestTlsCertificate': False, 'generateDkimKeys': False,
    'dataStore': {'@type': 'FoundationDb', 'clusterFile': '/var/fdb/fdb.cluster'},
    'blobStore': {'@type': 'S3', 'bucket': 'shippin-local',
        'region': {'@type': 'Custom', 'customEndpoint': 'http://minio:9000', 'customRegion': 'us-east-1'},
        'accessKey': {'@type': 'Value', 'value': env['LOCAL_S3_USER']},
        'secretKey': {'@type': 'Value', 'secret': env['LOCAL_S3_PASSWORD']}},
    'tracer': {'@type': 'Stdout', 'enable': True}
})
result = request('/jmap', {'using': ['urn:ietf:params:jmap:core'], 'methodCalls': [
    ['x:Bootstrap/set', {'accountId': account, 'update': {'singleton': patch}}, 'b']]})
payload = result['methodResponses'][0][1]
if 'singleton' not in payload.get('updated', {}):
    print(json.dumps(payload.get('notUpdated', payload)))
    raise SystemExit('Setup was not confirmed.')
credentials = payload['updated']['singleton']
(HERE / '.credentials.json').write_text(json.dumps(credentials, indent=2))
print('Initial setup completed; administrator credentials saved to deploy/local/.credentials.json')
