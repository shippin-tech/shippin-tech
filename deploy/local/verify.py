"""Send local SMTP mail, then verify its body through JMAP and IMAP."""
import base64
import imaplib
import json
import pathlib
import smtplib
import ssl
import time
import urllib.request
import uuid
from email.message import EmailMessage

HERE = pathlib.Path(__file__).resolve().parent
credentials = json.loads((HERE / '.credentials.json').read_text())
username, password = credentials['username'], credentials['secret']
auth = 'Basic ' + base64.b64encode(f'{username}:{password}'.encode()).decode()

def request(path, body=None):
    req = urllib.request.Request('http://127.0.0.1:28080' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': auth, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

session = request('/jmap/session')
account = session['primaryAccounts']['urn:ietf:params:jmap:mail']

def jmap(name, args):
    result = request('/jmap', {'using': ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        'methodCalls': [[name, {'accountId': account, **args}, 't']]})['methodResponses'][0]
    if result[0] != name:
        raise RuntimeError(str(result[1]))
    return result[1]

marker = 'Docker delivery check ' + str(uuid.uuid4())
message = EmailMessage()
message['From'] = username
message['To'] = username
message['Subject'] = marker
message.set_content('SMTP to persistent storage to JMAP: ' + marker)
with smtplib.SMTP('127.0.0.1', 21025, timeout=30) as smtp:
    smtp.send_message(message)
print('SMTP accepted local delivery.')
for attempt in range(30):
    ids = jmap('Email/query', {'filter': {'subject': marker}})['ids']
    if ids:
        detail = jmap('Email/get', {'ids': ids, 'properties': ['id', 'subject', 'textBody', 'bodyValues'],
            'fetchTextBodyValues': True})['list'][0]
        assert marker in str(detail['bodyValues']), 'Delivered body does not match'
        break
    time.sleep(2)
else:
    raise RuntimeError('Mail did not appear through JMAP within 60 seconds')
print('JMAP retrieved the delivered message and matching body.')
with imaplib.IMAP4_SSL('127.0.0.1', 21993, ssl_context=ssl._create_unverified_context()) as imap:
    imap.login(username, password)
    status, _ = imap.select('INBOX')
    assert status == 'OK'
    status, data = imap.search(None, 'SUBJECT', '"' + marker + '"')
    assert status == 'OK' and data[0], 'Delivered message not found over IMAP'
print('IMAPS authenticated and found the same delivered message.')
print('Local mail round trip passed.')
