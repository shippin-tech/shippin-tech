"""End-to-end check of account self-service and the retired /admin and /account bundle.

Creates a free-plan domain, then as one of its mailboxes: changes the password,
creates an app password and signs in to IMAP with it, turns two-factor on and
confirms sign-in then needs a code, turns it off, and revokes the app password.
Finally checks that /admin and /account are served by the built-in web app.
Removes everything it made. Run from the repository root:
    py -3.11 deploy/local/verify_account.py
"""
import base64
import hashlib
import hmac
import imaplib
import json
import pathlib
import secrets
import ssl
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:28080'
ENGINE = 'http://127.0.0.1:28081'
HERE = pathlib.Path(__file__).resolve().parent
admin = json.loads((HERE / '.credentials.json').read_text())
RUN = secrets.token_hex(3)
DOMAIN = f'acct-{RUN}.test'
FIRST = 'First password ' + secrets.token_hex(6)
SECOND = 'Second password ' + secrets.token_hex(6)
USING = ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap']
checks = 0


def basic(user, password):
    return 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()


ADMIN = basic(admin['username'], admin['secret'])


def call(method, path, body=None, auth=None, base=BASE, raw=False):
    headers = {'Accept': 'application/json'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if auth:
        headers['Authorization'] = auth
    req = urllib.request.Request(base + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = res.read()
            return res.status, (data if raw else json.loads(data or b'{}'))
    except urllib.error.HTTPError as err:
        data = err.read()
        if raw:
            return err.code, data
        try:
            return err.code, json.loads(data or b'{}')
        except json.JSONDecodeError:
            return err.code, {'raw': data.decode(errors='replace')}


def jmap(auth, calls):
    status, body = call('POST', '/jmap', {'using': USING, 'methodCalls': calls}, auth)
    assert status == 200, (status, body)
    return body['methodResponses']


def expect(label, condition, detail=''):
    global checks
    if not condition:
        raise SystemExit(f'FAIL {label} {detail}')
    checks += 1
    print(f'ok   {label}')


def totp(secret_b32, at=None):
    key = base64.b32decode(secret_b32)
    counter = int((at or time.time()) // 30)
    mac = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = mac[-1] & 15
    return '%06d' % ((struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7fffffff) % 1_000_000)


def imap_login(user, password):
    try:
        with imaplib.IMAP4_SSL('127.0.0.1', 21993, ssl_context=ssl._create_unverified_context()) as imap:
            imap.login(user, password)
            return True
    except imaplib.IMAP4.error:
        return False


def web_signin(user, password, code=None):
    """The browser's sign-in: discovery, public client, code with PKCE, token exchange."""
    status, doc = call('GET', '/api/discover/' + urllib.parse.quote(user))
    assert status == 200, (status, doc)
    redirect = BASE + '/oauth/callback'
    status, client = call('POST', '/auth/register', {'redirect_uris': [redirect], 'token_endpoint_auth_method': 'none',
                                                     'grant_types': ['authorization_code', 'refresh_token'], 'response_types': ['code'],
                                                     'client_name': 'verify_account'})
    assert status in (200, 201) and client.get('client_id'), (status, client)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    body = {'type': 'authCode', 'accountName': user, 'accountSecret': password, 'clientId': client['client_id'],
            'redirectUri': redirect, 'state': 's' + RUN, 'codeChallenge': challenge, 'codeChallengeMethod': 'S256'}
    if code:
        body['mfaToken'] = code
    status, answer = call('POST', '/api/auth', body)
    if answer.get('type') != 'authenticated':
        return answer.get('type') or f'http{status}', None
    form = urllib.parse.urlencode({'grant_type': 'authorization_code', 'code': answer['client_code'], 'code_verifier': verifier,
                                   'client_id': client['client_id'], 'redirect_uri': redirect}).encode()
    endpoint = urllib.parse.urljoin(BASE + '/', doc.get('token_endpoint') or '/auth/token')
    req = urllib.request.Request(endpoint, data=form, method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as res:
        token = json.loads(res.read())
    return 'authenticated', 'Bearer ' + token['access_token']


def update_password(auth, patch):
    return jmap(auth, [['x:AccountPassword/set', {'update': {'singleton': patch}}, 's']])[0][1]


def remove_domain(name):
    found = jmap(ADMIN, [['x:Domain/query', {}, 'q'],
                         ['x:Domain/get', {'#ids': {'resultOf': 'q', 'name': 'x:Domain/query', 'path': '/ids'}, 'properties': ['id', 'name']}, 'g']])[1][1]['list']
    ids = [d['id'] for d in found if d['name'] == name]
    if not ids:
        return
    accounts = jmap(ADMIN, [['x:Account/query', {'filter': {'domainId': ids[0]}}, 'q']])[0][1].get('ids', [])
    if accounts:
        jmap(ADMIN, [['x:Account/set', {'destroy': accounts}, 'a']])
    keys = jmap(ADMIN, [['x:DkimSignature/query', {}, 'q'],
                        ['x:DkimSignature/get', {'#ids': {'resultOf': 'q', 'name': 'x:DkimSignature/query', 'path': '/ids'}, 'properties': ['id', 'domainId']}, 'g']])[1][1].get('list', [])
    doomed = [k['id'] for k in keys if k.get('domainId') in ids]
    if doomed:
        jmap(ADMIN, [['x:DkimSignature/set', {'destroy': doomed}, 'k']])
    jmap(ADMIN, [['x:Domain/set', {'destroy': ids}, 'd']])


try:
    status, body = call('POST', '/api/panel/signup', {'domain': DOMAIN, 'name': 'owner', 'password': FIRST})
    assert status == 200, (status, body)
    OWNER = basic(f'owner@{DOMAIN}', FIRST)
    status, body = call('POST', '/api/panel/mailboxes', {'name': 'jane', 'password': FIRST}, OWNER)
    assert status == 200, (status, body)
    USER = f'jane@{DOMAIN}'
    JANE = basic(USER, FIRST)

    # A plain mailbox has the permissions the account page needs
    status, perms = call('GET', '/api/account', auth=JANE)
    needed = {'sysAccountPasswordGet', 'sysAccountPasswordUpdate', 'sysAppPasswordCreate', 'sysAppPasswordGet',
              'sysAppPasswordQuery', 'sysAppPasswordDestroy'}
    expect('mailbox may manage its own password and app passwords', needed <= set(perms.get('permissions', [])),
           sorted(needed - set(perms.get('permissions', []))))
    state = jmap(JANE, [['x:AccountPassword/get', {'ids': ['singleton']}, 'g']])[0][1]['list'][0]
    expect('two-factor starts off', not state['otpAuth'].get('otpUrl'), state)

    # Password change needs the current password
    result = update_password(JANE, {'secret': SECOND, 'currentSecret': 'wrong password here'})
    expect('wrong current password is refused', 'singleton' in result.get('notUpdated', {}), result)
    result = update_password(JANE, {'secret': SECOND, 'currentSecret': FIRST})
    expect('password change accepted', 'singleton' in result.get('updated', {}), result)
    expect('old password stops working', call('GET', '/jmap/session', auth=JANE)[0] == 401)
    JANE = basic(USER, SECOND)
    expect('new password works', call('GET', '/jmap/session', auth=JANE)[0] == 200)

    # App password: shown once, works in IMAP
    created = jmap(JANE, [['x:AppPassword/set', {'create': {'a': {'description': 'Phone'}}}, 's']])[0][1]
    app = (created.get('created') or {}).get('a') or {}
    expect('app password created and returned once', isinstance(app.get('secret'), str) and len(app['secret']) >= 16, created)
    listed = jmap(JANE, [['x:AppPassword/query', {}, 'q'],
                         ['x:AppPassword/get', {'#ids': {'resultOf': 'q', 'name': 'x:AppPassword/query', 'path': '/ids'}, 'properties': ['id', 'description', 'secret']}, 'g']])[1][1]['list']
    expect('app password listed by name', [i['description'] for i in listed] == ['Phone'], listed)
    expect('listing never reveals the secret', all(i.get('secret') != app['secret'] for i in listed), listed)
    expect('IMAP accepts the app password', imap_login(USER, app['secret']))

    # Two-factor: the page creates the secret and the server stores the link
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')
    url = 'otpauth://totp/' + urllib.parse.quote('ShippinTECH') + ':' + urllib.parse.quote(USER) + '?' + urllib.parse.urlencode(
        {'secret': secret, 'issuer': 'ShippinTECH', 'algorithm': 'SHA1', 'digits': '6', 'period': '30'})
    result = update_password(JANE, {'currentSecret': SECOND, 'otpAuth/otpUrl': url})
    expect('two-factor turned on', 'singleton' in result.get('updated', {}), result)
    status, _ = call('GET', '/jmap/session', auth=JANE)
    # The server answers 402 when the password is right but a code is required.
    expect('password alone no longer opens a session', status in (401, 402), status)
    outcome, _ = web_signin(USER, SECOND)
    expect('web sign-in asks for the code', outcome == 'mfaRequired', outcome)
    outcome, _ = web_signin(USER, SECOND, '000000' if totp(secret) != '000000' else '111111')
    expect('web sign-in refuses a wrong code', outcome != 'authenticated', outcome)
    outcome, WITH_CODE = web_signin(USER, SECOND, totp(secret))
    expect('web sign-in with the current code succeeds', outcome == 'authenticated' and WITH_CODE, outcome)
    expect('session from that sign-in works', call('GET', '/jmap/session', auth=WITH_CODE)[0] == 200)
    expect('IMAP still works with the app password', imap_login(USER, app['secret']))
    expect('IMAP refuses the plain password', not imap_login(USER, SECOND))

    # Password change while two-factor is on needs the code
    result = update_password(WITH_CODE, {'secret': FIRST, 'currentSecret': SECOND})
    expect('change without the code is refused', 'singleton' in result.get('notUpdated', {}), result)
    result = update_password(WITH_CODE, {'currentSecret': SECOND, 'otpAuth/otpCode': totp(secret), 'otpAuth/otpUrl': None})
    expect('two-factor turned off with the code', 'singleton' in result.get('updated', {}), result)
    expect('password alone works again', call('GET', '/jmap/session', auth=JANE)[0] == 200)

    # Revoke
    result = jmap(JANE, [['x:AppPassword/set', {'destroy': [app['id']]}, 's']])[0][1]
    expect('app password revoked', app['id'] in result.get('destroyed', []), result)
    expect('IMAP refuses the revoked app password', not imap_login(USER, app['secret']))

    # A2: the built-in web app owns /admin and /account; nothing tries the dead download
    status, page = call('GET', '/account', base=ENGINE, raw=True)
    expect('/account is served by the built-in web app', status == 200 and b'_app/' in page, status)
    status, page = call('GET', '/admin/', base=ENGINE, raw=True)
    expect('/admin is served by the built-in web app', status == 200 and b'_app/' in page, status)
finally:
    remove_domain(DOMAIN)

print(f'Account self-service check passed: {checks} checks on {DOMAIN}; test domain removed.')
