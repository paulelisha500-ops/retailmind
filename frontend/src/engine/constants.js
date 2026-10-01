// Single source of truth for constants shared across engine modules.

/** 100 loyalty points = AED 1 (cashier redemption and the P&L liability both use this). */
export const POINTS_TO_AED = 0.01;

export const CATEGORIES = ["Produce", "Dairy & Chilled", "Frozen", "Bakery", "Meat & Seafood"];

export const PAYMENT_METHODS = ["cash", "card", "apple_pay", "google_pay", "samsung_pay", "tabby"];

export const ACCESS_LEVELS = ["staff", "manager", "admin"];

export const ONBOARDING_STATUSES = ["pending", "compliance_review", "approved", "suspended"];

/** Rough grocery-store hourly traffic shape (weights, not counts) for seeding checkout timestamps. */
export const HOURLY_WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 7, 8, 10, 9, 6, 5, 6, 8, 10, 9, 6, 3, 1, 0];

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_PER_EMAIL = 8;
export const MAX_FAILED_PER_CLIENT = 30;
export const ACCESS_TOKEN_TTL_SECONDS = 12 * 60 * 60;
