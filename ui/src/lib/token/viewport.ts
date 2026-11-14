/** Viewport for the fluid clamps. Utopia interpolates from minWidth to maxWidth. */
export const viewport = {
	minWidth: 320,
	maxWidth: 1240,
	type: {
		minFontSize: 18,
		maxFontSize: 20,
		minTypeScale: 1.2,
		maxTypeScale: 1.25,
		negativeSteps: 2,
		positiveSteps: 5
	},
	space: {
		minSize: 16,
		maxSize: 18,
		negativeSteps: [0.75, 0.5, 0.25],
		positiveSteps: [1.5, 2, 3, 4, 6]
	},
	images: {
		s: [160, 240],
		m: [320, 560],
		l: [640, 960]
	},
	measure: [280, 420],
	aside: [176, 240]
} as const;

export type ImageSlot = keyof typeof viewport.images;
