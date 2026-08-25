import { PRODUCT_NAME } from "../constants/branding";

export function BrandLogo() {
	return (
		<svg
			data-testid="brand-logo"
			role="img"
			aria-label={PRODUCT_NAME}
			width="32"
			height="32"
			viewBox="0 0 32 32"
			className="size-[32px] shrink-0 text-primary"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M5 25V7L16 18L27 7V25"
				fill="none"
				stroke="currentColor"
				strokeWidth="3.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
