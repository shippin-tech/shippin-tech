"""End-to-end check of the self-service free plan against the local Docker stack.

Signs up a fresh domain, signs in as its owner, exercises mailboxes, aliases,
passwords and plan limits, tries to reach outside the domain, delivers mail to
an alias over SMTP and reads it back through JMAP. Removes everything it made.
Run from the repository root: py -3.11 deploy/local/verify_panel.py
"""
import base64
import json
import pathlib
import secrets
import smtplib
import time
import urllib.error
import urllib.request
from email.message import EmailMessage

BASE = 'http://127.0.0.1:28080'
HERE = pathlib.Path(__file__).resolve().parent
admin = json.loads((HERE / '.credentials.json').read_text())
RUN = secrets.token_hex(3)
DOMAIN = f'free-{RUN}.test'
PASSWORD = 'Free plan check ' + secrets.token_hex(6)
checks = 0


def basic(user, password):
    return 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()


ADMIN = basic(admin['username'], admin['secret'])


def call(method, path, body=None, auth=None):
    headers = {'Accept': 'application/json'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if auth:
        headers['Authorization'] = auth
    req = urllib.request.Request(BASE + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, json.loads(res.read() or b'{}')
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw or b'{}')
        except json.JSONDecodeError:
            return err.code, {'raw': raw.decode(errors='replace')}


def expect(label, condition, detail=''):
    global checks
    if not condition:
        raise SystemExit(f'FAIL {label} {detail}')
    checks += 1
    print(f'ok   {label}')


def jmap(auth, calls, using=('urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap')):
    status, body = call('POST', '/jmap', {'using': list(using), 'methodCalls': calls}, auth)
    assert status == 200, (status, body)
    return body['methodResponses']


def remove_domain(ids):
    """DKIM keys are created with the domain and block deleting it, so they go first."""
    if not ids:
        return
    keys = jmap(ADMIN, [['x:DkimSignature/query', {}, 'q'],
                        ['x:DkimSignature/get', {'#ids': {'resultOf': 'q', 'name': 'x:DkimSignature/query', 'path': '/ids'}, 'properties': ['id', 'domainId']}, 'g']])[1][1].get('list', [])
    doomed = [k['id'] for k in keys if k.get('domainId') in ids]
    if doomed:
        jmap(ADMIN, [['x:DkimSignature/set', {'destroy': doomed}, 'k']])
    result = jmap(ADMIN, [['x:Domain/set', {'destroy': ids}, 'd']])[0][1]
    assert set(result.get('destroyed', [])) == set(ids), result


# Plan is public and open on the local stack
status, plan = call('GET', '/api/panel/plan')
expect('plan is public', status == 200, plan)
expect('local plan is open with DNS proof off', plan.get('signup') == 'open' and plan.get('dnsProof') is False, plan)

# Bad input is refused before anything is created
status, body = call('POST', '/api/panel/signup/code', {'domain': 'bad domain.com'})
expect('invalid domain refused', status == 400 and body.get('error') == 'invalidDomain', (status, body))

status, body = call('POST', '/api/panel/signup/code', {'domain': DOMAIN.upper() + '.'})
expect('verification record issued', status == 200 and body['record']['name'] == f'_shippin-verify.{DOMAIN}', body)
expect('record value is server-derived', body['record']['value'].startswith('shippin-verify=') and len(body['record']['value']) == 47, body)

status, body = call('POST', '/api/panel/signup', {'domain': DOMAIN, 'name': 'owner', 'password': 'short'})
expect('weak password refused', status == 400 and body.get('error') == 'weakPassword', (status, body))

status, body = call('POST', '/api/panel/signup', {'domain': DOMAIN, 'name': 'owner', 'password': PASSWORD})
expect('signup creates the owner', status == 200 and body.get('email') == f'owner@{DOMAIN}', (status, body))
OWNER = basic(f'owner@{DOMAIN}', PASSWORD)

status, body = call('POST', '/api/panel/signup', {'domain': DOMAIN, 'name': 'again', 'password': PASSWORD})
expect('same domain cannot be claimed twice', status == 409 and body.get('error') == 'domainTaken', (status, body))

# Owner signs in and sees their domain
status, view = call('GET', '/api/panel/domain', auth=OWNER)
expect('owner reaches the panel', status == 200 and view.get('domain') == DOMAIN, (status, view))
expect('usage counts the owner mailbox', view['usage']['mailboxes'] == 1, view.get('usage'))
expect('DNS records include MX and SPF', ' IN MX ' in view['dnsZone'] and 'v=spf1' in view['dnsZone'], view['dnsZone'][:300])
status, dns = call('GET', '/api/panel/dns', auth=OWNER)
kinds = sorted({r['kind'] for r in dns.get('records', [])})
expect('live DNS check covers MX, SPF, DKIM and DMARC', status == 200 and kinds == ['DKIM', 'DMARC', 'MX', 'SPF'], (status, dns))
# .test domains have no public DNS, so nothing can be published yet.
expect('unpublished records are reported missing', all(r['state'] == 'missing' for r in dns['records']), dns['records'])

# Mailboxes up to the plan limit
limit = view['plan']['mailboxes']
made = []
for index in range(1, limit):
    status, body = call('POST', '/api/panel/mailboxes', {'name': f'user{index}', 'password': PASSWORD}, OWNER)
    expect(f'mailbox {index + 1} of {limit} created', status == 200, (status, body))
    made.append(body['id'])
status, body = call('POST', '/api/panel/mailboxes', {'name': 'one-too-many', 'password': PASSWORD}, OWNER)
expect('mailbox limit enforced', status == 403 and body.get('error') == 'planLimit', (status, body))

status, body = call('GET', '/api/panel/mailboxes', auth=OWNER)
boxes = {m['name']: m for m in body['mailboxes']}
expect('list shows every mailbox', set(boxes) == {'owner', *[f'user{i}' for i in range(1, limit)]}, list(boxes))
expect('owner is marked and quota applied', boxes['owner']['owner'] and boxes['user1']['quotaBytes'] == plan['mailboxMb'] * 1024 * 1024, boxes['owner'])

# Aliases up to the plan limit, then delivery to one of them
user1 = boxes['user1']['id']
alias_limit = plan['aliases']
for index in range(alias_limit):
    status, body = call('POST', f'/api/panel/mailboxes/{user1}/aliases', {'alias': f'alias{index}'}, OWNER)
    expect(f'alias {index + 1} of {alias_limit} added', status == 200, (status, body))
status, body = call('POST', f'/api/panel/mailboxes/{user1}/aliases', {'alias': 'over'}, OWNER)
expect('alias limit enforced', status == 403 and body.get('error') == 'planLimit', (status, body))
status, body = call('DELETE', f'/api/panel/mailboxes/{user1}/aliases/alias{alias_limit - 1}', auth=OWNER)
expect('alias removed', status == 200, (status, body))
# With a slot free again, a clash must be refused for the clash itself, not the limit.
status, body = call('POST', f'/api/panel/mailboxes/{boxes["owner"]["id"]}/aliases', {'alias': 'user1'}, OWNER)
expect('alias cannot take another mailbox address', status in (400, 409) and body.get('error') != 'planLimit', (status, body))
status, body = call('POST', f'/api/panel/mailboxes/{boxes["user2"]["id"]}/aliases', {'alias': 'alias0'}, OWNER)
expect('alias cannot take another alias', status in (400, 409) and body.get('error') != 'planLimit', (status, body))

marker = f'Free plan alias delivery {RUN}'
message = EmailMessage()
message['From'] = admin['username']
message['To'] = f'alias0@{DOMAIN}'
message['Subject'] = marker
message.set_content(marker)
with smtplib.SMTP('127.0.0.1', 21025, timeout=30) as smtp:
    smtp.send_message(message)
USER1 = basic(f'user1@{DOMAIN}', PASSWORD)
status, session = call('GET', '/jmap/session', auth=USER1)
expect('new mailbox can sign in', status == 200, status)
account = session['primaryAccounts']['urn:ietf:params:jmap:mail']
for _ in range(30):
    found = jmap(USER1, [['Email/query', {'accountId': account, 'filter': {'subject': marker}}, 'q']],
                 using=('urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'))[0][1].get('ids')
    if found:
        break
    time.sleep(2)
expect('mail to an alias arrives in the mailbox', bool(found))

# Catch-all: unknown addresses go to a chosen mailbox, or bounce
status, body = call('POST', '/api/panel/domain/catchall', {'mailbox': 'nobody-here'}, OWNER)
expect('catch-all refuses a mailbox outside the domain', status == 400 and body.get('error') == 'unknownMailbox', (status, body))
status, body = call('POST', '/api/panel/domain/catchall', {'mailbox': 'user1'}, OWNER)
expect('catch-all set to a mailbox', status == 200 and body.get('catchAll') == f'user1@{DOMAIN}', (status, body))
expect('domain view shows the catch-all', call('GET', '/api/panel/domain', auth=OWNER)[1].get('catchAll') == f'user1@{DOMAIN}')
stray = f'Catch-all delivery {RUN}'
message = EmailMessage()
message['From'] = admin['username']
message['To'] = f'made-up-{RUN}@{DOMAIN}'
message['Subject'] = stray
message.set_content(stray)
with smtplib.SMTP('127.0.0.1', 21025, timeout=30) as smtp:
    smtp.send_message(message)
for _ in range(30):
    found = jmap(USER1, [['Email/query', {'accountId': account, 'filter': {'subject': stray}}, 'q']],
                 using=('urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'))[0][1].get('ids')
    if found:
        break
    time.sleep(2)
expect('mail to an unknown address reaches the catch-all mailbox', bool(found))
status, body = call('POST', '/api/panel/domain/catchall', {'mailbox': ''}, OWNER)
expect('catch-all switched off', status == 200 and body.get('catchAll') is None, (status, body))

# Password reset takes effect
NEW = 'Rotated password ' + secrets.token_hex(6)
status, body = call('POST', f'/api/panel/mailboxes/{user1}/password', {'password': NEW}, OWNER)
expect('owner resets a mailbox password', status == 200, (status, body))
expect('old password stops working', call('GET', '/jmap/session', auth=USER1)[0] == 401)
expect('new password works', call('GET', '/jmap/session', auth=basic(f'user1@{DOMAIN}', NEW))[0] == 200)

# Isolation: plain mailboxes and other domains are out of reach
status, body = call('GET', '/api/panel/domain', auth=basic(f'user1@{DOMAIN}', NEW))
expect('a plain mailbox is not an owner', status == 403 and body.get('error') == 'notOwner', (status, body))
admin_id = jmap(ADMIN, [['x:Account/query', {'filter': {}}, 'q']])[0][1]['ids']
outside = [i for i in admin_id if i not in {m['id'] for m in boxes.values()}]
if outside:
    status, _ = call('POST', f'/api/panel/mailboxes/{outside[0]}/password', {'password': NEW}, OWNER)
    expect('owner cannot touch accounts in other domains', status == 404, status)
    status, _ = call('DELETE', f'/api/panel/mailboxes/{outside[0]}', auth=OWNER)
    expect('owner cannot delete accounts in other domains', status == 404, status)
status, body = call('DELETE', f'/api/panel/mailboxes/{boxes["owner"]["id"]}', auth=OWNER)
expect('owner mailbox cannot be deleted', status == 403, (status, body))
status, body = call('POST', '/jmap', {'using': ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'],
                                      'methodCalls': [['x:Domain/set', {'create': {'d': {'name': f'sneak-{RUN}.test'}}}, 'd']]}, OWNER)
denied = status != 200 or 'created' not in json.dumps(body['methodResponses'][0][1]) or 'notCreated' in json.dumps(body)
expect('owner gets no direct admin rights', denied, body)

# The free plan sending cap exists and only counts signed-in senders
throttles = jmap(ADMIN, [['x:MtaInboundThrottle/query', {}, 'q'],
                         ['x:MtaInboundThrottle/get', {'#ids': {'resultOf': 'q', 'name': 'x:MtaInboundThrottle/query', 'path': '/ids'}}, 'g']])
cap = [t for t in throttles[1][1]['list'] if t.get('description', '').startswith('Free plan:')]
expect('sending cap was created', len(cap) == 1, [t.get('description') for t in throttles[1][1]['list']])
expect('sending cap counts signed-in senders only', 'authenticated_as' in json.dumps(cap[0].get('match')) and cap[0]['key'] == {'authenticatedAs': True}, cap[0])

# Delete a mailbox, then clean up the test domain as the operator
status, body = call('DELETE', f'/api/panel/mailboxes/{made[-1]}', auth=OWNER)
expect('owner deletes a mailbox', status == 200, (status, body))
status, view = call('GET', '/api/panel/domain', auth=OWNER)
expect('usage drops after delete', view['usage']['mailboxes'] == limit - 1, view.get('usage'))

# The owner closes the domain: every mailbox and the domain go, and the name is free again
def domain_ids():
    found = jmap(ADMIN, [['x:Domain/query', {'filter': {}}, 'q'],
                         ['x:Domain/get', {'#ids': {'resultOf': 'q', 'name': 'x:Domain/query', 'path': '/ids'}, 'properties': ['id', 'name']}, 'g']])[1][1]['list']
    return [d['id'] for d in found if d['name'] == DOMAIN]

status, body = call('POST', '/api/panel/domain/close', {'confirm': 'not-the-domain.test'}, OWNER)
expect('closing needs the domain typed exactly', status == 400 and body.get('error') == 'notConfirmed', (status, body))
status, body = call('POST', '/api/panel/domain/close', {'confirm': DOMAIN.upper()}, OWNER)
if status != 200:
    remove_domain(domain_ids())
expect('owner closes the domain', status == 200 and body.get('closed') == DOMAIN, (status, body))
expect('the domain is gone', domain_ids() == [])
expect('the owner can no longer sign in', call('GET', '/jmap/session', auth=OWNER)[0] == 401)
expect('a closed mailbox can no longer sign in', call('GET', '/jmap/session', auth=basic(f'user1@{DOMAIN}', NEW))[0] == 401)
status, body = call('POST', '/api/panel/signup/code', {'domain': DOMAIN})
expect('the domain name can be signed up again', status == 200, (status, body))
print(f'Free plan end-to-end check passed: {checks} checks on {DOMAIN}; the owner closed the test domain.')
