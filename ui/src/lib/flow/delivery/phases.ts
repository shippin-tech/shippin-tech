export type DeliveryNode = {
	id: string;
	href: string;
	label: string;
	parent?: string;
};

const phases = [
	['mx-lookup', 'MX Lookup'],
	['mta-sts-fetch', 'MTA-STS Policy Fetch'],
	['tls-rpt-lookup', 'TLS-RPT Lookup'],
	['mta-sts-verify', 'MTA-STS Verify'],
	['tlsa-lookup', 'TLSA / DANE Lookup'],
	['ip-lookup', 'IP Lookup'],
	['connection', 'TCP Connection'],
	['read-greeting', 'Read Greeting'],
	['dane-verify', 'DANE Verify']
] as const;

const screen = '/portal/CustomComponent/LiveDelivery';

export const deliveryNodes: DeliveryNode[] = phases.map(([id, label], index) => ({
	id,
	label,
	href: screen,
	parent: index === 0 ? undefined : phases[index - 1][0]
}));
