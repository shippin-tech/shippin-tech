import type { KeysVariant } from './variants';

// What the product tells people about each key it receives or hands out. Every line here
// is true of the code today and covered by the test named in `proof`. Change a line only
// together with the code and the test behind it (see KEYS.md).

export type KeyFact = { label: string; text: string };

export type KeyGuide = {
	id: KeysVariant;
	/** Where the key comes from: made by the person at a provider, or by this server at random. */
	origin: 'yours' | 'generated';
	title: string;
	facts: KeyFact[];
	proof: string;
};

/** Why pasting here is right, although general advice says never to share a key. */
export const WHY_HERE =
	'Security advice says never share a key, because anyone holding it can act as you. That advice is about other people and other places. This field is where the key is meant to go, and the protections below make up for the risk. Each one is tested.';

export const RANDOM = 'a secure random generator';

export const KEY_GUIDES: Record<KeysVariant, KeyGuide> = {
	ai: {
		id: 'ai',
		origin: 'yours',
		title: 'Paste your AI key here. This is the right place for it.',
		facts: [
			{ label: 'Where it comes from', text: 'You create it in your AI provider’s console. A local model such as Ollama usually needs none.' },
			{ label: 'How it is kept', text: 'Encrypted before it is stored, with AES-256-GCM-SIV, under a random key used for nothing but AI keys.' },
			{ label: 'Who can see it', text: 'Nobody, through this website or its API: the page only says a key is saved. Only someone in full control of the server machine could recover it.' },
			{ label: 'Where it goes', text: 'Only to the address you set above, in that service’s own sign-in header. Redirects are refused, so it cannot be sent anywhere else.' },
			{ label: 'Changing it', text: 'Leave the field empty to keep the saved key. “Remove these settings” deletes it.' }
		],
		proof: 'The assistant live test checks that a saved key never comes back to the browser and reaches only the service. Unit tests check that it opens only with the AI service’s key.'
	},
	sso: {
		id: 'sso',
		origin: 'yours',
		title: 'Paste your client secret here. This is the right place for it.',
		facts: [
			{ label: 'Where it comes from', text: 'Your identity provider (Okta, Microsoft Entra, Google, Keycloak) creates it when you register this server as an app there.' },
			{ label: 'How it is kept', text: 'Encrypted with AES-256-GCM-SIV, under a random key used for nothing but sign-in secrets, and bound to this domain: it cannot be opened for any other.' },
			{ label: 'Who can see it', text: 'Nobody, through this website or its API: the page only says a secret is saved. Only someone in full control of the server machine could recover it.' },
			{ label: 'Where it goes', text: 'Only to your provider’s own token address, found from the provider address above, when someone signs in. Redirects are refused.' },
			{ label: 'Changing it', text: 'Leave the field empty to keep the saved secret. Paste a new one to replace it.' }
		],
		proof: 'The domain sign-in live test checks the secret never comes back to the browser. Unit tests check it opens only with the sign-in service’s key, for this domain.'
	},
	scim: {
		id: 'scim',
		origin: 'generated',
		title: 'This token was made for you. Paste it into your identity provider.',
		facts: [
			{ label: 'Where it comes from', text: `This server made it: 48 characters from ${RANDOM}.` },
			{ label: 'How it is kept', text: 'Only its SHA-256 fingerprint is stored, so it can never be shown again, to anyone. Copy it now.' },
			{ label: 'Where it goes', text: 'Into your identity provider’s SCIM settings, with the endpoint shown beside it. Nowhere else.' },
			{ label: 'Changing it', text: '“Revoke the token” stops it at once. “Make a new token” replaces it.' }
		],
		proof: 'The SCIM live test checks the token is never shown again, a changed token is refused, and a revoked one stops working at once.'
	},
	'app-password': {
		id: 'app-password',
		origin: 'generated',
		title: 'This password was made for you. Paste it into your mail app.',
		facts: [
			{ label: 'Where it comes from', text: `This server made it: 18 bytes from ${RANDOM}.` },
			{ label: 'How it is kept', text: 'Only an Argon2id hash is stored, so it can never be shown again. Copy it now.' },
			{ label: 'Where it goes', text: 'Into the password field of the one app or phone you named it for. Make one per app.' },
			{ label: 'Changing it', text: 'Revoke it here at any time, and that app stops signing in.' }
		],
		proof: 'The free-plan live test creates one in the browser and checks the server never returns it again.'
	},
	setup: {
		id: 'setup',
		origin: 'generated',
		title: 'Paste your setup key here. This is the right place for it.',
		facts: [
			{ label: 'Where it comes from', text: `This server made it on its first start: 24 characters from ${RANDOM}. install.sh and update.sh print it.` },
			{ label: 'How to use it', text: 'Sign in as admin, with the key as the password. You will then create your own administrator.' },
			{ label: 'How it is kept', text: 'Only in the server’s own data volume.' },
			{ label: 'Afterwards', text: 'The moment your administrator exists, the key is deleted and stops working. It also stops working 24 hours after it was made; restarting the server then makes a new one.' }
		],
		proof: 'The first-run live test, on a fresh install, checks that the key leads to your administrator and then stops working.'
	}
};

export function keyGuide(id: KeysVariant): KeyGuide {
	return KEY_GUIDES[id];
}
